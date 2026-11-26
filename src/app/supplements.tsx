import { useState, type FormEvent, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Plus, Trash2, Pencil, Pill } from "lucide-react";
import { Button, Input, Modal, Picker } from "../components/ui/primitives";
import { DatePicker } from "../components/calio/date-picker";
import type { SupplementLog, SupplementProduct } from "../db/records";
import { numberFormatter, parseDecimal } from "../domain/dates";
import { normalizeFoodText } from "../domain/library";
import {
  nutrientMetadata,
  scaleAmount,
  type NutrientKey,
} from "../domain/nutrition";
import {
  deleteEvent,
  saveSupplementLog,
  saveSupplementProduct,
  saveSupplementWithServing,
} from "../services/tracking";
import { nutrientName } from "./nutrient-labels";
import { Page, useCalio } from "./state";

type Ingredient = SupplementProduct["composition"][number];
type NamedIngredient = NonNullable<
  SupplementProduct["otherIngredients"]
>[number];
const units: Ingredient["unit"][] = ["g", "mg", "µg", "mL", "kcal", "IU"];

export default function Supplements() {
  const { today, t } = useCalio();
  const [date, setDate] = useState(today);
  return (
    <Page
      title={t("مکمل‌ها", "Supplements")}
      subtitle={t(
        "مقدار مصرف را بر اساس برچسب محصول ثبت کنید.",
        "Log servings using the product label.",
      )}
      actions={<DatePicker value={date} step onChange={setDate} />}
    >
      <SupplementTracker key={date} date={date} />
    </Page>
  );
}

