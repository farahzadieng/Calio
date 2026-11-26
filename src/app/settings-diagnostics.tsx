import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Button } from "../components/ui/primitives";
import { CalioDatabase } from "../db/database";
import { GatewayTransport } from "../ai/browser";
import { requestAi } from "../ai/request";
import { validateExtract } from "../ai/contracts";
import { DemoTransport } from "../ai/demo";
import extractFixture from "../../fixtures/extract-input.json";
import healthFixture from "../../fixtures/health-valid.txt?raw";
import { saveNote } from "../services/journal";
import { importHealthText } from "../services/health-import";
import { processNotes } from "../services/food-processing";
import { processForegroundWeeks } from "../services/weekly";
import { exportBackup, fullFormat, previewRestore } from "../services/backup";
import { prepareMonthlyConsultation } from "../services/monthly";
import {
  recordDiagnostic,
  redactedDiagnostics,
  testMessage,
} from "../services/diagnostics";
import { sha256 } from "../services/hash";
import { Page, useCalio } from "./state";

const demo = new CalioDatabase("demo");
const fixtureDate = new Date("2026-11-08T12:00:00Z");
const period = { id: "2026-11-01", start: "2026-11-01", end: "2026-11-07" };
const caseDate = { localDate: "2026-11-01", time: null };

async function demoNotes() {
  const existing = await demo.journal_entries.toArray();
  if (existing.length) return existing;
  return Promise.all(
    extractFixture.entries.map((row) =>
      saveNote(demo, {
        ...caseDate,
        localDate: row.local_date,
        text: row.text,
      }),
    ),
  );
}

