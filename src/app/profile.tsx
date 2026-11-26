import { useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Link } from "react-router";
import { Pill, Settings2 } from "lucide-react";
import { Button, Input, Picker, Toggle } from "../components/ui/primitives";
import { DatePicker } from "../components/calio/date-picker";
import { estimateEnergy, type Profile } from "../domain/profile";
import { formatDate, numberFormatter, parseDecimal } from "../domain/dates";
import { saveProfile, saveWeight } from "../services/tracking";
import { activityChoices, goalChoices, physiologyChoices } from "./onboarding";
import { Page, useCalio } from "./state";

export default function ProfilePage() {
  const { db, profile, settings, today, notify, locale, t } = useCalio();
  const inputNumber = numberFormatter(locale, {
    maximumFractionDigits: 20,
    useGrouping: false,
  });
  const [name, setName] = useState(profile.firstName);
  const [age, setAge] = useState(() => inputNumber.format(profile.age));
  const [height, setHeight] = useState(() =>
    inputNumber.format(profile.heightCm),
  );
  const [goal, setGoal] = useState<Profile["goal"]>(profile.goal);
  const [activity, setActivity] = useState<Profile["activity"]>(
    profile.activity,
  );
  const [physiology, setPhysiology] = useState<
    "skip" | NonNullable<Profile["physiology"]>
  >(profile.physiology ?? "skip");
  const [estimates, setEstimates] = useState(profile.useWellnessEstimates);
  const [weight, setWeight] = useState("");
  const [weightDate, setWeightDate] = useState(today);
  const [profileError, setProfileError] = useState("");
  const [weightError, setWeightError] = useState("");
  const weights = useLiveQuery(
    () => db.weight_logs.orderBy("localDate").reverse().limit(12).toArray(),
    [db],
    [],
  );
  const estimate = estimateEnergy(profile);
  const number = numberFormatter(locale, { maximumFractionDigits: 1 });
  async function submitProfile(event: FormEvent) {
    event.preventDefault();
    try {
      if (!name.trim()) throw new Error("profile_name");
      const { weightKg } = profile;
      await saveProfile(
        db,
        {
          firstName: name,
          age: parseDecimal(age) ?? 0,
          heightCm: parseDecimal(height) ?? 0,
          weightKg,
          activity,
          goal,
          physiology: physiology === "skip" ? null : physiology,
          useWellnessEstimates: estimates,
        },
        settings,
        today,
      );
      setProfileError("");
      notify("پروفایل به‌روزرسانی شد.", "Profile updated.", "success");
    } catch {
      setProfileError(
        t(
          "نام، سن بزرگسالی و قد معتبر وارد کنید.",
          "Enter a name, an adult age, and a valid height.",
        ),
      );
    }
  }
  async function recordWeight(event: FormEvent) {
    event.preventDefault();
    const kg = parseDecimal(weight);
    if (kg === null || kg <= 0) {
      setWeightError(
        t(
          "وزن را به کیلوگرم وارد کنید.",
          "Enter a positive weight in kilograms.",
        ),
      );
      return;
    }
    try {
      await saveWeight(db, { localDate: weightDate, time: null, kg });
      if (weightDate === today)
        await db.profile.update("profile", {
          weightKg: kg,
          updatedAt: new Date().toISOString(),
        });
      setWeight("");
      setWeightError("");
      notify("وزن ثبت شد.", "Weight logged.", "success");
    } catch {
      setWeightError(t("وزن ذخیره نشد.", "Weight could not be saved."));
    }
  }
  return (
    <Page
      title={t("پروفایل", "Profile")}
      subtitle={t(
        "اطلاعات، هدف و وزن‌های ثبت‌شدهٔ شما.",
        "Your information, goals, and weight history.",
      )}
      actions={
        <div className="actions">
          <Link to="/profile/supplements" className="button button--quiet">
            <Pill size={17} aria-hidden />
            {t("مکمل‌ها", "Supplements")}
          </Link>
          <Link to="/settings" className="button button--quiet">
            <Settings2 size={17} aria-hidden />
            {t("تنظیمات", "Settings")}
          </Link>
        </div>
      }
    >
      <form
        className="panel form"
        noValidate
        onSubmit={(event) => void submitProfile(event)}
      >
        <h2>{t("اطلاعات پایه", "Personal details")}</h2>
        <Input
          label={t("نام", "First name")}
          autoComplete="given-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <div className="columns">
          <Input
            label={t("سن", "Age")}
            inputMode="numeric"
            value={age}
            onChange={(event) => setAge(event.target.value)}
          />
          <Input
            label={t("قد (سانتی‌متر)", "Height (cm)")}
            inputMode="decimal"
            value={height}
            onChange={(event) => setHeight(event.target.value)}
          />
        </div>
        <div className="columns">
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
        </div>
        <Picker
          label={t("مرجع فیزیولوژیک", "Physiological reference")}
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
        {profileError && (
          <p role="alert" className="field-error">
            {profileError}
          </p>
        )}
        <div className="actions">
          <Button type="submit">{t("ذخیرهٔ پروفایل", "Save profile")}</Button>
        </div>
      </form>
      <section className="panel">
        <h2>{t("برآورد انرژی", "Energy estimate")}</h2>
        {estimate ? (
          <div className="columns">
            <div>
              <p className="muted">{t("استراحت", "Resting")}</p>
              <p className="metric">
                {number.format(estimate.restingKcal)}{" "}
                <span className="small">kcal</span>
              </p>
            </div>
            <div>
              <p className="muted">{t("کل روز", "Daily total")}</p>
              <p className="metric">
                {number.format(estimate.dailyKcal)}{" "}
                <span className="small">kcal</span>
              </p>
            </div>
          </div>
        ) : (
          <p className="muted">
            {t(
              "برای این پروفایل برآوردی نمایش داده نمی‌شود.",
              "No estimate is available for this profile.",
            )}
          </p>
        )}
        {estimate && (
          <p className="muted small">
            {t(
              "برآورد تقریبی Mifflin–St Jeor؛ دادهٔ اندازه‌گیری‌شدهٔ Health جداگانه در تحلیل دیده می‌شود.",
              "Approximate Mifflin–St Jeor estimate. Measured Health data is shown in Insights.",
            )}
          </p>
        )}
      </section>
      <form
        className="panel form"
        onSubmit={(event) => void recordWeight(event)}
        noValidate
      >
        <h2>{t("ثبت وزن", "Log weight")}</h2>
        <DatePicker value={weightDate} onChange={setWeightDate} />
        <Input
          label={t("وزن (کیلوگرم)", "Weight (kg)")}
          inputMode="decimal"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          error={weightError}
        />
        <div className="actions">
          <Button type="submit">{t("ذخیرهٔ وزن", "Save weight")}</Button>
        </div>
        <ul className="rows">
          {weights.map((row) => (
            <li className="row-item row between" key={row.id}>
              <span>
                {formatDate(row.localDate, locale, settings.calendar)}
              </span>
              <bdi>
                {number.format(row.kg)} {t("کیلوگرم", "kg")}
              </bdi>
            </li>
          ))}
        </ul>
      </form>
    </Page>
  );
}
