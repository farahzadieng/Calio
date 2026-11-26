import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpenText,
  ChartNoAxesCombined,
  Coffee,
  HeartPulse,
} from "lucide-react";
import { Button, Input, Picker, Toggle } from "../components/ui/primitives";
import type { CalioDatabase } from "../db/database";
import {
  dateInTimeZone,
  parseDecimal,
  timeZoneSchema,
  type Calendar,
  type Locale,
} from "../domain/dates";
import { type Profile } from "../domain/profile";
import { saveProfile } from "../services/tracking";
import { choose } from "./state";

type Tx = ReturnType<typeof choose>;

export const activityChoices = (t: Tx) =>
  [
    { value: "sedentary", label: t("کم‌تحرک", "Sedentary") },
    { value: "light", label: t("سبک", "Light") },
    { value: "moderate", label: t("متوسط", "Moderate") },
    { value: "high", label: t("زیاد", "High") },
    { value: "very_high", label: t("خیلی زیاد", "Very high") },
  ] satisfies Array<{ value: Profile["activity"]; label: string }>;
export const goalChoices = (t: Tx) =>
  [
    { value: "understand", label: t("شناخت عادت‌ها", "Understand my habits") },
    { value: "maintain", label: t("حفظ وزن", "Maintain weight") },
    { value: "lose", label: t("کاهش وزن", "Lose weight") },
    { value: "gain", label: t("افزایش وزن", "Gain weight") },
  ] satisfies Array<{ value: Profile["goal"]; label: string }>;
export const physiologyChoices = (t: Tx) =>
  [
    { value: "skip", label: t("ترجیح می‌دهم پاسخ ندهم", "Prefer to skip") },
    { value: "female", label: t("مرجع زن", "Female reference") },
    { value: "male", label: t("مرجع مرد", "Male reference") },
  ] satisfies Array<{
    value: "skip" | NonNullable<Profile["physiology"]>;
    label: string;
  }>;

export function Brand({ locale }: { locale: Locale }) {
  return (
    <span className="brand">
      <img
        className="logo-light"
        src="/assets/brand/icon-light-192.png"
        alt=""
        width="44"
        height="44"
      />
      <img
        className="logo-dark"
        src="/assets/brand/icon-dark-192.png"
        alt=""
        width="44"
        height="44"
      />
      {locale === "fa" ? "کالیو" : "Calio"}
    </span>
  );
}

