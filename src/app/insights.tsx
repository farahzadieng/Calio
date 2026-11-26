import { correctFoodAmount } from "../services/meal-corrections";
import { applicableReferences } from "../domain/references";
import { lazy, Suspense, useState } from "react";
import { Link, NavLink, Route, Routes, useParams } from "react-router";
import { useLiveQuery } from "dexie-react-hooks";
import { ArrowRight, ClipboardCopy } from "lucide-react";
import {
  Button,
  Modal,
  Textarea,
  Input,
  Picker,
} from "../components/ui/primitives";
import { DatePicker } from "../components/calio/date-picker";
import { InsightChart } from "../components/calio/insight-chart";
import type { MealItem, Period } from "../db/records";
import { alignedWeekStart, calendarMonth } from "../domain/calendar-periods";
import {
  formatDate,
  numberFormatter,
  localDate,
  shiftDate,
  parseDecimal,
} from "../domain/dates";
import {
  nutrientKeys,
  nutrientMetadata,
  sodiumToSalt,
  type NutrientKey,
} from "../domain/nutrition";
import { weekly as isWeekly } from "../generated/validate.mjs";
import { aggregateDays, periodSnapshot } from "../services/insights";
import { prepareMonthlyConsultation } from "../services/monthly";
import { nutrientName } from "./nutrient-labels";
import { Page, useCalio } from "./state";
import { runOnForeground } from "./processing";

const ReportReveal = lazy(() => import("../components/calio/report-reveal"));
const prominent: NutrientKey[] = [
  "protein_g",
  "carbohydrates_g",
  "total_fat_g",
  "dietary_sugar_g",
  "fiber_g",
  "sodium_mg",
];

function useNumber() {
  const { locale } = useCalio();
  const format = numberFormatter(locale, { maximumFractionDigits: 2 });
  return (value: number | null | undefined) =>
    value == null ? "—" : format.format(value);
}

function HeadingLinks({ date }: { date: string }) {
  const { locale, t } = useCalio();
  const week = alignedWeekStart(date, locale);
  const month = calendarMonth(date, locale, -1);
  const routes = [
    [`/insights/day/${date}`, t("روزانه", "Daily")],
    [`/insights/week/${week}`, t("هفتگی", "Weekly")],
    [`/insights/month/${month.start}`, t("ماهانه", "Monthly")],
  ];
  return (
    <nav
      className="actions insight-tabs"
      aria-label={t("بازهٔ تحلیل", "Insight period")}
    >
      {routes.map(
        ([url, label]) =>
          url && (
            <NavLink key={url} to={url} className="button button--quiet">
              {label}
            </NavLink>
          ),
      )}
    </nav>
  );
}

