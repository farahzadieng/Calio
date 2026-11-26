import { useId, useState, type CSSProperties } from "react";
import { Picker } from "../ui/primitives";
import { useCalio } from "../../app/state";
import {
  formatDate,
  numberFormatter,
  numberingSystem,
} from "../../domain/dates";
import type { DailyInsight } from "../../domain/insights";

type Metric = "energy" | "macros" | "steps" | "distanceKm" | "drinkVolumeMl";
type Point = {
  name: string;
  style: "intake" | "expenditure" | "activity" | "protein" | "carbs" | "fat";
  value: number | null;
  partial?: boolean;
};

function axisLimit(peak: number) {
  if (peak <= 0) return 4;
  const tick = peak / 4;
  const order = 10 ** Math.floor(Math.log10(tick));
  const step = [1, 2, 2.5, 5, 10].find((value) => value * order >= tick) ?? 10;
  const ceiling = step * order * 4;
  return Number.isFinite(ceiling) && ceiling > 0 ? ceiling : peak;
}

export function InsightChart({ days }: { days?: readonly DailyInsight[] }) {
  const { locale, settings, t } = useCalio();
  const [metric, setMetric] = useState<Metric>("energy");
  const [selectedDate, setSelectedDate] = useState("");
  const id = useId();
  const choices = [
    { value: "energy", label: t("انرژی", "Energy") },
    { value: "macros", label: t("درشت‌مغذی‌ها", "Macronutrients") },
    { value: "steps", label: t("قدم‌ها", "Steps") },
    { value: "distanceKm", label: t("مسافت", "Distance") },
    { value: "drinkVolumeMl", label: t("حجم نوشیدنی", "Drink volume") },
  ] satisfies Array<{ value: Metric; label: string }>;
  const metricName = choices.find(({ value }) => value === metric)?.label ?? "";
  const unit = {
    energy: t("کیلوکالری", "kcal"),
    macros: t("گرم", "g"),
    steps: t("قدم", "steps"),
    distanceKm: t("کیلومتر", "km"),
    drinkVolumeMl: t("میلی‌لیتر", "mL"),
  }[metric];
  const intake = t("دریافت کالری", "Calorie intake");
  const expenditure = t("مصرف انرژی ثبت‌شده", "Measured energy expenditure");
  const subtitle = t(
    "مصرف انرژی از Apple Health، مجموع انرژی استراحت و فعالیت است.",
    "Energy expenditure is the sum of resting and active energy from Apple Health.",
  );
  const dash = t("داده در دسترس نیست", "No data");
  const partial = t(
    "جمعِ معلوم · دریافت ناقص",
    "Known subtotal · partial intake",
  );
  const number = numberFormatter(locale, { maximumFractionDigits: 2 });
  const shortDay = new Intl.DateTimeFormat(locale, {
    day: "numeric",
    calendar: settings.calendar,
    numberingSystem: numberingSystem(locale),
    timeZone: "UTC",
  });
  const rows = (days ?? []).map((day) => {
    const knownIntake = day.intake ?? day.food.totals.energy_kcal;
    const points: Point[] =
      metric === "energy"
        ? [
            {
              name: intake,
              style: "intake",
              value: knownIntake,
              partial: day.intake === null && knownIntake !== null,
            },
            { name: expenditure, style: "expenditure", value: day.expenditure },
          ]
        : metric === "macros"
          ? [
              {
                name: t("پروتئین", "Protein"),
                style: "protein",
                value: day.combined.totals.protein_g,
              },
              {
                name: t("کربوهیدرات", "Carbohydrates"),
                style: "carbs",
                value: day.combined.totals.carbohydrates_g,
              },
              {
                name: t("چربی", "Fat"),
                style: "fat",
                value: day.combined.totals.total_fat_g,
              },
            ]
          : [{ name: metricName, style: "activity", value: day[metric] }];
    return {
      date: day.date,
      label: formatDate(day.date, locale, settings.calendar),
      shortLabel: shortDay.format(new Date(`${day.date}T12:00:00Z`)),
      points,
    };
  });
  const selected =
    rows.find(({ date }) => date === selectedDate) ??
    [...rows]
      .reverse()
      .find(({ points }) => points.some(({ value }) => value !== null)) ??
    rows[0];
  const peak = Math.max(
    0,
    ...rows.flatMap(({ points }) => points.map(({ value }) => value ?? 0)),
  );
  const ceiling = axisLimit(peak);
  const anyValue = rows.some(({ points }) =>
    points.some(({ value }) => value !== null),
  );
  const anyPartial = rows.some(({ points }) =>
    points.some((point) => point.partial),
  );
  const anyMissing = rows.some(({ points }) =>
    points.some(({ value }) => value === null),
  );
  const series = rows[0]?.points ?? [];
  const labelEvery = rows.length > 8 ? Math.ceil(rows.length / 6) : 1;

  return (
    <section className="panel insight-chart" aria-labelledby={id}>
      <div className="row between">
        <h2 id={id}>
          {metric === "energy"
            ? t("دریافت و مصرف انرژی", "Energy intake and expenditure")
            : metricName}
        </h2>
        <Picker
          label={t("شاخص نمودار", "Chart metric")}
          value={metric}
          choices={choices}
          onChange={(next) => setMetric(next)}
        />
      </div>
      {metric === "energy" && <p className="muted small">{subtitle}</p>}
      {metric === "macros" && (
        <p className="muted small">
          {t(
            "جمع مقادیر معلوم برای هر مادهٔ مغذی.",
            "Known subtotals for each nutrient.",
          )}
        </p>
      )}
      {anyValue && (
        <div className="insight-chart-flow">
          <ul className="chart-legend">
            {series.map(({ style, name }) => (
              <li key={style}>
                <i
                  className={`chart-mark chart-mark--${style}`}
                  aria-hidden="true"
                />
                {name}
              </li>
            ))}
            {anyPartial && (
              <li>
                <i
                  className="chart-mark chart-mark--partial"
                  aria-hidden="true"
                />
                {partial}
              </li>
            )}
            {anyMissing && (
              <li>
                <i
                  className="chart-mark chart-mark--missing"
                  aria-hidden="true"
                />
                {dash}
              </li>
            )}
          </ul>
          <div
            className="insight-plot"
            dir="ltr"
            style={{ "--chart-days": rows.length } as CSSProperties}
            aria-hidden="true"
          >
            <div className="chart-axis">
              {[1, 0.75, 0.5, 0.25, 0].map((fraction) => (
                <span key={fraction}>{number.format(ceiling * fraction)}</span>
              ))}
            </div>
            <div className="chart-columns">
              {rows.map(({ date, points }) => (
                <div
                  key={date}
                  className="chart-column"
                  data-selected={date === selected?.date}
                >
                  {points.map(({ style, value, partial: isPartial }) => (
                    <span
                      key={style}
                      data-series={style}
                      data-availability={
                        value === null
                          ? "missing"
                          : value === 0
                            ? "zero"
                            : "known"
                      }
                      className={`chart-mark chart-mark--${value === null ? "missing" : isPartial ? "partial" : style}`}
                      style={
                        value !== null && value > 0
                          ? { height: `${(value / ceiling) * 100}%` }
                          : undefined
                      }
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="chart-dates">
              {rows.map(({ date, shortLabel }, index) => (
                <span key={date}>
                  {index % labelEvery === 0 || index === rows.length - 1
                    ? shortLabel
                    : ""}
                </span>
              ))}
            </div>
          </div>
          <p className="muted small chart-unit">{unit}</p>
        </div>
      )}
      {!anyValue && (
        <p className="muted">
          {days
            ? t(
                "برای این شاخص در این بازه داده‌ای ثبت نشده است.",
                "No values were logged for this metric in this period.",
              )
            : t("در حال خواندن داده‌ها…", "Loading data…")}
        </p>
      )}
      {anyValue && selected && (
        <div className="chart-detail">
          {rows.length > 1 ? (
            <Picker
              label={t("روزِ نمودار", "Chart date")}
              value={selected.date}
              choices={rows.map(({ date, label }) => ({ value: date, label }))}
              onChange={(date) => setSelectedDate(date)}
            />
          ) : (
            <p className="muted small">{selected.label}</p>
          )}
          <dl className="chart-readout" aria-live="polite">
            {selected.points.map(
              ({ name, style, value, partial: isPartial }) => (
                <div key={style}>
                  <dt className="muted small">{name}</dt>
                  <dd>
                    {value === null ? (
                      dash
                    ) : (
                      <>
                        <bdi className="metric">{number.format(value)}</bdi>{" "}
                        <span className="small">{unit}</span>
                      </>
                    )}
                  </dd>
                  {isPartial && <dd className="muted small">{partial}</dd>}
                </div>
              ),
            )}
          </dl>
        </div>
      )}
      {anyValue && rows.length > 1 && (
        <details>
          <summary className="button button--quiet">
            {t("جدول داده‌های نمودار", "Chart data table")}
          </summary>
          <div
            className="table-wrap"
            tabIndex={0}
            role="region"
            aria-label={t("جدول داده‌های نمودار", "Chart data table")}
          >
            <table aria-label={t("داده‌های نمودار", "Chart data")}>
              <thead>
                <tr>
                  <th scope="col">{t("تاریخ", "Date")}</th>
                  {series.map(({ style, name }) => (
                    <th key={style} scope="col">
                      {name} <span className="muted small">({unit})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map(({ date, label, points }) => (
                  <tr key={date}>
                    <th scope="row">{label}</th>
                    {points.map(({ style, value, partial: isPartial }) => (
                      <td key={style}>
                        {value === null ? (
                          dash
                        ) : (
                          <bdi>{number.format(value)}</bdi>
                        )}
                        {isPartial && (
                          <div className="muted small">{partial}</div>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </section>
  );
}