export function SupplementTracker({
  date,
  quickLinks,
}: {
  date: string;
  quickLinks?: ReactNode;
}) {
  const { db, t, locale, notify } = useCalio();
  const compact = quickLinks !== undefined;
  const [productId, setProductId] = useState("");
  const [servings, setServings] = useState("");
  const [editing, setEditing] = useState<SupplementLog | null>(null);
  const [deleting, setDeleting] = useState<SupplementLog | null>(null);
  const [showProduct, setShowProduct] = useState(false);
  const [showServing, setShowServing] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const products = useLiveQuery(
    () => db.supplement_products.orderBy("name").toArray(),
    [db],
    [],
  );
  const logs = useLiveQuery(
    async () =>
      (await db.supplement_logs.where("localDate").equals(date).toArray()).sort(
        (a, b) => b.createdAt.localeCompare(a.createdAt),
      ),
    [db, date],
    [],
  );
  const number = numberFormatter(locale, { maximumFractionDigits: 6 });
  const product = products.find(({ id }) => id === productId);
  const servingTitle = editing
    ? t("ویرایش مصرف", "Edit serving")
    : t("ثبت مصرف مکمل", "Log a supplement serving");
  const doseHint = t(
    "مقدار نامعلوم را خالی بگذارید.",
    "Leave blank if the dose is unknown.",
  );

  function closeServing() {
    setShowServing(false);
    setEditing(null);
    setServings("");
    setError("");
  }

  async function saveLog(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    const dose = parseDecimal(servings);
    if (!productId || (servings.trim() && (dose === null || dose <= 0))) {
      setError(
        t(
          "مکمل و تعداد وعدهٔ معتبر انتخاب کنید.",
          "Choose a supplement and enter a positive serving count.",
        ),
      );
      return;
    }
    setWorking(true);
    try {
      await saveSupplementLog(
        db,
        {
          localDate: date,
          time: editing?.time ?? null,
          productId,
          servings: dose,
          matchedMeal: editing?.matchedMeal ?? null,
        },
        editing?.id,
      );
      closeServing();
      notify("مکمل ثبت شد.", "Supplement logged.", "success");
    } catch {
      setError(t("مکمل ثبت نشد.", "Supplement could not be logged."));
    } finally {
      setWorking(false);
    }
  }

  function openQuickServing() {
    const stored = product ?? products[0];
    if (!stored) {
      setShowProduct(true);
      return;
    }
    setProductId(stored.id);
    setShowServing(true);
  }

  const servingForm = (
    <form
      className={compact ? "form" : "panel form"}
      onSubmit={(event) => void saveLog(event)}
      noValidate
    >
      {!compact && <h2>{servingTitle}</h2>}
      <Picker
        label={t("مکمل", "Supplement")}
        value={productId}
        onChange={setProductId}
        choices={[
          { value: "", label: t("انتخاب مکمل", "Choose supplement") },
          ...products.map(({ id, name }) => ({ value: id, label: name })),
        ]}
      />
      <Input
        label={t("تعداد وعده مطابق برچسب", "Number of label servings")}
        value={servings}
        inputMode="decimal"
        hint={
          product
            ? t(
                `واحد برچسب این مکمل «${product.servingUnit}» است. ${doseHint}`,
                `The label serving unit is “${product.servingUnit}”. ${doseHint}`,
              )
            : doseHint
        }
        onChange={(event) => setServings(event.target.value)}
      />
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        <Button type="submit" disabled={working}>
          {t("ذخیرهٔ مصرف", "Save serving")}
        </Button>
        {!compact && (
          <Button tone="quiet" onClick={() => setShowProduct(true)}>
            {t("تعریف مکمل", "Add supplement")}
          </Button>
        )}
        {editing && (
          <Button tone="quiet" onClick={closeServing}>
            {t("انصراف", "Cancel")}
          </Button>
        )}
      </div>
    </form>
  );

  return (
    <>
      {compact && (
        <div
          className="journal-shortcuts"
          role="group"
          aria-label={t("ثبت سریع", "Quick logging")}
        >
          {quickLinks}
          <Button tone="quiet" onClick={openQuickServing}>
            <Pill size={23} aria-hidden />
            {t("ثبت مکمل", "Log supplement")}
          </Button>
        </div>
      )}
      {compact ? (
        <Modal
          title={servingTitle}
          open={showServing}
          onOpenChange={(open) => {
            if (!open && !working) closeServing();
          }}
        >
          {servingForm}
        </Modal>
      ) : (
        servingForm
      )}
      <section
        className="panel"
        id={compact ? "journal-supplements" : undefined}
      >
        <div className="row between">
          <h2>{t("مکمل‌های این روز", "Supplements on this date")}</h2>
          {compact && (
            <div className="actions">
              <Button
                tone={products.length ? "quiet" : "primary"}
                onClick={() => setShowProduct(true)}
              >
                <Plus size={17} aria-hidden />
                {t("تعریف و ثبت مکمل", "Create and log a supplement")}
              </Button>
            </div>
          )}
        </div>
        {!logs.length && (
          <p className="muted">
            {t(
              "برای این روز مکملی ثبت نشده است.",
              "No supplements logged on this date.",
            )}
          </p>
        )}
        <div className="rows">
          {logs.map((log) => {
            const ingredients = [
              ...log.productSnapshot.composition.map((row) => ({
                ...row,
                name: nutrientName(row.key, locale),
                id: row.key,
              })),
              ...(log.productSnapshot.otherIngredients ?? []).map((row) => ({
                ...row,
                id: `label:${row.name}`,
              })),
            ];
            return (
              <div className="row-item row between" key={log.id}>
                <div className="grow">
                  <h3>{log.productSnapshot.name}</h3>
                  <p className="muted">
                    {log.servings === null
                      ? t("مقدار نامعلوم", "Dose unknown")
                      : `${number.format(log.servings)} ${log.productSnapshot.servingUnit}`}
                  </p>
                  {!!ingredients.length && (
                    <p className="muted small supplement-ingredients">
                      {ingredients.map((row) => {
                        const consumed = scaleAmount(row.amount, log.servings);
                        return (
                          <span key={row.id}>
                            {row.name}{" "}
                            {consumed === null ? (
                              "—"
                            ) : (
                              <bdi>
                                {number.format(consumed)} {row.unit}
                              </bdi>
                            )}
                          </span>
                        );
                      })}
                    </p>
                  )}
                </div>
                <div className="actions">
                  <Button
                    className="icon-button"
                    tone="quiet"
                    aria-label={t("ویرایش مصرف", "Edit serving")}
                    onClick={() => {
                      setEditing(log);
                      setProductId(log.productId);
                      setServings(log.servings?.toString() ?? "");
                      setError("");
                      if (compact) setShowServing(true);
                    }}
                  >
                    <Pencil size={17} />
                  </Button>
                  <Button
                    className="icon-button"
                    tone="quiet"
                    aria-label={t("حذف مصرف", "Delete serving")}
                    onClick={() => setDeleting(log)}
                  >
                    <Trash2 size={17} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
      {showProduct && (
        <SupplementProductDialog
          logDate={compact ? date : undefined}
          onClose={() => setShowProduct(false)}
          onSaved={(id) => {
            setProductId(id);
            setShowProduct(false);
          }}
        />
      )}
      <Modal
        title={t("حذف مصرف مکمل", "Delete supplement serving")}
        open={!!deleting}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
      >
        <div className="actions">
          <Button
            tone="danger"
            onClick={() => {
              if (!deleting) return;
              void deleteEvent(db, "supplement_logs", deleting.id)
                .then(() => setDeleting(null))
                .catch(() => notify("حذف نشد.", "Deletion failed.", "error"));
            }}
          >
            {t("حذف", "Delete")}
          </Button>
          <Button tone="quiet" onClick={() => setDeleting(null)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
    </>
  );
}

function SupplementProductDialog({
  logDate,
  onClose,
  onSaved,
}: {
  logDate?: string;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const { db, t, locale, notify } = useCalio();
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [evidence, setEvidence] = useState("");
  const [key, setKey] = useState<NutrientKey | "custom">("vitamin_d_ug");
  const [customName, setCustomName] = useState("");
  const [amount, setAmount] = useState("");
  const [labelUnit, setLabelUnit] = useState<Ingredient["unit"]>("µg");
  const [servings, setServings] = useState("");
  const [composition, setComposition] = useState<Ingredient[]>([]);
  const [other, setOther] = useState<NamedIngredient[]>([]);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const number = numberFormatter(locale, { maximumFractionDigits: 6 });

  function collected() {
    const value = parseDecimal(amount);
    if (amount.trim() && (value === null || value < 0)) {
      setError(t("مقدار برچسب معتبر نیست.", "The label amount is invalid."));
      return null;
    }
    if (key === "custom") {
      const label = customName.trim();
      if (!label) {
        setError(
          t(
            "نام مادهٔ روی برچسب را وارد کنید.",
            "Enter the ingredient name on the label.",
          ),
        );
        return null;
      }
      const otherIngredients = [
        ...other.filter(
          (row) => normalizeFoodText(row.name) !== normalizeFoodText(label),
        ),
        { name: label, amount: value, unit: labelUnit },
      ];
      return { composition, otherIngredients };
    }
    return {
      composition: [
        ...composition.filter((row) => row.key !== key),
        { key, amount: value, unit: labelUnit },
      ],
      otherIngredients: other,
    };
  }

  function addIngredient() {
    const next = collected();
    if (!next) return;
    setComposition(next.composition);
    setOther(next.otherIngredients);
    setAmount("");
    setCustomName("");
    setError("");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (working) return;
    const dose = parseDecimal(servings);
    if (logDate && servings.trim() && (dose === null || dose <= 0)) {
      setError(
        t("تعداد وعده باید مثبت باشد.", "Enter a positive serving count."),
      );
      return;
    }
    const next =
      amount.trim() || customName.trim()
        ? collected()
        : { composition, otherIngredients: other };
    if (!next) return;
    const input = { name, servingUnit: unit, labelEvidence: evidence, ...next };
    setWorking(true);
    setError("");
    try {
      if (logDate) {
        const log = await saveSupplementWithServing(db, input, {
          localDate: logDate,
          servings: dose,
        });
        onSaved(log.productId);
        notify("مکمل ثبت شد.", "Supplement logged.", "success");
      } else {
        const product = await saveSupplementProduct(db, input);
        onSaved(product.id);
      }
    } catch {
      setError(
        t(
          "مکمل ذخیره نشد. نام و واحد هر وعده را بررسی کنید.",
          "The supplement could not be saved. Check the name and serving unit.",
        ),
      );
    } finally {
      setWorking(false);
    }
  }

  const displayIngredient = (
    name: string,
    row: Pick<Ingredient, "amount" | "unit">,
  ) => (
    <span>
      {name}{" "}
      {row.amount === null ? (
        "—"
      ) : (
        <bdi>
          {number.format(row.amount)} {row.unit}
        </bdi>
      )}
    </span>
  );

  return (
    <Modal
      title={
        logDate
          ? t("تعریف و ثبت مکمل", "Create and log a supplement")
          : t("تعریف مکمل", "Add supplement")
      }
      open
      onOpenChange={(open) => {
        if (!open && !working) onClose();
      }}
    >
      <form
        className="form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <div className="columns">
          <Input
            label={t("نام محصول", "Product name")}
            value={name}
            maxLength={250}
            onChange={(event) => setName(event.target.value)}
          />
          <Input
            label={t("واحد یک وعده", "Label serving unit")}
            value={unit}
            maxLength={250}
            onChange={(event) => setUnit(event.target.value)}
          />
        </div>
        {logDate && (
          <Input
            label={t("تعداد وعده مطابق برچسب", "Number of label servings")}
            value={servings}
            inputMode="decimal"
            hint={t(
              "مقدار نامعلوم را خالی بگذارید.",
              "Leave blank if the dose is unknown.",
            )}
            onChange={(event) => setServings(event.target.value)}
          />
        )}
        <h3>{t("ترکیب هر وعده", "Composition per serving")}</h3>
        <Picker
          label={t("مادهٔ مغذی", "Nutrient")}
          value={key}
          choices={[
            ...nutrientMetadata.map((row) => ({
              value: row.key,
              label: nutrientName(row.key, locale),
            })),
            {
              value: "custom",
              label: t(
                "مادهٔ دیگر، مثل ب‌کمپلکس",
                "Other ingredient, such as B complex",
              ),
            },
          ]}
          onChange={(value) => {
            setKey(value);
            setCustomName("");
            const target = nutrientMetadata.find(
              (row) => row.key === value,
            )?.unit;
            setLabelUnit(units.find((entry) => entry === target) ?? "mg");
          }}
        />
        {key === "custom" && (
          <Input
            label={t("نام مادهٔ روی برچسب", "Ingredient name on label")}
            value={customName}
            maxLength={250}
            onChange={(event) => setCustomName(event.target.value)}
          />
        )}
        <div className="columns">
          <Input
            label={t("مقدار برچسب", "Label amount")}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <Picker
            label={t("واحد", "Unit")}
            value={labelUnit}
            choices={units.map((value) => ({ value, label: value }))}
            onChange={setLabelUnit}
          />
        </div>
        <Button tone="quiet" onClick={addIngredient}>
          {t("افزودن به ترکیب", "Add to composition")}
        </Button>
        {composition.map((row) => (
          <div className="row between" key={row.key}>
            {displayIngredient(nutrientName(row.key, locale), row)}
            <Button
              className="icon-button"
              tone="quiet"
              aria-label={t("حذف ماده", "Remove nutrient")}
              onClick={() =>
                setComposition(
                  composition.filter((item) => item.key !== row.key),
                )
              }
            >
              <Trash2 size={17} />
            </Button>
          </div>
        ))}
        {other.map((row) => (
          <div className="row between" key={row.name}>
            {displayIngredient(row.name, row)}
            <Button
              className="icon-button"
              tone="quiet"
              aria-label={t("حذف ماده", "Remove ingredient")}
              onClick={() =>
                setOther(other.filter((item) => item.name !== row.name))
              }
            >
              <Trash2 size={17} />
            </Button>
          </div>
        ))}
        <Input
          label={t("مرجع برچسب یا توضیح", "Label reference or note")}
          value={evidence}
          maxLength={4000}
          onChange={(event) => setEvidence(event.target.value)}
        />
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <Button type="submit" disabled={working}>
            {logDate
              ? t("ذخیره و ثبت مصرف", "Save and log serving")
              : t("ذخیرهٔ مکمل", "Save supplement")}
          </Button>
          <Button tone="quiet" onClick={onClose} disabled={working}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
