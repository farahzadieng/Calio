import { useState, type FormEvent } from "react";
import { useLocation } from "react-router";
import { Coffee, Droplet, Plus, Pencil, Trash2 } from "lucide-react";
import { useLiveQuery } from "dexie-react-hooks";
import { DatePicker } from "../components/calio/date-picker";
import { Button, Input, Modal, Picker } from "../components/ui/primitives";
import type { Drink } from "../db/records";
import { localDate, numberFormatter, parseDecimal } from "../domain/dates";
import { deleteEvent, saveDrink } from "../services/tracking";
import { Page, useCalio } from "./state";

import waterGlass from "../../assets/illustrations/water-glass.webp";
import coffeeCup from "../../assets/illustrations/coffee.webp";
import teaGlass from "../../assets/illustrations/tea.jpg";
import maltGlass from "../../assets/illustrations/alcohol-free-beer.jpg";

const quickDrinks = [
  {
    kind: "water",
    name: ["آب", "Water"],
    action: ["یک لیوان آب", "Add a glass of water"],
    volume: 250,
    image: waterGlass,
  },
  {
    kind: "coffee",
    name: ["قهوه", "Coffee"],
    action: ["یک فنجان قهوه", "Add a cup of coffee"],
    volume: 150,
    image: coffeeCup,
  },
  {
    kind: "tea",
    name: ["چای", "Tea"],
    action: ["یک فنجان چای", "Add a cup of tea"],
    volume: 200,
    image: teaGlass,
  },
  {
    kind: "alcohol_free_beer",
    name: ["آبجوی بدون الکل", "Alcohol-free beer"],
    action: ["یک لیوان آبجوی بدون الکل", "Add a glass of alcohol-free beer"],
    volume: 250,
    image: maltGlass,
  },
] as const;

