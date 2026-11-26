import { lazy, Suspense, useRef, useState, type FormEvent } from "react";
import { Link, Route, Routes } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import {
  ClipboardPaste,
  Activity,
  ArrowRight,
  BookOpen,
  Database,
  Settings2,
  Plug,
  Trash2,
  Sun,
  Moon,
  Monitor,
} from "lucide-react";
import {
  Button,
  Input,
  Modal,
  Picker,
  Textarea,
  Toggle,
} from "../components/ui/primitives";
import { settingsSchema, estimateEnergy } from "../domain/profile";
import { foodSchema, type Food } from "../domain/library";
import {
  nutrientKeys,
  nutrientMetadata,
  unknownNutrients,
  type NutrientKey,
} from "../domain/nutrition";
import {
  numberFormatter,
  numberingSystem,
  parseDecimal,
} from "../domain/dates";
import {
  exportBackup,
  fullFormat,
  libraryFormat,
  previewRestore,
} from "../services/backup";
import { exportLibraryCsv, previewLibraryCsv } from "../services/library-csv";
import { importHealthText } from "../services/health-import";
import { AiConnection } from "./ai-connection";
import { CaloriePage } from "./calories";
import { nutrientName } from "./nutrient-labels";
import { Page, useCalio } from "./state";

const Diagnostics = lazy(() => import("./settings-diagnostics"));

