# Architecture and implementation contract

Calio uses React, TypeScript and Vite, with React Router and Base UI controls adapted from PersianLabs. Dexie reads and writes IndexedDB, with separate real and demo databases. Zod and versioned JSON Schemas validate local records and provider payloads. The Node adapter serves static PWA files. The browser calls the configured OpenAI-compatible HTTPS provider directly.

```text
React UI → application services → Dexie → IndexedDB
                              ├→ local calculations, jobs and manual backups
                              ├→ read-only Apple Health clipboard import
                              └→ consented browser AI transport → HTTPS provider
```

Workbox precaches the static shell, font and illustrations. AI responses and sensitive endpoints stay outside the cache. The local journal is available without AI. Versioned prompt templates and response contracts ship with the PWA. Provider keys live in a device-local IndexedDB table outside backup serialization. The install manifest supplies square icon artwork, a stable app ID and standalone display. System install behavior is described in [Deployment](DEPLOYMENT.md). The design and motion contract is summarized in [AGENT.md](../AGENT.md).

## DB entities
IDs UUID; timestamps UTC ISO, diary dates Gregorian ISO YYYY-MM-DD local timezone, date-only without UTC conversion. schemaVersion + migrations, unique natural keys where specified.
- profile/settings: personal data, consent, locale, calendar, theme, timezone and cycle.
- ai_connection: device-only API key, HTTPS base URL, model IDs and connection revision. Excluded from backups and diagnostics.
- journal_entries: id, localDate, text, optional time, revision, status, createdAt/updatedAt. parsed_entries: entryId+revision, promptVersion, structured extraction, assumptions. meal_items: entryId+revision+itemId, foodId, portionId, qty, original unit, grams, snapshot of nutrient reference/provenance and confidence.
- foods: foodId, normalized canonical names fa/en, variant/prep/brand, nutrition per 100g or 100mL, evidence per nutrient, confidence, version. aliases normalized to foodId; portions key foodId+variant+unit with grams or mL, source/range/confidence. Never merge different foods or ambiguous units by fuzzy name only. Immutable reference snapshots preserve history when library changes.
- drinks, supplement_products, supplement_logs, weight_logs: dated events, label evidence and explicit units; prevent double counting. nutrient_references: versioned RDA/AI/UL/limit, demographic applicability, units and official source.
- health_daily: date unique, resting/active kcal, steps, distance km, status per field, importedAt/source. health_imports: timestamp, date range, diagnostic summary, fingerprint; raw clipboard optionally local only, not required.
- processing_queue: idempotencyKey, period, input revision hash, stage, attempt, lease, error, result; ai_reports: week/month period+revision, structured report, coverage, promptVersion, status; api_usage: model, token counts, duration, status, requestId, no raw content. messages: type, period, severity, seen state, action; diagnostics bounded ring buffer (redacted). backup metadata optional.

## Job state machine
pending -> extracting -> matching -> researching -> validating -> calculating -> awaiting_health -> reporting -> ready. Offline/retryable/failed and needs_review branches are persisted, resumable. Manual food processing stops after calculation, no weekly report until due. Each completed week job has stable key period + relevant revisions; use transaction/lease and cross-tab lock where available, no duplicate report; crash recovery must not duplicate items. Persist stages/results before continuing. Backoff capped, 429 retry-after, timeout, abort, explicit retry on failures, malformed outputs not committed. If a new revision arrives during request, discard stale response. Changes invalidate affected reports; ask before regenerating previously issued AI report if it costs extra. Batch pending notes with chunk limits; cache extraction by exact revision+prompt/model version, research by food/variant/basis/portion evidence. Never send full DB to AI. Fresh sync required before weekly report; manual nutritional extraction independent. Month check uses completed reports or recomputed local aggregates, not AI invented totals.

## Transport interface
`extract(input)`, `resolveFood(input)`, `resolvePortion(input)`, `weeklyReport(input)`; real and deterministic mock. Request envelope operation, requestId/idempotencyKey, schemaVersion, input, language; response output, usage, provider/model, requestId, tool evidence. The browser transport validates input/output, requires explicit consent, rejects redirects, and sends the API key in the Authorization header only to the configured provider. The provider must allow credential-header JSON requests via CORS. Search connector must return actual tool-fetched source metadata. Treat fetched pages as untrusted data (prompt injection). No URL fetched directly from model without allowlist/SSRF defenses. Use verified tool support, don't assume OpenCode/OpenRouter offers search. Return capability missing if not available; preserve notes. Real prompt files in prompts/ and exact schemas in schemas/. System prompts come from versioned application files.

## Local calculations
Use pure functions and unit tests. Match confident references and known portion first; unknown portions never convert without evidence. Scale per-100g/mL values by consumed amount / 100. Do not convert volume to mass without density. Snapshot calculation input versions. Sum known values with coverage, unknown stays null if none known. Activity total = resting + active only; no extra step calories or TDEE added. Reference fallback separately labeled. Details NUTRITION.md.