function SummaryMetrics({
  metrics,
}: {
  metrics: Array<{
    label: string;
    value: number | null | undefined;
    unit?: string;
  }>;
}) {
  const number = useNumber();
  return (
    <dl className="metric-grid">
      {metrics.map(({ label, value, unit }) => (
        <div className="metric-cell" key={label}>
          <dt className="muted small">{label}</dt>
          <dd className="metric">
            <bdi>{number(value)}</bdi>
            {value != null && unit && (
              <>
                {" "}
                <span className="small">{unit}</span>
              </>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function CorrectFood({ item, close }: { item: MealItem; close: () => void }) {
  const { db, t, locale, notify } = useCalio();
  const [reference, setReference] = useState(item.foodId ?? "");
  const [grams, setGrams] = useState(item.grams?.toString() ?? "");
  const [ml, setMl] = useState(item.ml?.toString() ?? "");
  const [error, setError] = useState("");
  const foods = useLiveQuery(() => db.foods.toArray(), [db], []);
  return (
    <Modal
      title={t("اصلاح مقدار خوراکی", "Correct food amount")}
      open
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <form
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const amount = { grams: parseDecimal(grams), ml: parseDecimal(ml) };
          if (
            (grams.trim() && (amount.grams === null || amount.grams <= 0)) ||
            (ml.trim() && (amount.ml === null || amount.ml <= 0))
          ) {
            setError(
              t("مقدار باید عددی مثبت باشد.", "Enter a positive amount."),
            );
            return;
          }
          void correctFoodAmount(db, item, { foodId: reference, ...amount })
            .then(() => {
              notify("اصلاح ذخیره شد.", "Correction saved.", "success");
              close();
            })
            .catch(() =>
              setError(
                t(
                  "مرجع و مقدار متناسب با واحد آن را وارد کنید.",
                  "Choose a reference and enter an amount in its unit.",
                ),
              ),
            );
        }}
      >
        <Picker
          label={t("خوراکی از کتابخانه", "Food from library")}
          value={reference}
          onChange={setReference}
          choices={[
            { value: "", label: t("انتخاب مرجع", "Choose a reference") },
            ...foods.map((food) => ({
              value: food.id,
              label: `${locale === "fa" ? food.nameFa || food.nameEn : food.nameEn || food.nameFa} · ${food.basis === "per_100g" ? "100 g" : "100 mL"}`,
            })),
          ]}
        />
        <div className="columns">
          <Input
            label={t("جرم (گرم)", "Mass (g)")}
            inputMode="decimal"
            value={grams}
            onChange={(event) => setGrams(event.target.value)}
          />
          <Input
            label={t("حجم (میلی‌لیتر)", "Volume (mL)")}
            inputMode="decimal"
            value={ml}
            onChange={(event) => setMl(event.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <div className="actions">
          <Button type="submit">{t("ذخیرهٔ اصلاح", "Save correction")}</Button>
          <Link className="button button--quiet" to="/settings/library">
            {t("کتابخانه", "Food library")}
          </Link>
          <Button tone="quiet" onClick={close}>
            {t("انصراف", "Cancel")}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DailyView() {
  const { date: routeDate } = useParams();
  const { today, db, settings, t, locale } = useCalio();
  const [selected, setSelected] = useState(today);
  const [expanded, setExpanded] = useState(false);
  const [correction, setCorrection] = useState<MealItem | null>(null);
  const date = localDate.safeParse(routeDate).success ? routeDate! : selected;
  const [override, setOverride] = useState<string | null>(null);
  const shown = override ?? date;
  const snapshot = useLiveQuery(
    () => periodSnapshot(db, { id: shown, start: shown, end: shown }),
    [db, shown],
  );
  const day = snapshot?.days[0];
  const values = day?.combined;
  const health = snapshot?.health[0];
  const number = useNumber();
  const shownNutrients = expanded ? nutrientKeys : prominent;
  return (
    <Page
      title={t("تحلیل روزانه", "Daily insights")}
      subtitle={t(
        "دریافت غذایی و فعالیت ثبت‌شدهٔ هر روز.",
        "Logged food intake and activity by date.",
      )}
      actions={
        <DatePicker
          value={shown}
          step
          onChange={(next) => {
            setSelected(next);
            setOverride(next);
          }}
        />
      }
    >
      <HeadingLinks date={shown} />
      <InsightChart days={snapshot?.days} />
      <section className="panel">
        <h2>{formatDate(shown, locale, settings.calendar)}</h2>
        <SummaryMetrics
          metrics={[
            {
              label: t("تراز انرژی", "Energy balance"),
              value: day?.balance,
              unit: "kcal",
            },
            { label: t("قدم", "Steps"), value: day?.steps },
            {
              label: t("مسافت", "Distance"),
              value: day?.distanceKm,
              unit: "km",
            },
            {
              label: t("نوشیدنی ثبت‌شده", "Logged drinks"),
              value: day?.drinkVolumeMl,
              unit: "mL",
            },
          ]}
        />
        {!health && (
          <p className="muted">
            {t(
              "برای این روز دادهٔ Apple Health موجود نیست.",
              "Apple Health data is missing for this date.",
            )}
          </p>
        )}
        {health && day?.expenditure === null && (
          <p className="notice notice--warning">
            {t(
              "دادهٔ انرژی این روز ناقص یا مشکوک است.",
              "Energy data for this date is incomplete or unusual.",
            )}
          </p>
        )}
      </section>
      <section className="panel">
        <h2>{t("مواد مغذی ثبت‌شده", "Logged nutrients")}</h2>
        <p className="muted small">
          {t(
            "خط تیره نشان‌دهندهٔ مقدار نامعلوم است. جمع‌ها فقط از مقادیر شناخته‌شده‌اند.",
            "A dash marks an unknown value. Totals use known values only.",
          )}
        </p>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t("جدول مواد مغذی", "Nutrient table")}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t("مادهٔ مغذی", "Nutrient")}</th>
                <th scope="col">{t("غذا", "Food")}</th>
                <th scope="col">{t("مکمل", "Supplement")}</th>
                <th scope="col">{t("جمع معلوم", "Known total")}</th>
              </tr>
            </thead>
            <tbody>
              {shownNutrients.map((key) => {
                const unit = nutrientMetadata.find(
                  (row) => row.key === key,
                )?.unit;
                return (
                  <tr key={key}>
                    <th scope="row">
                      {nutrientName(key, locale)}{" "}
                      <bdi className="muted small">{unit}</bdi>
                    </th>
                    <td>
                      <bdi>{number(day?.food.totals[key])}</bdi>
                    </td>
                    <td>
                      <bdi>{number(day?.supplements.totals[key])}</bdi>
                    </td>
                    <td>
                      <bdi>{number(values?.totals[key])}</bdi>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="row between">
          <p>
            {t("معادل نمک", "Salt equivalent")}{" "}
            <bdi>
              {number(sodiumToSalt(values?.totals.sodium_mg ?? null))} g
            </bdi>
          </p>
          <p>
            {t("قند افزودهٔ معلوم", "Known added sugar")}{" "}
            <bdi>{number(day?.addedSugarG)} g</bdi>
          </p>
        </div>
        <div className="actions">
          <Button tone="quiet" onClick={() => setExpanded(!expanded)}>
            {expanded
              ? t("نمایش خلاصه", "Show summary")
              : t("نمایش هر ۳۹ مادهٔ مغذی", "Show all 39 nutrients")}
          </Button>
        </div>
      </section>
      {!!snapshot?.meals.length && (
        <section className="panel">
          <h2>{t("خوراکی‌های پردازش‌شده", "Processed food items")}</h2>
          {snapshot.meals.map((item) => (
            <article
              key={`${item.entryId}:${item.itemId}`}
              className="row-item"
            >
              <h3>
                {locale === "fa"
                  ? item.nameFa || item.nameEn
                  : item.nameEn || item.nameFa}
              </h3>
              <p className="muted">
                {number(item.originalQuantity)} <bdi>{item.originalUnit}</bdi> ·{" "}
                {number(item.grams)} g
              </p>
              {item.status !== "calculated" && (
                <p className="field-hint">
                  {t(
                    "مقدار یا ترکیب قطعی نیست.",
                    "Amount or composition is uncertain.",
                  )}
                </p>
              )}
              {item.excludedFromTotals ? (
                <Link
                  to="/profile/supplements"
                  className="button button--quiet"
                >
                  {t("بررسی برچسب مکمل", "Review supplement label")}
                </Link>
              ) : (
                <div className="actions">
                  <Button tone="quiet" onClick={() => setCorrection(item)}>
                    {t("اصلاح مقدار", "Correct amount")}
                  </Button>
                  {item.nutrients.energy_kcal === null && (
                    <Link
                      className="button button--quiet"
                      to="/settings/library/calories"
                      state={{
                        entryId: item.entryId,
                        revision: item.revision,
                        itemId: item.itemId,
                      }}
                    >
                      {t("پیدا کردن کالری", "Find calories")}
                    </Link>
                  )}
                </div>
              )}
            </article>
          ))}
        </section>
      )}
      {correction && (
        <CorrectFood item={correction} close={() => setCorrection(null)} />
      )}
    </Page>
  );
}

function PeriodNavigation({
  period,
  kind,
}: {
  period: Period;
  kind: "week" | "month";
}) {
  const { locale, settings, t } = useCalio();
  const prev =
    kind === "week"
      ? shiftDate(period.start, -7)
      : calendarMonth(period.start, locale, -1).start;
  const next =
    kind === "week"
      ? shiftDate(period.start, 7)
      : calendarMonth(period.start, locale, 1).start;
  return (
    <div className="row between">
      <Link className="button button--quiet" to={`/insights/${kind}/${prev}`}>
        {t("بازهٔ قبل", "Previous period")}
      </Link>
      <p className="muted small">
        {formatDate(period.start, locale, settings.calendar)} –{" "}
        {formatDate(period.end, locale, settings.calendar)}
      </p>
      <Link className="button button--quiet" to={`/insights/${kind}/${next}`}>
        {t("بازهٔ بعد", "Next period")}
        <ArrowRight size={17} className="directional" aria-hidden />
      </Link>
    </div>
  );
}

function WeeklyView() {
  const { period: raw } = useParams();
  const { db, today, locale, settings, t, notify } = useCalio();
  const start =
    raw && localDate.safeParse(raw).success
      ? raw
      : alignedWeekStart(today, locale);
  const stored = useLiveQuery(
    () => db.ai_reports.get(raw ?? start),
    [db, raw, start],
  );
  const period = stored?.period ?? {
    id: start,
    start,
    end: shiftDate(start, 6),
  };
  const snapshot = useLiveQuery(
    () => periodSnapshot(db, period),
    [db, period.start, period.end],
  );
  const ready =
    stored?.status === "ready" && isWeekly(stored.output)
      ? stored.output
      : null;
  const reduced =
    settings.reduceMotion ||
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const number = useNumber();
  const days = snapshot?.days ?? [];
  const totals = aggregateDays(days, "combined");
  const [refreshing, setRefreshing] = useState(false);
  const [allNutrients, setAllNutrients] = useState(false);
  const refs = applicableReferences(
    snapshot?.profile,
    snapshot?.references ?? [],
  );

  return (
    <Page
      title={t("تحلیل هفتگی", "Weekly insights")}
      subtitle={t(
        "گزارش، پوشش داده‌ها و روند ثبت‌ها.",
        "Your report, data coverage, and logged trends.",
      )}
    >
      <HeadingLinks date={period.start} />
      <PeriodNavigation period={period} kind="week" />
      <InsightChart days={snapshot?.days} />
      <section className="panel">
        <h2>{t("میانگین مواد مغذی", "Daily nutrient averages")}</h2>
        <div
          className="table-wrap"
          tabIndex={0}
          role="region"
          aria-label={t("جدول میانگین مواد مغذی", "Nutrient averages table")}
        >
          <table>
            <thead>
              <tr>
                <th scope="col">{t("ماده", "Nutrient")}</th>
                <th scope="col">{t("میانگین", "Average")}</th>
                <th scope="col">{t("روزهای معلوم", "Known days")}</th>
                <th scope="col">{t("مقادیر مرجع", "References")}</th>
              </tr>
            </thead>
            <tbody>
              {(allNutrients ? nutrientKeys : prominent).map((key) => (
                <tr key={key}>
                  <th scope="row">{nutrientName(key, locale)}</th>
                  <td>{number(totals.dailyAverages[key])}</td>
                  <td>{number(totals.coverage[key].knownDays)}</td>
                  <td>
                    {refs
                      .filter((row) => row.key === key)
                      .map((row) => (
                        <div key={row.id}>
                          <bdi>
                            {row.kind} {number(row.amount)} {row.unit}
                          </bdi>
                          {row.scope === "supplement"
                            ? t(" · مکمل", " · supplement")
                            : ""}
                        </div>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="muted small">
          {t(
            "میانگین بر اساس روزهایی است که مقدار مادهٔ مغذی ثبت شده است.",
            "Each average uses the days with a known value for that nutrient.",
          )}
        </p>
        <div className="actions">
          <Button tone="quiet" onClick={() => setAllNutrients(!allNutrients)}>
            {allNutrients
              ? t("نمایش خلاصه", "Show summary")
              : t("نمایش هر ۳۹ مادهٔ مغذی", "Show all 39 nutrients")}
          </Button>
        </div>
      </section>
      <section className="panel">
        <h2>{t("گزارش هفتگی", "Weekly report")}</h2>
        {ready ? (
          <>
            <Suspense fallback={null}>
              <ReportReveal reduceMotion={reduced} />
            </Suspense>
            <h3>{ready.title}</h3>
            <p>{ready.summary}</p>
            <p>{ready.energy_activity}</p>
            {[...ready.strengths, ...ready.attention].map((row, index) => (
              <p key={index}>{row.finding}</p>
            ))}
            {ready.lifestyle_associations.map((row, index) => (
              <p key={index}>
                {row.observation} · {row.possible_relationship} ·{" "}
                {row.limitations}
              </p>
            ))}
            {ready.actions.map((row, index) => (
              <p key={index}>
                {row.suggestion} · {row.rationale}
              </p>
            ))}
            {ready.data_gaps.map((gap, index) => (
              <p className="muted" key={index}>
                {gap}
              </p>
            ))}
            <p>{ready.professional_guidance}</p>
          </>
        ) : (
          <>
            <p className="muted">
              {stored?.status === "stale"
                ? t(
                    "داده‌های این بازه بعد از صدور گزارش تغییر کرده‌اند.",
                    "Data changed after this report was issued.",
                  )
                : t(
                    "هنوز گزارشی برای این بازه ذخیره نشده است.",
                    "No report is saved for this period yet.",
                  )}
            </p>
            <div className="actions">
              <Link
                className="button button--quiet"
                to="/settings/integrations"
              >
                {t("همگام‌سازی Health", "Sync Health")}
              </Link>
              {stored?.status === "stale" && (
                <Button
                  disabled={refreshing}
                  onClick={() => {
                    setRefreshing(true);
                    void runOnForeground(db, period.id)
                      .then((rows) => {
                        if (
                          !rows.some(
                            ({ period: changed, state }) =>
                              changed.id === period.id && state === "ready",
                          )
                        )
                          notify(
                            "گزارش دوباره صادر نشد.",
                            "The report was not regenerated.",
                            "warning",
                          );
                      })
                      .catch(() =>
                        notify(
                          "بازپردازش انجام نشد.",
                          "Regeneration failed.",
                          "error",
                        ),
                      )
                      .finally(() => setRefreshing(false));
                  }}
                >
                  {t("بازپردازش گزارش با AI", "Regenerate with AI")}
                </Button>
              )}
            </div>
          </>
        )}
      </section>
    </Page>
  );
}

const monthlyPolicy = {
  coefficient: 5000,
  modelName: "calio.owner-static-5000",
  modelVersion: "1",
  caveat:
    "Owner-selected, unvalidated static comparison. Only paired days are used. No extrapolation or intake prescription.",
  minimumPairedDayRatio: 1 / 366,
  discrepancyThresholdKg: 2,
};

function MonthlyView() {
  const { period: raw } = useParams();
  const { db, today, settings, locale, t, notify } = useCalio();
  const period =
    raw && localDate.safeParse(raw).success
      ? calendarMonth(raw, locale)
      : calendarMonth(today, locale, -1);
  const data = useLiveQuery(
    () =>
      prepareMonthlyConsultation(db, period, {
        locale,
        timeZone: settings.timeZone,
        includeReferenceDemographics: false,
        policy: monthlyPolicy,
      }),
    [db, period.start, period.end, locale, settings.timeZone],
  );
  const [preview, setPreview] = useState(false);
  const number = useNumber();
  return (
    <Page title={t("مقایسهٔ ماهانهٔ وزن", "Monthly weight comparison")}>
      <HeadingLinks date={today} />
      <PeriodNavigation period={period} kind="month" />
      <InsightChart days={data?.days} />
      <section className="panel">
        <SummaryMetrics
          metrics={[
            {
              label: t("تغییر ثبت‌شده", "Observed change"),
              value: data?.comparison.actualDeltaKg,
              unit: "kg",
            },
            {
              label: t("تغییر برآوردی", "Estimated change"),
              value: data?.comparison.estimatedDeltaKg,
              unit: "kg",
            },
            {
              label: t("اختلاف", "Discrepancy"),
              value: data?.comparison.discrepancyKg,
              unit: "kg",
            },
          ]}
        />
        <p className="muted">
          {t(
            "مدل سفارشی و اعتبارسنجی‌نشده، ۵۰۰۰ کیلوکالری بر کیلوگرم.",
            "Custom, unvalidated model: 5,000 kcal per kilogram.",
          )}
        </p>
        <p>
          {number(data?.comparison.pairedDays)}{" "}
          {t("روز دادهٔ جفت‌شده از", "paired days out of")}{" "}
          {number(data?.comparison.totalDays)}
        </p>
        {data && (data.startingKg === null || data.endingKg === null) && (
          <Link className="button button--quiet" to="/profile">
            {t(
              "ثبت وزن در تاریخ شروع یا پایان",
              "Log missing start or end weight",
            )}
          </Link>
        )}
        {data?.comparison.offerPrompt && (
          <Button tone="quiet" onClick={() => setPreview(true)}>
            {t("پیش‌نمایش متن مشاوره", "Preview consultation prompt")}
          </Button>
        )}
      </section>
      <Modal
        open={preview}
        onOpenChange={setPreview}
        title={t("متن مشاوره", "Consultation prompt")}
        description={t(
          "متن را قبل از کپی بررسی کنید. Calio آن را جایی ارسال نمی‌کند.",
          "Review the text before copying. Calio does not send it.",
        )}
      >
        <Textarea
          label={t("متن قابل کپی", "Prompt to copy")}
          value={data?.prompt ?? ""}
          readOnly
          rows={8}
          dir="auto"
        />
        <div className="actions">
          <Button
            onClick={() => {
              if (!data) return;
              void navigator.clipboard
                .writeText(data.prompt)
                .then(() => notify("متن کپی شد.", "Prompt copied.", "success"))
                .catch(() =>
                  notify(
                    "دسترسی کلیپ‌بورد ممکن نیست؛ متن را انتخاب و کپی کنید.",
                    "Clipboard is unavailable. Select and copy the text.",
                    "warning",
                  ),
                );
            }}
          >
            <ClipboardCopy size={17} aria-hidden />
            {t("کپی", "Copy")}
          </Button>
          <Button tone="quiet" onClick={() => setPreview(false)}>
            {t("بستن", "Close")}
          </Button>
        </div>
      </Modal>
    </Page>
  );
}

export default function Insights() {
  return (
    <Routes>
      <Route index element={<DailyView />} />
      <Route path="day/:date" element={<DailyView />} />
      <Route path="week/:period" element={<WeeklyView />} />
      <Route path="month/:period" element={<MonthlyView />} />
    </Routes>
  );
}