function SettingsHome() {
  const { db, t, settings, notify } = useCalio();
  const [timeZone, setTimeZone] = useState(settings.timeZone);
  const [zoneError, setZoneError] = useState("");
  const [erase, setErase] = useState(false);
  const [storage, setStorage] = useState<string | null>(null);
  async function update(patch: Partial<typeof settings>) {
    const parsed = settingsSchema.safeParse({ ...settings, ...patch });
    if (!parsed.success) {
      setZoneError(t("منطقهٔ زمانی معتبر نیست.", "The time zone is invalid."));
      return;
    }
    await db.settings.put(parsed.data);
    setZoneError("");
  }
  return (
    <Page title={t("تنظیمات", "Settings")}>
      <form
        className="panel form"
        onSubmit={(event) => {
          event.preventDefault();
          void update({ timeZone }).catch(() =>
            setZoneError(t("ذخیره نشد.", "Could not save.")),
          );
        }}
      >
        <h2>{t("نمایش و دسترسی", "Display and accessibility")}</h2>
        <div className="columns">
          <Picker
            label={t("زبان", "Language")}
            value={settings.locale}
            choices={[
              { value: "fa", label: "فارسی" },
              { value: "en", label: "English" },
            ]}
            onChange={(locale) => void update({ locale })}
          />
          <Picker
            label={t("تقویم نمایشی", "Display calendar")}
            value={settings.calendar}
            choices={[
              { value: "persian", label: t("شمسی", "Solar Hijri") },
              { value: "gregory", label: t("میلادی", "Gregorian") },
            ]}
            onChange={(calendar) => void update({ calendar })}
          />
        </div>
        <fieldset className="theme-options">
          <legend>{t("ظاهر", "Appearance")}</legend>
          <div>
            {(
              [
                ["light", t("روز", "Light"), Sun],
                ["dark", t("شب", "Dark"), Moon],
                ["system", t("دستگاه", "System"), Monitor],
              ] as const
            ).map(([theme, label, Icon]) => (
              <Button
                key={theme}
                tone="quiet"
                aria-pressed={settings.theme === theme}
                onClick={() => void update({ theme })}
              >
                <Icon size={18} aria-hidden />
                {label}
              </Button>
            ))}
          </div>
        </fieldset>
        <Toggle
          label={t("کاهش حرکت", "Reduce motion")}
          enabled={settings.reduceMotion}
          onChange={(reduceMotion) => void update({ reduceMotion })}
        />
        <Input
          label={t("منطقهٔ زمانی", "Time zone")}
          dir="ltr"
          value={timeZone}
          error={zoneError}
          onChange={(event) => setTimeZone(event.target.value)}
        />
        <div className="actions">
          <Button type="submit" tone="quiet">
            {t("ذخیرهٔ منطقهٔ زمانی", "Save time zone")}
          </Button>
        </div>
      </form>
      <section className="panel">
        <h2>{t("داده و اتصال‌ها", "Data and integrations")}</h2>
        {[
          ["integrations", t("Apple Health و AI", "Apple Health and AI"), Plug],
          ["library", t("کتابخانهٔ خوراکی‌ها", "Food library"), BookOpen],
          [
            "backup",
            t("پشتیبان‌گیری و بازیابی", "Backup and restore"),
            Database,
          ],
          ["diagnostics", t("آزمون و عیب‌یابی", "Diagnostics"), Activity],
        ].map(([subpath, label, icon]) => {
          const Icon = icon as typeof Settings2;
          return (
            <Link
              key={String(subpath)}
              className="button button--quiet settings-link"
              to={`/settings/${subpath}`}
            >
              <Icon size={18} aria-hidden />
              <span>{String(label)}</span>
              <ArrowRight className="directional" size={17} aria-hidden />
            </Link>
          );
        })}
      </section>
      <section className="panel">
        <h2>{t("ذخیره‌سازی دستگاه", "Device storage")}</h2>
        <p className="muted">
          {t(
            "مرورگر ممکن است داده‌های محلی را پاک کند. برای نگهداری نسخهٔ مستقل، بکاپ بگیرید.",
            "The browser may remove local storage. Export a backup to keep a separate copy.",
          )}
        </p>
        <div className="actions">
          <Button
            tone="quiet"
            onClick={() => {
              void navigator.storage
                ?.persist?.()
                .then((persisted) =>
                  setStorage(
                    persisted
                      ? t(
                          "ذخیرهٔ پایدار فعال است.",
                          "Persistent storage is enabled.",
                        )
                      : t(
                          "مرورگر ذخیرهٔ پایدار را تأیید نکرد.",
                          "The browser did not grant persistent storage.",
                        ),
                  ),
                );
            }}
          >
            {t("درخواست ذخیرهٔ پایدار", "Request persistent storage")}
          </Button>
          <Button tone="danger" onClick={() => setErase(true)}>
            <Trash2 size={17} aria-hidden />
            {t("حذف داده‌های محلی", "Delete local data")}
          </Button>
        </div>
        {storage && <p role="status">{storage}</p>}
      </section>
      <Modal
        open={erase}
        onOpenChange={setErase}
        title={t("حذف همهٔ داده‌های محلی", "Delete all local data")}
        description={t(
          "پیش از ادامه، از تنظیمات بکاپ بگیرید. دفترچه، پروفایل و داده‌های این دستگاه حذف می‌شوند.",
          "Export a backup before continuing. Your journal, profile, and data on this device will be erased.",
        )}
      >
        <div className="actions">
          <Button
            tone="danger"
            onClick={() => {
              void db
                .transaction("rw", db.tables, () =>
                  Promise.all(db.tables.map((table) => table.clear())),
                )
                .then(() => {
                  localStorage.removeItem("calio-language");
                  window.location.assign("/");
                })
                .catch(() =>
                  notify("حذف کامل نشد.", "Deletion failed.", "error"),
                );
            }}
          >
            {t("حذف دائمی", "Delete permanently")}
          </Button>
          <Button tone="quiet" onClick={() => setErase(false)}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </Modal>
    </Page>
  );
}