export default function Onboarding({
  db,
  locale,
  setLocale,
}: {
  db: CalioDatabase;
  locale: Locale | null;
  setLocale: (locale: Locale | null) => void;
}) {
  const t = choose(locale ?? "fa");
  const heading = useRef<HTMLHeadingElement>(null);
  const [showGuide, setShowGuide] = useState(true);
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [age, setAge] = useState("");
  const [height, setHeight] = useState("");
  const [weight, setWeight] = useState("");
  const [activity, setActivity] = useState<Profile["activity"]>("light");
  const [goal, setGoal] = useState<Profile["goal"]>("understand");
  const [physiology, setPhysiology] = useState<
    "skip" | NonNullable<Profile["physiology"]>
  >("skip");
  const [estimates, setEstimates] = useState(true);
  const [calendar, setCalendar] = useState<Calendar>("persian");
  const [zone, setZone] = useState("Asia/Tehran");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    heading.current?.focus();
  }, [locale, showGuide, step]);

  const selectLanguage = (selected: Locale) => {
    setCalendar(selected === "fa" ? "persian" : "gregory");
    setLocale(selected);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const next: Record<string, string> = {};
    const parsedAge = parseDecimal(age);
    const parsedHeight = parseDecimal(height);
    const parsedWeight = parseDecimal(weight);
    if (step === 0) {
      if (!name.trim())
        next.firstName = t("نام را وارد کنید.", "Enter your first name.");
      if (
        parsedAge === null ||
        !Number.isInteger(parsedAge) ||
        parsedAge < 18 ||
        parsedAge > 130
      ) {
        next.age = t(
          "سن باید عددی بین ۱۸ تا ۱۳۰ باشد.",
          "Enter a whole age between 18 and 130.",
        );
      }
      if (parsedHeight === null || parsedHeight <= 0)
        next.height = t(
          "قد را به سانتی‌متر وارد کنید.",
          "Enter a positive height in centimeters.",
        );
      if (parsedWeight === null || parsedWeight <= 0)
        next.weight = t(
          "وزن را به کیلوگرم وارد کنید.",
          "Enter a positive weight in kilograms.",
        );
    }
    if (step === 2 && !timeZoneSchema.safeParse(zone).success) {
      next.zone = t(
        "نام منطقهٔ زمانی معتبر وارد کنید.",
        "Enter a valid time zone, such as Asia/Tehran.",
      );
    }
    setErrors(next);
    const firstError = Object.keys(next)[0];
    if (firstError) {
      form.querySelector<HTMLElement>(`[name="${firstError}"]`)?.focus();
      return;
    }
    if (step < 2) {
      setStep(step + 1);
      return;
    }
    if (
      !locale ||
      parsedAge === null ||
      parsedHeight === null ||
      parsedWeight === null
    )
      return;
    setSaving(true);
    try {
      await saveProfile(
        db,
        {
          firstName: name,
          age: parsedAge,
          heightCm: parsedHeight,
          weightKg: parsedWeight,
          activity,
          goal,
          physiology: physiology === "skip" ? null : physiology,
          useWellnessEstimates: estimates,
        },
        {
          locale,
          calendar,
          timeZone: zone,
          theme: "system",
          reduceMotion: false,
          aiConsentAt: null,
          healthShortcutName: "HealthKit-Bridge",
        },
        dateInTimeZone(new Date(), zone),
      );
      void navigator.storage?.persist?.().catch(() => false);
    } catch {
      setErrors({
        general: t(
          "ذخیرهٔ پروفایل ممکن نشد.",
          "The profile could not be saved.",
        ),
      });
    } finally {
      setSaving(false);
    }
  }

  if (!locale)
    return (
      <main className="onboard language-entry">
        <Brand locale="en" />
        <div className="panel">
          <div className="stack tight">
            <h1 lang="fa" ref={heading} tabIndex={-1}>
              زبان را انتخاب کنید
            </h1>
            <p className="muted" lang="en">
              Choose your language
            </p>
          </div>
          <div className="columns">
            <Button lang="fa" onClick={() => selectLanguage("fa")}>
              فارسی
              <ArrowLeft size={17} aria-hidden />
            </Button>
            <Button lang="en" tone="quiet" onClick={() => selectLanguage("en")}>
              English
              <ArrowRight size={17} aria-hidden />
            </Button>
          </div>
        </div>
      </main>
    );

  if (showGuide) {
    const topics = [
      {
        Icon: BookOpenText,
        title: t("دفترچه", "Journal"),
        description: t(
          "خوراک روز را بنویسید و ذخیره کنید.",
          "Write down what you ate and save it.",
        ),
      },
      {
        Icon: Coffee,
        title: t("نوشیدنی و مکمل", "Drinks and supplements"),
        description: t(
          "نوشیدنی با یک لمس، مکمل از دفترچه.",
          "Log drinks in one tap and supplements from the journal.",
        ),
      },
      {
        Icon: HeartPulse,
        title: t("Apple Health اختیاری", "Optional Apple Health"),
        description: t(
          "قدم‌ها و انرژی مصرفی را از تنظیمات وارد کنید.",
          "Import steps and energy burned from Settings.",
        ),
      },
      {
        Icon: ChartNoAxesCombined,
        title: t("تحلیل", "Insights"),
        description: t(
          "نمودارها و روند ثبت‌ها را ببینید.",
          "See charts and trends in your entries.",
        ),
      },
    ];
    return (
      <main className="onboard route-enter" lang={locale}>
        <Brand locale={locale} />
        <section className="panel">
          <h1 ref={heading} tabIndex={-1}>
            {t("راهنمای شروع", "Quick start")}
          </h1>
          <ul className="rows onboard-guide-list" role="list">
            {topics.map(({ Icon, title, description }) => (
              <li className="row-item" key={title}>
                <Icon size={20} aria-hidden />
                <div>
                  <h2>{title}</h2>
                  <p className="muted small">{description}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="actions">
            <Button onClick={() => setShowGuide(false)}>
              {t("شروع راه‌اندازی", "Start setup")}
            </Button>
            <Button tone="quiet" onClick={() => setLocale(null)}>
              {t("تغییر زبان", "Change language")}
            </Button>
          </div>
        </section>
      </main>
    );
  }

  const headings = [
    t("دربارهٔ شما", "About you"),
    t("هدف و فعالیت", "Goals and activity"),
    t("تنظیمات دفترچه", "Journal preferences"),
  ];
  return (
    <main className="onboard route-enter" lang={locale}>
      <Brand locale={locale} />
      <div
        className="onboard-progress"
        role="progressbar"
        aria-label={t("پیشرفت راه‌اندازی", "Setup progress")}
        aria-valuemin={0}
        aria-valuemax={3}
        aria-valuenow={step + 1}
      >
        {headings.map((_, index) => (
          <span data-filled={index <= step} key={index} />
        ))}
      </div>
      <form
        className="panel form"
        noValidate
        onSubmit={(event) => void submit(event)}
      >
        <h1 ref={heading} tabIndex={-1}>
          {headings[step]}
        </h1>
        {step === 0 && (
          <>
            <Input
              label={t("نام", "First name")}
              autoComplete="given-name"
              name="firstName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              error={errors.firstName}
            />
            <Input
              label={t("سن", "Age")}
              name="age"
              inputMode="numeric"
              value={age}
              onChange={(event) => setAge(event.target.value)}
              error={errors.age}
            />
            <div className="columns">
              <Input
                label={t("قد (سانتی‌متر)", "Height (cm)")}
                name="height"
                inputMode="decimal"
                value={height}
                onChange={(event) => setHeight(event.target.value)}
                error={errors.height}
              />
              <Input
                label={t("وزن (کیلوگرم)", "Weight (kg)")}
                name="weight"
                inputMode="decimal"
                value={weight}
                onChange={(event) => setWeight(event.target.value)}
                error={errors.weight}
              />
            </div>
          </>
        )}
        {step === 1 && (
          <>
            <Picker
              label={t("سطح فعالیت", "Activity level")}
              value={activity}
              choices={activityChoices(t)}
              onChange={setActivity}
            />
            <Picker
              label={t("هدف", "Goal")}
              value={goal}
              choices={goalChoices(t)}
              onChange={setGoal}
            />
            <Picker
              label={t(
                "متغیر فیزیولوژیک برای برآورد",
                "Physiological reference for estimates",
              )}
              value={physiology}
              choices={physiologyChoices(t)}
              onChange={setPhysiology}
            />
            <Toggle
              label={t(
                "نمایش برآورد انرژی برای بزرگسالان",
                "Show adult energy estimates",
              )}
              enabled={estimates}
              onChange={setEstimates}
            />
            <p className="muted small">
              {t(
                "در بارداری، شیردهی یا شرایط پزشکی، برآورد خودکار را خاموش کنید و از متخصص راهنمایی بگیرید.",
                "During pregnancy, lactation, or a medical condition, turn estimates off and seek qualified guidance.",
              )}
            </p>
          </>
        )}
        {step === 2 && (
          <>
            <Picker
              label={t("تقویم نمایشی", "Display calendar")}
              value={calendar}
              choices={[
                { value: "persian", label: t("شمسی", "Solar Hijri") },
                { value: "gregory", label: t("میلادی", "Gregorian") },
              ]}
              onChange={setCalendar}
            />
            <Input
              label={t("منطقهٔ زمانی", "Time zone")}
              name="zone"
              value={zone}
              dir="ltr"
              onChange={(event) => setZone(event.target.value)}
              error={errors.zone}
            />
            <p className="muted">
              {t(
                "یادداشت‌ها روی همین دستگاه می‌مانند. Apple Health و AI را می‌توانید بعداً در تنظیمات فعال کنید.",
                "Your notes stay on this device. You can set up Apple Health and AI later in Settings.",
              )}
            </p>
          </>
        )}
        {errors.general && (
          <p className="field-error" role="alert">
            {errors.general}
          </p>
        )}
        <div className="actions">
          <Button type="submit" disabled={saving}>
            {step === 2
              ? t("ورود به دفترچه", "Open journal")
              : t("ادامه", "Continue")}
          </Button>
          <Button
            tone="quiet"
            onClick={() => {
              setErrors({});
              if (step === 0) setShowGuide(true);
              else setStep(step - 1);
            }}
          >
            {t("بازگشت", "Back")}
          </Button>
        </div>
      </form>
    </main>
  );
}