export default function Diagnostics() {
  const { db, t, locale, settings, notify } = useCalio();
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState("");
  const history = useLiveQuery(() => redactedDiagnostics(demo), [], []);

  function run(code: string, task: () => Promise<boolean>) {
    setWorking(true);
    setResult("");
    void task()
      .then(async (ok) => {
        const blocked =
          !ok &&
          code === "live_ai" &&
          (!settings.aiConsentAt || !(await GatewayTransport.connect()));
        await recordDiagnostic(demo, {
          code,
          test: true,
          outcome: ok ? "success" : blocked ? "blocked" : "failed",
        });
        setResult(
          ok
            ? t("آزمایشی · موفق", "TEST · passed")
            : blocked
              ? t(
                  "آزمایشی · پیش‌نیاز فراهم نیست",
                  "TEST · blocked by prerequisites",
                )
              : t("آزمایشی · ناموفق", "TEST · failed"),
        );
      })
      .catch(async () => {
        await recordDiagnostic(demo, { code, test: true, outcome: "failed" });
        setResult(t("آزمایشی · ناموفق", "TEST · failed"));
      })
      .finally(() => setWorking(false));
  }

  const tests = [
    [
      "ai_pipeline",
      t("آزمون پردازش AI ساختگی", "Test synthetic AI pipeline"),
      async () => {
        await processNotes(demo, new DemoTransport(), {
          locale,
          explicit: true,
          notes: await demoNotes(),
        });
        return (await demo.meal_items.count()) > 0;
      },
    ],
    [
      "health_sample",
      t("آزمون نمونهٔ Health", "Test Health sample"),
      async () => {
        const value = await importHealthText(
          demo,
          healthFixture,
          {
            minimumRestingKcal: 300,
            timeZone: "Asia/Tehran",
            missingToken: null,
          },
          fixtureDate,
        );
        return value.count === 3;
      },
    ],
    [
      "weekly_sample",
      t("آزمون گزارش هفتگی", "Test weekly report"),
      async () => {
        await demoNotes();
        await importHealthText(
          demo,
          healthFixture,
          {
            timeZone: "Asia/Tehran",
            minimumRestingKcal: 300,
            missingToken: null,
          },
          fixtureDate,
        );
        const result = await processForegroundWeeks(demo, new DemoTransport(), {
          locale,
          now: fixtureDate,
          visible: true,
          online: true,
          policy: {
            firstStart: period.start,
            minimumFreshDays: 2,
            timeZone: "Asia/Tehran",
          },
        });
        return result.some(({ state }) => state === "ready");
      },
    ],
    [
      "monthly_sample",
      t("آزمون متن مشاورهٔ ماهانه", "Test monthly consultation"),
      async () => {
        const result = await prepareMonthlyConsultation(demo, period, {
          locale,
          timeZone: "Asia/Tehran",
          includeReferenceDemographics: false,
          policy: {
            coefficient: 5000,
            modelName: "synthetic",
            modelVersion: "1",
            caveat: "Demo only",
            minimumPairedDayRatio: 1 / 31,
            discrepancyThresholdKg: 2,
          },
        });
        return (
          result.comparison.offerPrompt &&
          result.prompt.includes("paired_day_coverage")
        );
      },
    ],
    [
      "backup_sample",
      t("آزمون بکاپ و بازیابی", "Test backup round-trip"),
      async () => {
        const original = await demoNotes();
        const source = await exportBackup(demo, fullFormat);
        const receiver = new CalioDatabase(
          "demo",
          `backup-${crypto.randomUUID()}`,
        );
        try {
          const restore = await previewRestore(
            receiver,
            source,
            fullFormat,
            "merge",
          );
          await restore.commit();
          const restored = await receiver.journal_entries.bulkGet(
            original.map(({ id }) => id),
          );
          return (
            restore.conflicts.length === 0 &&
            restored.every(
              (note, index) => note?.text === original[index]?.text,
            )
          );
        } finally {
          await receiver.delete();
        }
      },
    ],
    [
      "offline_sample",
      t("آزمون آفلاین و تلاش دوباره", "Test offline and retry"),
      async () => {
        const item = extractFixture.entries[0];
        if (!item) return false;
        const note = await saveNote(demo, {
          ...caseDate,
          localDate: "2026-10-24",
          text: item.text,
        });
        const input = { locale, explicit: true, notes: [note] };
        const offline = await processNotes(
          demo,
          new DemoTransport("offline"),
          input,
        );
        if (offline[0]?.error !== "ai_offline") return false;
        const resumed = await processNotes(demo, new DemoTransport(), input);
        return resumed[0]?.status !== "failed" && resumed.length === 1;
      },
    ],
    [
      "live_ai",
      t("آزمون اتصال زنده", "Test live connection"),
      async () => {
        if (!settings.aiConsentAt) return false;
        const transport = await GatewayTransport.connect();
        if (!transport) return false;
        const input = {
          locale,
          entries: [
            {
              entry_id: "test-synthetic",
              revision: 1,
              local_date: period.start,
              text: "Synthetic connectivity diagnostic. I did not eat anything in this test.",
            },
          ],
        };
        const response = await requestAi(
          db,
          transport,
          "extract",
          input,
          await sha256(JSON.stringify(["diagnostic", crypto.randomUUID()])),
        );
        return (
          validateExtract(response.output, input).entries[0]?.items.length === 0
        );
      },
    ],
  ] as const;

  return (
    <Page
      title={t("عیب‌یابی", "Diagnostics")}
      subtitle={t(
        "آزمون‌های بالینی نیستند. نتایج آزمایشی از دادهٔ شخصی جدا هستند.",
        "Tests use isolated demo data.",
      )}
    >
      <section className="panel">
        <h2>{t("آزمون پیام‌ها", "Message tests")}</h2>
        <div className="actions">
          {(
            [
              ["success", t("موفق", "Success")],
              ["info", t("اطلاع", "Info")],
              ["warning", t("هشدار", "Warning")],
              ["error", t("خطا", "Error")],
            ] as const
          ).map(([kind, label]) => (
            <Button
              key={kind}
              tone="quiet"
              onClick={() => {
                void testMessage(demo, kind).then(() =>
                  notify(`آزمایشی · ${label}`, `TEST · ${label}`, kind),
                );
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>{t("آزمون کارکردها", "Workflow tests")}</h2>
        <div className="actions">
          {tests.map(([code, label, task]) => (
            <Button
              key={code}
              tone="quiet"
              disabled={working}
              onClick={() => run(code, task)}
            >
              {label}
            </Button>
          ))}
        </div>
        <p role="status">
          {working ? t("در حال آزمون…", "Running test…") : result}
        </p>
      </section>
      <section className="panel">
        <h2>{t("تاریخچهٔ بدون اطلاعات شخصی", "Redacted history")}</h2>
        <ul>
          {history.slice(0, 12).map((row, index) => (
            <li key={`${row.createdAt}:${index}`} className="row-item">
              <bdi>
                {row.code} · {row.outcome}
              </bdi>
            </li>
          ))}
        </ul>
        <div className="actions">
          <Button
            tone="quiet"
            onClick={() => {
              void navigator.clipboard
                .writeText(JSON.stringify(history, null, 2))
                .then(() =>
                  notify(
                    "گزارش عیب‌یابی کپی شد.",
                    "Diagnostic report copied.",
                    "success",
                  ),
                )
                .catch(() =>
                  notify("کپی ممکن نشد.", "Copy was unavailable.", "warning"),
                );
            }}
          >
            {t("کپی گزارش", "Copy diagnostics")}
          </Button>
          <Button
            tone="quiet"
            disabled={working}
            onClick={() => {
              void demo
                .transaction("rw", demo.tables, () =>
                  Promise.all(demo.tables.map((table) => table.clear())),
                )
                .then(() => {
                  setResult("");
                  notify(
                    "دادهٔ آزمایشی پاک شد.",
                    "Demo data cleared.",
                    "success",
                  );
                });
            }}
          >
            {t("پاک کردن دادهٔ آزمایشی", "Clear demo data")}
          </Button>
        </div>
      </section>
    </Page>
  );
}