function Integrations() {
  const { db, t, settings, profile, notify, locale } = useCalio();
  const [shortcut, setShortcut] = useState(
    settings.healthShortcutName ?? "HealthKit-Bridge",
  );
  const [source, setSource] = useState("");
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState("");
  const last = useLiveQuery(
    () => db.health_imports.orderBy("importedAt").last(),
    [db],
  );
  const lastString = last
    ? new Intl.DateTimeFormat(locale, {
        numberingSystem: numberingSystem(locale),
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: settings.timeZone,
        calendar: settings.calendar,
      }).format(new Date(last.importedAt))
    : null;
  async function syncHealth() {
    setPending(true);
    try {
      const profileEstimate = estimateEnergy(profile);
      const result = await importHealthText(db, source, {
        timeZone: settings.timeZone,
        missingToken: null,
        minimumRestingKcal: profileEstimate
          ? profileEstimate.restingKcal * 0.5
          : 0,
      });
      setSource("");
      const count = numberFormatter(locale).format(result.count);
      setStatus(t(`${count} تاریخ بررسی شد.`, `${count} dates checked.`));
      notify(
        "همگام‌سازی Health انجام شد.",
        "Health sync completed.",
        result.incompleteDays ? "warning" : "success",
      );
      window.dispatchEvent(new Event("calio-health-synced"));
    } catch {
      setStatus(
        t(
          "قالب ورودی معتبر نیست یا ذخیره‌سازی انجام نشد. هر پنج بخش Shortcut را دوباره کپی کنید.",
          "Import failed. Copy all five sections from the Shortcut and try again.",
        ),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <Page title={t("اتصال‌ها", "Integrations")}>
      <section className="panel">
        <h2>Apple Health</h2>
        <p className="muted">
          {t(
            "Shortcut چهار اندازه‌گیری را از Health می‌خواند و در کلیپ‌بورد می‌گذارد. متن در همین مرورگر بررسی می‌شود.",
            "The Shortcut reads four Health metrics into your clipboard. Calio processes the text on this device.",
          )}
        </p>
        {lastString && (
          <p>
            {t("آخرین ورود موفق", "Last successful import")}: {lastString}
          </p>
        )}
        <Input
          label={t("نام Shortcut", "Shortcut name")}
          dir="ltr"
          value={shortcut}
          maxLength={256}
          onChange={(event) => setShortcut(event.target.value)}
        />
        <div className="actions">
          {shortcut.trim() && (
            <a
              className="button button--primary"
              href={`shortcuts://run-shortcut?name=${encodeURIComponent(shortcut.trim())}`}
            >
              {t("اجرای Shortcut", "Run Shortcut")}
            </a>
          )}
          <Button
            tone="quiet"
            onClick={() => {
              const next = shortcut.trim();
              if (!next) return;
              void db.settings
                .update("settings", { healthShortcutName: next })
                .then(() =>
                  notify("نام ذخیره شد.", "Shortcut name saved.", "success"),
                );
            }}
          >
            {t("ذخیرهٔ نام", "Save name")}
          </Button>
          <Button
            tone="quiet"
            onClick={() => {
              if (!navigator.clipboard?.readText) {
                setStatus(
                  t("متن را دستی جای‌گذاری کنید.", "Paste the text manually."),
                );
                return;
              }
              void navigator.clipboard
                .readText()
                .then((value) => {
                  setSource(value);
                  setStatus("");
                })
                .catch(() =>
                  setStatus(
                    t(
                      "دسترسی کلیپ‌بورد داده نشد. متن را دستی جای‌گذاری کنید.",
                      "Clipboard permission was denied. Paste the text manually.",
                    ),
                  ),
                );
            }}
          >
            <ClipboardPaste aria-hidden size={17} />
            {t("خواندن کلیپ‌بورد", "Read clipboard")}
          </Button>
        </div>
        <Textarea
          label={t("متن خروجی Health", "Health export text")}
          dir="ltr"
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            setStatus("");
          }}
          spellCheck={false}
        />
        {status && <p role="status">{status}</p>}
        <div className="actions">
          <Button
            disabled={!source.trim() || pending}
            onClick={() => void syncHealth()}
          >
            {t("ورود داده‌ها", "Import data")}
          </Button>
        </div>
      </section>
      <AiConnection />
    </Page>
  );
}

