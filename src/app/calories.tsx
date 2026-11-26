import { numberFormatter } from "../domain/dates";
import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link, useLocation } from "react-router";
import { z } from "zod";
import { GatewayTransport } from "../ai/browser";
import { Button, Input, Picker, Textarea } from "../components/ui/primitives";
import type { MealItem } from "../db/records";
import {
  calorieTargetSchema,
  makeCopiedCaloriePrompt,
  parseCopiedCalorieAnswer,
  type CalorieAnswer,
  type CalorieTarget,
} from "../domain/calorie-lookup";
import { searchIranianCalorieReferences } from "../domain/iranian-calories";
import type { Food } from "../domain/library";
import {
  applyCalorieReference,
  findLocalCalorieFood,
  lookupCalorieFood,
  saveCalorieAnswer,
} from "../services/calorie-lookup";
import { Page, useCalio } from "./state";

const mealLink = z.object({
  entryId: z.uuid(),
  revision: z.number().int().positive(),
  itemId: z.string().min(1).max(250),
});

const extractionDetails = z.object({
  items: z.array(
    z.object({
      item_id: z.string(),
      variant: z.string(),
      preparation: z.string(),
      brand: z.string().nullable(),
    }),
  ),
});

export function CaloriePage() {
  const { db, t } = useCalio();
  const link = mealLink.safeParse(useLocation().state);
  const item = link.success ? link.data : null;
  const context = useLiveQuery(async () => {
    if (!item) return null;
    const [meal, parsed] = await Promise.all([
      db.meal_items.get([item.entryId, item.revision, item.itemId]),
      db.parsed_entries.get([item.entryId, item.revision]),
    ]);
    if (!meal || meal.excludedFromTotals) return null;
    const extraction = extractionDetails.safeParse(parsed?.output);
    const details = extraction.data?.items.find(
      ({ item_id }) => item_id === meal.itemId,
    );
    return { meal, details };
  }, [db, item?.entryId, item?.revision, item?.itemId]);

  return (
    <Page
      title={t("مرجع و تحلیل کالری", "Calorie lookup and reference")}
      actions={
        <Link
          className="button button--quiet"
          to={
            context
              ? `/insights/day/${context.meal.localDate}`
              : "/settings/library"
          }
        >
          {context
            ? t("بازگشت به گزارش روز", "Back to daily insights")
            : t("کتابخانهٔ خوراکی‌ها", "Food library")}
        </Link>
      }
    >
      {(!item || context !== undefined) && (
        <CalorieLookup
          key={
            context
              ? `${context.meal.entryId}:${context.meal.revision}:${context.meal.itemId}`
              : "library"
          }
          meal={context?.meal}
          details={context?.details}
        />
      )}
    </Page>
  );
}

