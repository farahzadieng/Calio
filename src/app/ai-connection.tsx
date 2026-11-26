import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { Button, Input, Toggle } from "../components/ui/primitives";
import {
  GatewayTransport,
  readAiSettings,
  saveAiSettings,
} from "../ai/browser";
import {
  aiSettingsUpdateSchema,
  defaultAiProvider,
  type AiSettings,
} from "../ai/configuration";
import { AiFailure, validateExtract } from "../ai/contracts";
import { requestAi } from "../ai/request";
import {
  parseCalorieAnswer,
  type CalorieTarget,
} from "../domain/calorie-lookup";
import { sha256 } from "../services/hash";
import { useCalio } from "./state";

type Status = "loading" | "unavailable" | "ready" | "saved";
type Failure = "input" | "key" | "save" | "probe" | "citations";

export function AiConnection() {
  const { db, locale, settings, today, t } = useCalio();
  const [draft, setDraft] = useState(defaultAiProvider);
  const [stored, setStored] = useState<AiSettings | null>(null);
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<Failure | null>(null);
  const [testing, setTesting] = useState<"calories" | "extract" | null>(null);
  const [tested, setTested] = useState<"calories" | "extract" | null>(null);
  const [saving, setSaving] = useState(false);
  const keyInput = useRef<HTMLInputElement>(null);
  const busy = saving || !!testing;

  useEffect(() => {
    let active = true;
    void readAiSettings()
      .then((configuration) => {
        if (!active) return;
        setStored(configuration);
        setDraft({
          baseUrl: configuration.baseUrl,
          model: configuration.model,
          calorieModel: configuration.calorieModel,
        });
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("unavailable");
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setTested(null);
    const apiKey = keyInput.current?.value.trim();
    const parsed = aiSettingsUpdateSchema.safeParse({
      ...draft,
      apiKey: apiKey || undefined,
    });
    if (!parsed.success) {
      setError("input");
      return;
    }
    const changesProvider =
      stored !== null && stored.baseUrl !== parsed.data.baseUrl;
    if (!apiKey && (changesProvider || !stored?.hasKey)) {
      setError("key");
      keyInput.current?.focus();
      return;
    }
    setSaving(true);
    if (keyInput.current) keyInput.current.value = "";
    try {
      if (changesProvider && settings.aiConsentAt) {
        await db.settings.update("settings", { aiConsentAt: null });
      }
      const next = await saveAiSettings(parsed.data);
      setStored(next);
      setDraft({
        baseUrl: next.baseUrl,
        model: next.model,
        calorieModel: next.calorieModel,
      });
      setStatus("saved");
    } catch (failure) {
      setError(
        failure instanceof AiFailure && failure.code === "ai_key_required"
          ? "key"
          : "save",
      );
    } finally {
      setSaving(false);
    }
  }

  async function probe(operation: "calories" | "extract") {
    if (!stored?.enabled || !settings.aiConsentAt) return;
    setTesting(operation);
    setError(null);
    setTested(null);
    try {
      const transport = await GatewayTransport.connect();
      if (!transport) throw new Error("ai_gateway");
      const key = await sha256(crypto.randomUUID());
      if (operation === "extract") {
        const input = {
          locale,
          entries: [
            {
              entry_id: "test-synthetic",
              revision: 1,
              local_date: today,
              text: "Synthetic connectivity test. I did not eat or drink anything.",
            },
          ],
        };
        const response = await requestAi(db, transport, "extract", input, key);
        validateExtract(response.output, input);
      } else {
        const input: CalorieTarget = {
          nameFa: "",
          nameEn: "banana",
          variant: "",
          preparation: "raw",
          brand: null,
          basis: "per_100g",
        };
        const response = await requestAi(db, transport, "calories", input, key);
        const answer = parseCalorieAnswer(response.output, input);
        if (answer.status !== "known" || !response.evidence.length) {
          setError("citations");
          return;
        }
      }
      setTested(operation);
    } catch {
      setError("probe");
    } finally {
      setTesting(null);
    }
  }

  const messages: Record<Failure, string> = {
    input: t(
      "نشانی پایهٔ HTTPS یا نام مدل معتبر نیست.",
      "Enter a valid HTTPS base URL and model IDs.",
    ),
    key: t(
      "برای این نشانی، کلید API وارد کنید.",
      "Enter an API key for this base URL.",
    ),
    save: t(
      "تنظیمات اتصال ذخیره نشد.",
      "The connection settings could not be saved.",
    ),
    probe: t(
      "پاسخ معتبر از مدل دریافت نشد. کلید، نشانی و نام مدل را بررسی کنید.",
      "The model did not return a valid response. Check the key, URL and model ID.",
    ),
    citations: t(
      "مدل جست‌وجو پاسخ داد ولی منبع قابل‌تأیید نداشت.",
      "The search model replied without a verifiable source.",
    ),
  };

  return (
    <section className="panel form">
      <h2>{t("اتصال هوش مصنوعی", "AI connection")}</h2>
      <p className="muted">
        {t(
          "نشانی پایهٔ یک API سازگار با OpenAI و دو نام مدل را تنظیم کنید. مقادیر اولیه برای IranRouter آماده‌اند.",
          "Use an OpenAI-compatible API base URL and two model IDs. The initial values are set for IranRouter.",
        )}
      </p>
      <form className="form" onSubmit={(event) => void save(event)} noValidate>
        <Input
          label={t("نشانی پایهٔ API", "API base URL")}
          type="url"
          value={draft.baseUrl}
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          disabled={busy || status === "loading"}
          onChange={(event) =>
            setDraft({ ...draft, baseUrl: event.target.value })
          }
        />
        <div className="columns">
          <Input
            label={t("مدل تحلیل و گزارش", "Analysis and reporting model")}
            dir="ltr"
            value={draft.model}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || status === "loading"}
            onChange={(event) =>
              setDraft({ ...draft, model: event.target.value })
            }
          />
          <Input
            label={t("مدل جست‌وجوی کالری", "Calorie search model")}
            dir="ltr"
            value={draft.calorieModel}
            spellCheck={false}
            autoComplete="off"
            disabled={busy || status === "loading"}
            onChange={(event) =>
              setDraft({ ...draft, calorieModel: event.target.value })
            }
          />
        </div>
        <Input
          label={t("کلید API", "API key")}
          type="password"
          ref={keyInput}
          dir="ltr"
          spellCheck={false}
          autoComplete="off"
          maxLength={4096}
          disabled={busy || status === "loading" || status === "unavailable"}
          hint={
            stored?.hasKey
              ? t(
                  "کلید ذخیره شده است. برای نگه‌داشتن آن این کادر را خالی بگذارید.",
                  "A key is saved. Leave this blank to keep it.",
                )
              : undefined
          }
        />
        <div className="actions">
          <Button type="submit" disabled={busy || !stored}>
            {saving
              ? t("در حال ذخیره…", "Saving…")
              : t("ذخیرهٔ اتصال", "Save connection")}
          </Button>
        </div>
      </form>
      <Toggle
        label={t("رضایت پردازش توسط AI", "Consent to AI processing")}
        enabled={!!settings.aiConsentAt}
        onChange={(enabled) => {
          void db.settings.update("settings", {
            aiConsentAt: enabled ? new Date().toISOString() : null,
          });
        }}
      />
      <p className="muted small">
        {t(
          "با رضایت شما، متن لازم و خلاصهٔ گزارش به ارائه‌دهندهٔ انتخابی می‌رسد. مدل جست‌وجو فقط مشخصات خوراکی را دریافت می‌کند. کلید در سرویس محلی نگهداری می‌شود.",
          "With your consent, the selected provider receives relevant text and report data. The search model receives food details only. Your key is kept by the local service.",
        )}
      </p>
      <p role="status" className="muted">
        {status === "loading" &&
          t("در حال خواندن وضعیت اتصال…", "Checking connection settings…")}
        {status === "unavailable" &&
          t(
            "سرویس محلی تنظیمات اتصال در دسترس نیست.",
            "The local connection settings service is unavailable.",
          )}
        {status === "saved" &&
          t("تنظیمات اتصال ذخیره شد.", "Connection settings saved.")}
        {tested === "extract" &&
          t("آزمون مدل تحلیل موفق بود.", "The analysis model test passed.")}
        {tested === "calories" &&
          t(
            "مدل جست‌وجو کالری همراه با منبع برگرداند.",
            "The search model returned calories with a source.",
          )}
      </p>
      {error && (
        <p role="alert" className="field-error">
          {messages[error]}
        </p>
      )}
      {stored?.enabled && (
        <div className="actions">
          <Button
            tone="quiet"
            disabled={busy || !settings.aiConsentAt}
            onClick={() => void probe("extract")}
          >
            {t("آزمون مدل تحلیل", "Test analysis model")}
          </Button>
          <Button
            tone="quiet"
            disabled={busy || !settings.aiConsentAt}
            onClick={() => void probe("calories")}
          >
            {t("آزمون مدل جست‌وجو", "Test search model")}
          </Button>
          <p className="muted small">
            {t(
              "هر آزمون یک درخواست API می‌فرستد و ممکن است هزینه داشته باشد.",
              "Each test sends one API request and may incur a charge.",
            )}
          </p>
        </div>
      )}
      <Link
        className="button button--quiet settings-link"
        to="/settings/diagnostics"
      >
        {t("عیب‌یابی", "Diagnostics")}
      </Link>
    </section>
  );
}