function download(name: string, text: string, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function BackupTools({ library }: { library: boolean }) {
  const { db, t, notify, today } = useCalio();
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [preview, setPreview] = useState<Awaited<
    ReturnType<typeof previewRestore>
  > | null>(null);
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const format = library ? libraryFormat : fullFormat;
  const baseName = library ? "calio-food-library" : "calio-backup";

  async function readFile(file: File) {
    setMessage("");
    setPreview(null);
    setSnapshotSaved(false);
    if (file.size > 32 * 1024 * 1024) {
      setMessage(
        t("اندازهٔ فایل بیش از حد مجاز است.", "The file is too large."),
      );
      return;
    }
    try {
      const text = await file.text();
      const plan =
        library && /\.csv$/i.test(file.name)
          ? await previewLibraryCsv(db, text, mode)
          : await previewRestore(db, text, format, mode);
      setPreview(plan);
    } catch {
      setMessage(
        t(
          "فایل نامعتبر، ناسازگار یا متعلق به محیط آزمایشی است.",
          "The file is invalid, incompatible, or from demo mode.",
        ),
      );
    }
  }

  return (
    <section className="panel">
      <h2>
        {library
          ? t("ورود و خروج کتابخانه", "Import and export library")
          : t("پشتیبان‌گیری و بازیابی", "Backup and restore")}
      </h2>
      {!library && (
        <p className="muted">
          {t(
            "فایل بکاپ رمزگذاری نشده و شامل اطلاعات شخصی است. آن را در جای مطمئن نگه دارید.",
            "The backup is unencrypted and contains personal data. Keep it somewhere safe.",
          )}
        </p>
      )}
      <div className="actions">
        <Button
          tone="quiet"
          onClick={() => {
            void exportBackup(db, format)
              .then((text) => download(`${baseName}-${today}.json`, text))
              .catch(() =>
                notify("خروجی ایجاد نشد.", "Export failed.", "error"),
              );
          }}
        >
          JSON
        </Button>
        {library && (
          <Button
            tone="quiet"
            onClick={() => {
              void exportLibraryCsv(db)
                .then((text) =>
                  download(
                    `${baseName}-${today}.csv`,
                    text,
                    "text/csv;charset=utf-8",
                  ),
                )
                .catch(() =>
                  notify("خروجی ایجاد نشد.", "Export failed.", "error"),
                );
            }}
          >
            CSV
          </Button>
        )}
      </div>
      <Picker
        label={t("روش بازیابی", "Restore method")}
        value={mode}
        choices={[
          { value: "merge", label: t("ادغام", "Merge") },
          { value: "replace", label: t("جایگزینی", "Replace") },
        ]}
        onChange={(next) => {
          setMode(next);
          setPreview(null);
        }}
      />
      <input
        type="file"
        hidden
        accept={library ? ".json,.csv" : ".json"}
        ref={fileInput}
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (file) void readFile(file);
        }}
      />
      <div className="actions">
        <Button tone="quiet" onClick={() => fileInput.current?.click()}>
          {t("انتخاب فایل برای پیش‌نمایش", "Choose file to preview")}
        </Button>
      </div>
      {message && <p role="status">{message}</p>}
      <Modal
        open={!!preview}
        onOpenChange={(open) => {
          if (!open) setPreview(null);
        }}
        title={t("پیش‌نمایش بازیابی", "Restore preview")}
      >
        {preview && (
          <>
            <ul className="stack tight">
              {preview.counts
                .filter(({ existing, imported }) => existing || imported)
                .map(({ table, imported, result }) => (
                  <li key={table}>
                    <bdi>{table}</bdi> · {t("ورودی", "Imported")} {imported} ·{" "}
                    {t("نتیجه", "Result")} {result}
                  </li>
                ))}
            </ul>
            {!!preview.conflicts.length && (
              <p className="notice notice--warning">
                {t(
                  "در موارد متعارض، دادهٔ فعلی دستگاه حفظ می‌شود.",
                  "Existing device data is kept when records conflict.",
                )}
              </p>
            )}
            {preview.preRestoreBackup && (
              <Button
                tone="quiet"
                onClick={() => {
                  if (!preview.preRestoreBackup) return;
                  download(
                    `${baseName}-before-restore-${today}.json`,
                    preview.preRestoreBackup,
                  );
                  setSnapshotSaved(true);
                }}
              >
                {t(
                  "دانلود نسخهٔ قبل از جایگزینی",
                  "Download pre-restore backup",
                )}
              </Button>
            )}
            <div className="actions">
              <Button
                tone={mode === "replace" ? "danger" : "primary"}
                disabled={mode === "replace" && !snapshotSaved}
                onClick={() => {
                  void preview
                    .commit({
                      confirmReplace: mode === "replace",
                      snapshotSaved,
                    })
                    .then(() => {
                      setPreview(null);
                      notify(
                        "بازیابی انجام شد.",
                        "Restore completed.",
                        "success",
                      );
                    })
                    .catch(() => {
                      setPreview(null);
                      setMessage(
                        t(
                          "بازیابی انجام نشد. پیش‌نمایش را دوباره بسازید.",
                          "Restore failed. Preview the file again.",
                        ),
                      );
                    });
                }}
              >
                {mode === "replace"
                  ? t("تأیید جایگزینی", "Confirm replacement")
                  : t("تأیید ادغام", "Confirm merge")}
              </Button>
              <Button tone="quiet" onClick={() => setPreview(null)}>
                {t("انصراف", "Cancel")}
              </Button>
            </div>
          </>
        )}
      </Modal>
    </section>
  );
}