function CalorieLookup({
  meal,
  details,
}: {
  meal?: MealItem;
  details?: z.infer<typeof extractionDetails>["items"][number];
}) {
  const { db, settings, locale, t, today } = useCalio();
  const [draft, setDraft] = useState<CalorieTarget>(() => ({
    nameFa: meal?.nameFa ?? "",
    nameEn: meal?.nameEn ?? "",
    variant: meal?.foodSnapshot?.variant ?? details?.variant ?? "",
    preparation: meal?.foodSnapshot?.preparation ?? details?.preparation ?? "",
    brand: meal?.foodSnapshot?.brand ?? details?.brand ?? null,
    basis:
      meal?.foodSnapshot?.basis ??
      (meal?.ml != null && meal.grams == null ? "per_100ml" : "per_100g"),
  }));
  const [query, setQuery] = useState("");
  const [copiedTarget, setCopiedTarget] = useState<CalorieTarget | null>(null);
  const [pasted, setPasted] = useState("");
  const [answer, setAnswer] = useState<Extract<
    CalorieAnswer,
    { status: "known" }
  > | null>(null);
  const [food, setFood] = useState<Food | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const mode = settings.calorieLookupMode ?? "copy";
  const number = numberFormatter(locale, { maximumFractionDigits: 2 });
  const unit = (basis: CalorieTarget["basis"]) =>
    basis === "per_100g"
      ? t("کیلوکالری در ۱۰۰ گرم", "kcal per 100 g")
      : t("کیلوکالری در ۱۰۰ میلی‌لیتر", "kcal per 100 mL");
  const prompt = copiedTarget
    ? makeCopiedCaloriePrompt(copiedTarget, locale)
    : "";

  function resetResult() {
    setFood(null);
    setAnswer(null);
    setPasted("");
    setCopiedTarget(null);
    setMessage("");
    setError("");
  }

  function update(patch: Partial<CalorieTarget>) {
    setDraft({ ...draft, ...patch });
    resetResult();
  }

  function target() {
    const parsed = calorieTargetSchema.safeParse(draft);
    if (parsed.success) return parsed.data;
    setError(
      t(
        "نام خوراکی و مشخصات کوتاه آن را وارد کنید.",
        "Enter the food name and short food details.",
      ),
    );
    return null;
  }

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch {
      setError(
        t(
          "این عملیات انجام نشد. دوباره تلاش کنید.",
          "This action could not be completed. Try again.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function lookup() {
    const input = target();
    if (!input) return;
    resetResult();
    void run(async () => {
      const local = await findLocalCalorieFood(db, input);
      if (local?.nutrients.energy_kcal != null) {
        setFood(local);
        setMessage(
          t(
            "کالری از مرجع محلی خوانده شد.",
            "Calories loaded from the local reference.",
          ),
        );
        return;
      }
      if (mode === "copy") {
        setCopiedTarget(input);
        try {
          await navigator.clipboard.writeText(
            makeCopiedCaloriePrompt(input, locale),
          );
          setMessage(t("پرامپت کپی شد.", "Prompt copied."));
        } catch {
          setMessage(
            t(
              "متن پرامپت را از کادر زیر کپی کنید.",
              "Copy the prompt from the box below.",
            ),
          );
        }
        return;
      }
      const transport =
        settings.aiConsentAt && db.mode === "real"
          ? await GatewayTransport.connect()
          : null;
      if (!transport) {
        setError(
          t(
            "برای درخواست خودکار، اتصال و رضایت پردازش AI باید فعال باشند. می‌توانید از مسیر کپی استفاده کنید.",
            "Automatic requests require a live integration and AI consent. You can use the copy workflow.",
          ),
        );
        return;
      }
      try {
        const result = await lookupCalorieFood(db, transport, input);
        if (result?.nutrients.energy_kcal != null) setFood(result);
        else
          setMessage(
            t(
              "برای این خوراکی مرجع منطبق پیدا نشد.",
              "No matching reference was found for this food.",
            ),
          );
      } catch {
        setError(
          t(
            "کالری معتبر از API دریافت نشد. وضعیت اتصال را در یکپارچه‌سازی‌ها بررسی کنید یا از مسیر کپی استفاده کنید.",
            "The API did not return a valid calorie value. Check Integrations or use the copy workflow.",
          ),
        );
      }
    });
  }

  function readAnswer() {
    if (!copiedTarget) return;
    setAnswer(null);
    setError("");
    setMessage("");
    try {
      const result = parseCopiedCalorieAnswer(pasted, copiedTarget);
      if (result.status === "known") setAnswer(result);
      else
        setMessage(
          t(
            "پاسخ، کالری مستندی برای این خوراکی ندارد.",
            "The reply could not find a sourced calorie value for this food.",
          ),
        );
    } catch {
      setError(
        t(
          "JSON پاسخ معتبر نیست یا با خوراکی و واحد پرامپت هم‌خوانی ندارد.",
          "The response JSON is invalid or differs from the food and unit in the prompt.",
        ),
      );
    }
  }

  function saveAnswer() {
    if (!copiedTarget || !answer) return;
    void run(async () => {
      setFood(await saveCalorieAnswer(db, copiedTarget, answer, "copy", today));
      setAnswer(null);
      setCopiedTarget(null);
      setPasted("");
      setMessage(
        t("کالری در کتابخانه ذخیره شد.", "Calories saved to the food library."),
      );
    });
  }

  function applyToMeal() {
    if (!meal || !food) return;
    void run(async () => {
      const applied = await applyCalorieReference(db, meal, food);
      setMessage(
        applied
          ? t(
              "کالری این خوراکی در گزارش روز به‌روز شد.",
              "This item's calories were updated in your daily insights.",
            )
          : t(
              "مرجع ذخیره شده است. برای محاسبهٔ کالری وعده، مقدار مصرف را در «اصلاح مقدار» وارد کنید.",
              "The reference is saved. Enter the consumed amount in Correct amount to calculate the meal calories.",
            ),
      );
    });
  }

  return (
    <>
      <section className="panel form">
        <h2>{t("پیدا کردن کالری خوراکی", "Find a food’s calories")}</h2>
        <div className="columns">
          <Input
            label={t("نام فارسی خوراکی", "Persian food name")}
            value={draft.nameFa}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update({ nameFa: event.target.value })}
          />
          <Input
            label={t("نام انگلیسی خوراکی", "English food name")}
            value={draft.nameEn}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update({ nameEn: event.target.value })}
          />
        </div>
        <div className="columns">
          <Input
            label={t("نوع خوراکی", "Food variant")}
            value={draft.variant}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update({ variant: event.target.value })}
          />
          <Input
            label={t("روش آماده‌سازی", "Preparation")}
            value={draft.preparation}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update({ preparation: event.target.value })}
          />
        </div>
        <div className="columns">
          <Input
            label={t("برند (اختیاری)", "Brand (optional)")}
            value={draft.brand ?? ""}
            maxLength={100}
            disabled={busy}
            onChange={(event) => update({ brand: event.target.value || null })}
          />
          <Picker
            label={t("مبنای کالری", "Calorie basis")}
            value={draft.basis}
            disabled={busy}
            choices={[
              { value: "per_100g", label: unit("per_100g") },
              { value: "per_100ml", label: unit("per_100ml") },
            ]}
            onChange={(basis) => update({ basis })}
          />
        </div>
        <Picker
          label={t("روش تحلیل کالری", "Calorie lookup method")}
          value={mode}
          disabled={busy}
          choices={[
            { value: "copy", label: t("کپی به پرامپت", "Copy prompt") },
            {
              value: "api",
              label: t("تحلیل از طریق API (خودکار)", "Automatic API lookup"),
            },
          ]}
          onChange={(calorieLookupMode) => {
            resetResult();
            void run(async () => {
              await db.settings.update("settings", { calorieLookupMode });
            });
          }}
        />
        <p className="field-hint">
          {mode === "api"
            ? t(
                "در این حالت، Calio در صورت پیدا نکردن مرجع محلی برای خوراکی دارای مقدار مصرف، از Sonar استفاده می‌کند. درخواست API ممکن است هزینه داشته باشد.",
                "Calio uses Sonar for measured food items without a matching local reference. API requests may incur a charge.",
              )
            : t(
                "Calio ابتدا کتابخانه و جدول محلی را بررسی می‌کند. می‌توانید برای خوراکی‌های دیگر از پرامپت استفاده کنید.",
                "Calio checks your library and the local table first. Use the prompt for other foods.",
              )}
        </p>
        <div className="actions">
          <Button onClick={lookup} disabled={busy}>
            {mode === "api"
              ? t("تحلیل از طریق API (خودکار)", "Automatic API lookup")
              : t("کپی به پرامپت", "Copy prompt")}
          </Button>
        </div>
        {copiedTarget && (
          <>
            <p>
              {t(
                "پرامپت را به ChatGPT بدهید و پاسخ JSON را در کادر زیر بچسبانید.",
                "Give the prompt to ChatGPT and paste the JSON reply in the box below.",
              )}
            </p>
            <Textarea
              label={t("پرامپت قابل کپی", "Prompt to copy")}
              value={prompt}
              readOnly
              rows={7}
            />
            <Textarea
              label={t("پاسخ JSON از ChatGPT", "JSON reply from ChatGPT")}
              maxLength={12000}
              value={pasted}
              dir="ltr"
              rows={5}
              disabled={busy}
              onChange={(event) => {
                setPasted(event.target.value);
                setAnswer(null);
                setError("");
                setMessage("");
              }}
            />
            <div className="actions">
              <Button onClick={readAnswer} disabled={busy || !pasted.trim()}>
                {t("بررسی پاسخ", "Review response")}
              </Button>
            </div>
          </>
        )}
        {answer && (
          <div>
            <p>
              <bdi>{number.format(answer.kcalPer100)}</bdi> {unit(answer.basis)}
            </p>
            <p>
              <a href={answer.source.url} target="_blank" rel="noreferrer">
                {answer.source.title}
              </a>
            </p>
            <p>
              {t(
                "پیش از ذخیره، تطابق عدد و واحد را با منبع بررسی کنید.",
                "Confirm that the number and unit match the source before saving.",
              )}
            </p>
            <Button onClick={saveAnswer} disabled={busy}>
              {t("ذخیرهٔ کالری", "Save calories")}
            </Button>
          </div>
        )}
        {food?.nutrients.energy_kcal != null && (
          <div>
            <p>
              <bdi>{number.format(food.nutrients.energy_kcal)}</bdi>{" "}
              {unit(food.basis)}
            </p>
            {food.evidence
              .filter((source) => source.keys.includes("energy_kcal"))
              .map((source) => (
                <p key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.title}
                  </a>
                </p>
              ))}
            {meal && (
              <Button onClick={applyToMeal} disabled={busy}>
                {t("اعمال به این خوراکی ثبت‌شده", "Apply to this logged food")}
              </Button>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <p role="status" className="muted">
          {message}
        </p>
      </section>
      <section className="panel form">
        <h2>
          {t("جدول مرجع خوراکی‌های ایرانی", "Iranian food reference table")}
        </h2>
        <p className="muted">
          {t(
            "ارقام برای نمونه یا دستور منتشرشده‌اند. دستور پخت و مواد اولیه می‌توانند کالری را تغییر دهند.",
            "Values reflect the published sample or recipe. Ingredients and preparation can change the calories.",
          )}
        </p>
        <Input
          label={t("جست‌وجو در جدول مرجع", "Filter the reference table")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <div className="table-wrap">
          <table
            aria-label={t(
              "جدول کالری خوراکی‌های ایرانی",
              "Iranian food calories",
            )}
          >
            <thead>
              <tr>
                <th scope="col">{t("خوراکی", "Food")}</th>
                <th scope="col">{unit("per_100g")}</th>
                <th scope="col">{t("منبع", "Source")}</th>
              </tr>
            </thead>
            <tbody>
              {searchIranianCalorieReferences(query).map((row) => (
                <tr key={row.id}>
                  <th scope="row">
                    {locale === "fa" ? row.nameFa : row.nameEn}
                    {row.brand && (
                      <div className="muted small">
                        <bdi>{row.brand}</bdi>
                      </div>
                    )}
                  </th>
                  <td>
                    <bdi>{number.format(row.kcalPer100g)}</bdi>
                  </td>
                  <td>
                    <a
                      href={row.publication.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {row.publication.title}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