export default function Drinks() {
  const { db, today, t, locale, notify } = useCalio();
  const jump = useLocation().state as {
    date?: unknown;
    drink?: unknown;
  } | null;
  const jumpDate = localDate.safeParse(jump?.date);
  const coffee = jump?.drink === "coffee";
  const [date, setDate] = useState(jumpDate.data ?? today);
  const [kind, setKind] = useState<Drink["kind"]>(coffee ? "coffee" : "water");
  const [formOpen, setFormOpen] = useState(coffee);
  const [quickError, setQuickError] = useState("");
  const [amount, setAmount] = useState("");
  const [title, setTitle] = useState("");
  const [strength, setStrength] = useState("");
  const [caffeine, setCaffeine] = useState("");
  const [editing, setEditing] = useState<Drink | null>(null);
  const [deleting, setDeleting] = useState<Drink | null>(null);
  const [match, setMatch] = useState("");
  const [error, setError] = useState("");
  const saved = useLiveQuery(
    () => db.drinks.where("localDate").equals(date).toArray(),
    [db, date],
    [],
  );
  const meals = useLiveQuery(
    () =>
      db.meal_items
        .where("localDate")
        .equals(date)
        .filter((row) => !row.excludedFromTotals)
        .toArray(),
    [db, date],
    [],
  );
  const typeChoices: { value: Drink["kind"]; label: string }[] = [
    ...quickDrinks.map(({ kind, name }) => ({
      value: kind,
      label: t(name[0], name[1]),
    })),
    { value: "other", label: t("نوشیدنی دیگر", "Other drink") },
  ];
  const format = numberFormatter(locale, { maximumFractionDigits: 2 });
  const total = saved.reduce((sum, row) => sum + row.amountMl, 0);
  const known = saved.filter(
    (row) => row.kind !== "water" && row.caffeineMg !== null,
  );
  const unknown = saved.filter(
    (row) => row.kind !== "water" && row.caffeineMg === null,
  ).length;
  const key = (row: { entryId: string; revision: number; itemId: string }) =>
    JSON.stringify([row.entryId, row.revision, row.itemId]);
  const clear = () => {
    setAmount("");
    setTitle("");
    setStrength("");
    setCaffeine("");
    setMatch("");
    setEditing(null);
    setError("");
  };

  function closeForm() {
    setFormOpen(false);
    clear();
  }

  async function addQuickDrink(drink: (typeof quickDrinks)[number]) {
    setQuickError("");
    try {
      await saveDrink(db, {
        localDate: date,
        time: null,
        kind: drink.kind,
        title: t(drink.name[0], drink.name[1]),
        strength: null,
        amountMl: drink.volume,
        caffeineMg: null,
        matchedMeal: null,
      });
    } catch {
      setQuickError(t("نوشیدنی ذخیره نشد.", "The drink could not be saved."));
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const ml = parseDecimal(amount);
    const mg = kind === "water" ? null : parseDecimal(caffeine);
    if (
      ml === null ||
      ml <= 0 ||
      (kind !== "water" && caffeine.trim() && (mg === null || mg < 0))
    ) {
      setError(
        t(
          "حجم مثبت و در صورت ثبت، کافئین معتبر وارد کنید.",
          "Enter a positive volume and a valid caffeine value if provided.",
        ),
      );
      return;
    }
    const item = meals.find((row) => key(row) === match);
    try {
      await saveDrink(
        db,
        {
          localDate: date,
          time: editing?.time ?? null,
          kind,
          title:
            title.trim() ||
            typeChoices.find((row) => row.value === kind)?.label ||
            kind,
          strength: kind === "water" ? null : strength.trim() || null,
          amountMl: ml,
          caffeineMg: mg,
          matchedMeal: item
            ? {
                entryId: item.entryId,
                itemId: item.itemId,
                revision: item.revision,
              }
            : null,
        },
        editing?.id,
      );
      closeForm();
      notify("نوشیدنی ذخیره شد.", "Drink saved.", "success");
    } catch {
      setError(
        t(
          "ذخیره نشد. اگر نوشیدنی به یادداشت وصل است، پیوند را بررسی کنید.",
          "Could not save. Check the linked journal item.",
        ),
      );
    }
  }

  return (
    <Page
      title={t("نوشیدنی‌ها", "Drinks")}
      className="drinks-page"
      actions={
        <DatePicker
          value={date}
          step
          onChange={(next) => {
            setDate(next);
            setQuickError("");
            closeForm();
          }}
        />
      }
    >
      <section className="panel quick-drink-panel">
        <div className="row between">
          <div className="stack tight">
            <h2>{t("ثبت سریع", "Quick log")}</h2>
            <p role="status" className="muted small">
              {format.format(total)} {t("میلی‌لیتر ثبت‌شده", "mL logged")}
            </p>
          </div>
          <Button
            tone="quiet"
            onClick={() => {
              clear();
              setKind("coffee");
              setFormOpen(true);
            }}
          >
            <Plus size={17} aria-hidden />
            {t("ثبت نوشیدنی دیگر", "Log another drink")}
          </Button>
        </div>
        <div className="quick-drink-grid">
          {quickDrinks.map((drink) => (
            <Button
              key={drink.kind}
              tone="quiet"
              className="quick-drink"
              aria-label={`${t(drink.action[0], drink.action[1])} · ${format.format(drink.volume)} ${t("میلی‌لیتر", "mL")}`}
              onClick={() => void addQuickDrink(drink)}
            >
              <img src={drink.image} alt="" width="84" height="76" />
              <span>{t(drink.name[0], drink.name[1])}</span>
              <small>
                {format.format(drink.volume)} {t("میلی‌لیتر", "mL")}
              </small>
            </Button>
          ))}
        </div>
        {quickError && (
          <p role="alert" className="field-error">
            {quickError}
          </p>
        )}
      </section>
      <section className="columns">
        <div className="panel">
          <Droplet size={19} aria-hidden />
          <h2>{t("آب ثبت‌شده", "Water logged")}</h2>
          <p className="metric">
            {format.format(
              saved.reduce(
                (sum, row) => sum + (row.kind === "water" ? row.amountMl : 0),
                0,
              ),
            )}{" "}
            <span className="small">{t("میلی‌لیتر", "mL")}</span>
          </p>
        </div>
        <div className="panel">
          <Coffee size={19} aria-hidden />
          <h2>{t("کافئین ثبت‌شده", "Known caffeine")}</h2>
          <p className="metric">
            {known.length
              ? format.format(
                  known.reduce((sum, row) => sum + (row.caffeineMg ?? 0), 0),
                )
              : "—"}{" "}
            <span className="small">{t("میلی‌گرم", "mg")}</span>
          </p>
          {!!unknown && (
            <p className="muted small">
              {format.format(unknown)}{" "}
              {t("نوشیدنی با کافئین نامشخص", "drinks with unknown caffeine")}
            </p>
          )}
        </div>
      </section>
      <Modal
        title={
          editing
            ? t("ویرایش نوشیدنی", "Edit drink")
            : t("ثبت نوشیدنی", "Log a drink")
        }
        open={formOpen}
        onOpenChange={(open) => {
          if (!open) closeForm();
        }}
      >
        <form
          className="form"
          onSubmit={(event) => void submit(event)}
          noValidate
        >
          <div className="columns">
            <Picker
              label={t("نوع", "Type")}
              choices={typeChoices}
              value={kind}
              onChange={setKind}
            />
            <Input
              label={t("حجم (میلی‌لیتر)", "Volume (mL)")}
              value={amount}
              inputMode="decimal"
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="actions">
            {[150, 200, 250].map((ml) => (
              <Button
                key={ml}
                tone="quiet"
                onClick={() => setAmount(format.format(ml))}
              >
                {format.format(ml)} {t("میلی‌لیتر", "mL")}
              </Button>
            ))}
          </div>
          {kind !== "water" && (
            <>
              <Input
                label={t("نام یا نوع دقیق", "Name or preparation")}
                value={title}
                onChange={(event) => setTitle(event.target.value)}
              />
              <div className="columns">
                <Input
                  label={t("غلظت یا روش دم‌آوری", "Strength or brew method")}
                  value={strength}
                  onChange={(event) => setStrength(event.target.value)}
                />
                <Input
                  label={t("کافئین معلوم (میلی‌گرم)", "Known caffeine (mg)")}
                  inputMode="decimal"
                  value={caffeine}
                  onChange={(event) => setCaffeine(event.target.value)}
                  hint={t(
                    "اگر نمی‌دانید، خالی بگذارید.",
                    "Leave blank if unknown.",
                  )}
                />
              </div>
            </>
          )}
          {!!meals.length && (
            <Picker
              label={t(
                "این نوشیدنی در یادداشت هم ثبت شده؟",
                "Also in your journal?",
              )}
              value={match}
              onChange={setMatch}
              choices={[
                { value: "", label: t("بدون پیوند", "No linked item") },
                ...meals.map((row) => ({
                  value: key(row),
                  label:
                    locale === "fa"
                      ? row.nameFa || row.nameEn
                      : row.nameEn || row.nameFa,
                })),
              ]}
            />
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          <div className="actions">
            <Button type="submit">
              <Plus size={17} aria-hidden />
              {t("ذخیره", "Save drink")}
            </Button>
            {editing && (
              <Button tone="quiet" onClick={closeForm}>
                {t("انصراف", "Cancel")}
              </Button>
            )}
          </div>
        </form>
      </Modal>
      <section className="panel">
        <h2>{t("ثبت‌های این روز", "Drinks on this date")}</h2>
        {!saved.length && (
          <p className="muted">
            {t("هنوز نوشیدنی ثبت نشده است.", "No drinks logged yet.")}
          </p>
        )}
        <div className="rows">
          {saved.map((row) => (
            <div className="row-item row between" key={row.id}>
              <div>
                <h3>{row.title}</h3>
                <p className="muted">
                  {format.format(row.amountMl)} {t("میلی‌لیتر", "mL")}
                </p>
              </div>
              <div className="actions">
                <Button
                  tone="quiet"
                  className="icon-button"
                  aria-label={t("ویرایش نوشیدنی", "Edit drink")}
                  onClick={() => {
                    setFormOpen(true);
                    setEditing(row);
                    setKind(row.kind);
                    setTitle(row.title);
                    setAmount(
                      numberFormatter(locale, {
                        maximumFractionDigits: 20,
                        useGrouping: false,
                      }).format(row.amountMl),
                    );
                    setCaffeine(
                      row.caffeineMg == null
                        ? ""
                        : numberFormatter(locale, {
                            maximumFractionDigits: 20,
                            useGrouping: false,
                          }).format(row.caffeineMg),
                    );
                    setStrength(row.strength ?? "");
                    setMatch(row.matchedMeal ? key(row.matchedMeal) : "");
                    setError("");
                  }}
                >
                  <Pencil size={17} />
                </Button>
                <Button
                  tone="quiet"
                  className="icon-button"
                  aria-label={t("حذف نوشیدنی", "Delete drink")}
                  onClick={() => setDeleting(row)}
                >
                  <Trash2 size={17} />
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>
      <Modal
        title={t("حذف نوشیدنی", "Delete drink")}
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <div className="actions">
          <Button
            tone="danger"
            onClick={() => {
              if (deleting)
                void deleteEvent(db, "drinks", deleting.id)
                  .then(() => setDeleting(null))
                  .catch(() => setError(t("حذف نشد.", "Deletion failed.")));
            }}
          >
            {t("حذف", "Delete")}
          </Button>
          <Button tone="quiet" onClick={() => setDeleting(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
    </Page>
  );
}