function FoodLibrary() {
  const { db, t, locale, notify } = useCalio();
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState<Food | null>(null);
  const [error, setError] = useState("");
  const foods = useLiveQuery(() => db.foods.toArray(), [db], []);
  const visible = foods.filter((food) =>
    [food.nameFa, food.nameEn, food.variant, food.brand].some((name) =>
      name?.toLowerCase().includes(query.trim().toLowerCase()),
    ),
  );
  const fresh = (): Food => ({
    id: crypto.randomUUID(),
    nameFa: "",
    nameEn: "",
    variant: "unknown",
    preparation: "unknown",
    brand: null,
    basis: "per_100g",
    nutrients: unknownNutrients(),
    addedSugarG: null,
    evidence: [],
    assumptions: [],
    confidence: "low",
    version: 1,
  });
  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft) return;
    const validated = foodSchema.safeParse(draft);
    if (!validated.success) {
      setError(
        t(
          "نام یا ترکیب خوراکی معتبر نیست.",
          "The food name or composition is invalid.",
        ),
      );
      return;
    }
    void db.foods
      .get(draft.id)
      .then((previous) =>
        db.foods.put({
          ...validated.data,
          version: (previous?.version ?? 0) + 1,
        }),
      )
      .then(() => {
        setDraft(null);
        setError("");
        notify("مدخل ذخیره شد.", "Library entry saved.", "success");
      })
      .catch(() => setError(t("ذخیره نشد.", "Could not save.")));
  }

  return (
    <Page
      title={t("کتابخانهٔ خوراکی‌ها", "Food library")}
      actions={
        <div className="actions">
          <Link
            className="button button--quiet"
            to="/settings/library/calories"
          >
            {t("مرجع و تحلیل کالری", "Calorie lookup and reference")}
          </Link>
          <Button
            onClick={() => {
              setDraft(fresh());
              setError("");
            }}
          >
            {t("افزودن خوراکی", "Add food")}
          </Button>
        </div>
      }
    >
      <section className="panel">
        <Input
          label={t("جست‌وجوی نام خوراکی", "Search foods")}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {!visible.length && (
          <p className="muted">
            {t("خوراکی مطابق پیدا نشد.", "No matching foods.")}
          </p>
        )}
        {visible.map((food) => (
          <div className="row-item row between" key={food.id}>
            <div>
              <h3>
                {locale === "fa"
                  ? food.nameFa || food.nameEn
                  : food.nameEn || food.nameFa}
              </h3>
              <p className="muted">
                <bdi>
                  {food.basis === "per_100ml" ? "100 mL" : "100 g"} · v
                  {numberFormatter(locale, { useGrouping: false }).format(
                    food.version,
                  )}
                </bdi>
              </p>
            </div>
            <Button
              tone="quiet"
              onClick={() => {
                setDraft(food);
                setError("");
              }}
            >
              {t("ویرایش", "Edit")}
            </Button>
          </div>
        ))}
      </section>
      <BackupTools library />
      <Modal
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) setDraft(null);
        }}
        title={t("مدخل خوراکی", "Food entry")}
      >
        {draft && (
          <form className="form" onSubmit={save} noValidate>
            <div className="columns">
              <Input
                label={t("نام فارسی", "Persian name")}
                value={draft.nameFa}
                onChange={(event) =>
                  setDraft({ ...draft, nameFa: event.target.value })
                }
              />
              <Input
                label={t("نام انگلیسی", "English name")}
                value={draft.nameEn}
                onChange={(event) =>
                  setDraft({ ...draft, nameEn: event.target.value })
                }
              />
            </div>
            <Picker
              label={t("مبنای اندازه‌گیری", "Reference basis")}
              value={draft.basis}
              choices={[
                { value: "per_100g", label: "100 g" },
                { value: "per_100ml", label: "100 mL" },
              ]}
              onChange={(basis) => setDraft({ ...draft, basis })}
            />
            <div className="columns">
              <Input
                label={t("نوع", "Variant")}
                value={draft.variant}
                onChange={(event) =>
                  setDraft({ ...draft, variant: event.target.value })
                }
              />
              <Input
                label={t("روش آماده‌سازی", "Preparation")}
                value={draft.preparation}
                onChange={(event) =>
                  setDraft({ ...draft, preparation: event.target.value })
                }
              />
            </div>
            <Input
              label={t("برند", "Brand")}
              value={draft.brand ?? ""}
              onChange={(event) =>
                setDraft({ ...draft, brand: event.target.value || null })
              }
            />
            <details>
              <summary className="button button--quiet">
                {t("مقادیر هر ۳۹ مادهٔ مغذی", "All 39 nutrient values")}
              </summary>
              <div className="columns">
                {nutrientKeys.map((key: NutrientKey) => (
                  <Input
                    key={key}
                    label={`${nutrientName(key, locale)} (${nutrientMetadata.find((row) => row.key === key)?.unit})`}
                    defaultValue={draft.nutrients[key]?.toString() ?? ""}
                    inputMode="decimal"
                    onBlur={(event) => {
                      const raw = event.target.value;
                      const amount = parseDecimal(raw);
                      if (raw.trim() && (amount === null || amount < 0)) {
                        setError(
                          t(
                            "مقدار مغذی معتبر نیست.",
                            "Invalid nutrient value.",
                          ),
                        );
                        return;
                      }
                      setDraft(
                        (previous) =>
                          previous && {
                            ...previous,
                            nutrients: { ...previous.nutrients, [key]: amount },
                          },
                      );
                    }}
                  />
                ))}
              </div>
            </details>
            {!!draft.evidence.length && (
              <div className="stack">
                <h3>{t("منابع", "Evidence")}</h3>
                {draft.evidence.map((row) => (
                  <a
                    key={row.evidenceId}
                    href={row.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {row.title}
                  </a>
                ))}
              </div>
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            <div className="actions">
              <Button type="submit">{t("ذخیره", "Save")}</Button>
              <Button tone="quiet" onClick={() => setDraft(null)}>
                {t("انصراف", "Cancel")}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </Page>
  );
}

function BackupPage() {
  const { t } = useCalio();
  return (
    <Page title={t("بکاپ", "Backup")}>
      <BackupTools library={false} />
    </Page>
  );
}

export default function Settings() {
  return (
    <Routes>
      <Route index element={<SettingsHome />} />
      <Route path="integrations" element={<Integrations />} />
      <Route path="library" element={<FoodLibrary />} />
      <Route path="library/calories" element={<CaloriePage />} />
      <Route path="backup" element={<BackupPage />} />
      <Route
        path="diagnostics"
        element={
          <Suspense fallback={null}>
            <Diagnostics />
          </Suspense>
        }
      />
    </Routes>
  );
}
