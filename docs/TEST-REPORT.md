# Calio acceptance test report

Run date: 2026-11-26, Asia/Tehran. Workspace checkout had no Git metadata, so no commit ID is available. App workflows used isolated synthetic data in fresh browser contexts or fake IndexedDB. The live provider capability probe used a public documentation question only.

## Executed checks

| Command or check | Outcome |
|---|---|
| `uv run --no-project --with jsonschema --with pillow python tests/verify_package.py` | Passed the handoff schemas, fixture data, empty library, approved image dimensions, and supplied Bon web font package. |
| `npm ci` | Clean lockfile installation completed. |
| `npm run format:check`, `npm run lint`, `npm run typecheck` | Passed. |
| `npm test` | 40 passed across domain, component, IndexedDB integration, and gateway tests with a synthetic upstream. |
| `npm run build`, `npm run build:server` | Production client, Workbox service worker, and Node adapter built. Vite printed non-blocking notices for misplaced optimizer annotations in Zod. |
| `npm audit` | Zero reported vulnerabilities in the installed dependency tree. |
| `CALIO_CHROMIUM_CHANNEL=chrome npm run test:e2e` | 8 passed, 4 each in Chromium and WebKit, including offline reload, 320px calendar and axe. |
| Node production smoke | HTML, manifest and service worker returned 200, an unauthenticated AI request returned 403, CSP was present, and Chromium initialized the offline cache without browser errors. |
| IranRouter live capability probe | HTTP 200 with model `openai/gpt-6-luna`. The model reported browsing unavailable, with zero tool calls and zero citation annotations. No authenticated live application integration or food research succeeded. |
| IranRouter Luna Pro and Luna Pro Batch probes | The same public query sent to `openai/gpt-6-luna-pro` and `openai/gpt-6-luna-pro:batch` through `/api/v1/chat/completions` returned HTTP 402 with a credit-related error for both. Neither probe returned a model response, so search capability and Batch compatibility remain unverified. |
| IranRouter six-model calorie lookup after the reported top-up | One live request per model, using only a public USDA raw-banana prompt. `openai/gpt-6-luna` returned 200 within 4.2 seconds, with null calorie and source fields and no tool calls or structured citations. `openai/gpt-6-luna-pro`, `openai/gpt-6-luna-pro:batch`, `perplexity/sonar`, `perplexity/sonar-pro`, and `perplexity/sonar-pro-search` each returned HTTP 402 `insufficient_credits`. A read-only `/api/v1/key` check identified the tested key as free-tier, listed Luna among its free models, and reported `limit_remaining: 0`. No paid-model output or machine-readable calorie source was verified. |
| IranRouter six-model retest with replacement key | The key endpoint returned HTTP 200 with positive remaining credit. One live request per model used the same public prompt. `openai/gpt-6-luna` (4.3 s) and `openai/gpt-6-luna-pro` (6.0 s) returned HTTP 200 with null calorie and source and no tool metadata. `openai/gpt-6-luna-pro:batch` returned HTTP 400 `model_not_supported` on `/chat/completions`. `perplexity/sonar` (5.0 s), `perplexity/sonar-pro` (4.9 s), and `perplexity/sonar-pro-search` (9.4 s) each returned HTTP 200, **89 kcal per 100 g**, and structured `annotations` containing [USDA FoodData Central item 173944](https://fdc.nal.usda.gov/portal-data/external/173944). The energy value agrees with [USDA SR28, item 09040](https://www.ars.usda.gov/ARSUserFiles/80400535/Data/SR/SR28/reports/sr28fg09.pdf). Calio's local application and unauthenticated gateway still returned 200 and 403 respectively after the server restart. |

Browser engine coverage uses installed Google Chrome and Playwright WebKit on macOS. Playwright's bundled Chromium download was denied by the CDN for this location. Configuring the installed Chrome channel enabled Chromium-based test execution. Neither browser verifies a physical iPhone.

## Acceptance matrix

| ID | Status | Verified coverage and remaining checks |
|---|---|---|
| T01 | Verified locally | Language-first onboarding, synthetic profile persistence, required adult inputs, approximate REE/TDEE and skipped physiology. |
| T02 | Verified locally | Persian note and digits, navigation and reload with an unsaved draft, offline save, edit draft retained while switching routes, delete, historical date, and no save-triggered AI request. |
| T03 | Partial | Completed Persian/English week alignment, missed windows in order, offline gating, multi-tab leases, retryable synthetic timeout and explicit manual processing. Provider-billed idempotency after a restart remains unverified. |
| T04 | Verified with fixtures | Expected negation and symptom extraction fixture, rejection of invalid schema, added fields, and foreign IDs. Provider semantic accuracy requires live model evaluation. |
| T05 | Partial | Exact food and portion reuse, variant separation, unresolved search, source validation and local recipe arithmetic. Plain Sonar now supplies energy only. Generic multi-nutrient and portion search still lack a configured connector. |
| T06 | Verified locally | All 39 fields, known subtotal versus null, g/mL basis, no volume-to-mass assumption, sodium-to-salt, separate added sugar and food/supplement values. |
| T07 | Verified locally | Valid and malformed imports, lengths, duplicate dates, negative/nonfinite values, partial day, suspect energy, replay, correction, atomic rollback, and no deletion outside incoming dates. |
| T08 | Physical device pending | Exact launch URL and manual paste tested in desktop browsers. Launch, clipboard denial, cancellation and return from the actual iPhone Shortcut await device testing. |
| T09 | Verified with fixtures | Awaiting Health before report, stale coverage handling, report validation and persistence, one ready message across tabs, edit invalidation. |
| T10 | Partial | Schema, evidence IDs, null/coverage treatment, bad-output and retry behavior tested with fixtures. Language model reliability and fresh evidence retrieval require a live-capable configuration. |
| T11 | Verified locally | Custom 5,000 kcal/kg comparison path, 2 kg threshold, signed changes and paired coverage math, missing weights, localized local prompt and clipboard preview. No automatic send. |
| T12 | Partial | Drinks and supplements independently persisted, edits, missing doses/caffeine, versioned supplement label snapshots, verified Vitamin D IU conversion, and a drink-to-journal reconciliation path. Full mixed-entry duplicate testing remains pending. |
| T13 | Verified locally | Empty new food library, JSON/CSV round-trip, CSV formula escaping, merge/replace preview, corrupted/future payload rejection and stale preview rollback. |
| T14 | Partial | RTL/LTR, both calendar displays, week/month boundaries, Tehran and DST date handling, keyboard dialog escape, a 44 px day cell at 320 px, and an automated axe scan. System screen reader and native 200% zoom coverage remain pending. |
| T15 | Partial | Bon local font loaded offline, light/dark/system support, automated contrast scan in the dark journal, custom input/select/modal surfaces, and synthetic messages. Full visual coverage of every state remains pending. |
| T16 | Partial | Reduced-motion preference and route control verified in browsers. Bounded Remotion reveal ships in a lazy chunk. A live report motion review and slow-device timing remain pending. |
| T17 | Partial | Manifest and icon sizes, offline shell/fonts, synthetic note data retained over reload, no cached API route, backup and persistence control. Real upgrade and eviction/quota recovery on iOS remain pending. |
| T18 | Partial | Synthetic gateway verifies origin/authentication, operation allowlist, body/schema validation, no-store API, consent off and demo isolation. Live upstream search prompt-injection tests are blocked. |
| T19 | Verified with fixtures | Synthetic AI pipeline, Health, weekly, monthly, backup and offline/retry buttons passed in both browsers. The real connection button accurately reported disabled configuration. |
| T20 | Partial | 320, 375, 390, 430 and desktop viewport coverage, mobile calendar, final build and local production smoke. Physical iOS standalone and an HTTPS deployment are pending. |

Reference screenshots are captured on the synthetic app state: [Persian light mobile](screenshots/journal-fa-light.png), [English dark desktop](screenshots/journal-en-dark.png).

## 2026-11-26 — Calorie lookup regression

| Check | Outcome |
|---|---|
| Formatting, lint, typecheck, browser build and Node build | Passed. Vite reported the existing non-blocking Zod optimizer notices. |
| Vitest | 45 passed. Checks include strict pasted JSON, matching food and reference basis, HTTPS source validation, publication/brand matching, offline cache reuse, single provider request for concurrent callers, local portion arithmetic, and routing only calories to plain Sonar. A calorie sourced at 123 kcal per 100 g produced 61.5 kcal for a synthetic 50 g logged item. |
| Chrome and WebKit, default build | 10 passed, including the Persian offline reference, malformed paste rejection, valid paste review and persistence, and the axe scan. The two API UI cases ran separately. |
| Chrome and WebKit, AI-enabled synthetic build | 2 passed. A same-origin intercepted response supplied energy with a matching source. A repeated lookup reused the saved result without requesting the gateway again. Service workers were blocked for this intercepted test only. |
| Node production smoke | Direct calorie route, manifest and service worker returned 200 with CSP. Unauthenticated AI returned 403 with `Cache-Control: no-store`. The running default build has live AI disabled. |

The Iranian table has 26 rows drawn from three studies and one restaurant nutrition label publication. The four restaurant rows show the brand and are excluded from generic food matching. The integrated API used synthetic payloads in this run. No new paid model requests or physical iPhone tests were performed.

## 2026-11-26 — Japandi refresh and compatible API settings

| Check | Outcome |
|---|---|
| Package verification, format, lint and typecheck | Passed. Package verification covered the approved image files and provided font package. |
| Vitest | 48 passed. New checks cover compatible model routing, native citation metadata, private settings file permissions and reload, isolation of a key from a changed base URL, and rejection of private network destinations. |
| Chrome and desktop WebKit | 16 passed. Checked calendar shortcuts and Persian numeral code points, ten-second toast dismissal, light/dark/device and their icon metadata, fast repeated water registration and the other-drink dialog, both API model inputs, and offline and axe regression coverage. Browser API responses were intercepted with synthetic fixtures. |
| Browser and Node builds | Passed. The worker precaches both manifests and all required icon assets. The existing Zod optimizer notices remain non-blocking. |
| Local production smoke | The local session could read public settings without a key value. An isolated Node process accepted a synthetic configuration with two editable models and rejected foreign origins, unauthenticated reads and stale configuration revisions. Both manifests and their icons returned 200 on the production application. |

Visual checks used [Persian journal](screenshots/journal-fa-japandi.png), [English dark journal](screenshots/journal-en-dark.png) and [quick water entry](screenshots/drinks-quick-water.png). No paid provider calls were made. Physical iPhone standalone behavior and the installed Home Screen icon refresh remain unverified.

## 2026-11-26 — Quick drinks, typography and insight charts

| Check | Outcome |
|---|---|
| Package verification, format, lint, typecheck and production builds | Passed. The browser build ships four approved Bon weights and the original drink illustrations. The Node adapter built successfully. |
| Vitest | 48 passed across domain, storage, synthetic gateway and component tests. |
| Chrome and desktop WebKit | 18 passed. Both browsers checked the four quick drinks, amount presets and cumulative count, the 700 heading weight, and the absence of Persian one from the active Bon face while Persian two still uses Bon. |
| Chart data and access | A synthetic daily intake of 1,200 kcal and Health expenditure of 1,800 kcal produced the expected −600 kcal balance. The weekly and monthly charts showed a separate 400 kcal partial intake, missing dates and a recorded zero. Tested selected-day values, the data table, macronutrients, Persian dark rendering, 320–1,280 px viewport widths and the automated axe scan. |
| Local production smoke | Drinks, weekly and monthly insight routes, manifest and service worker returned 200 with CSP on the loopback app. |

No paid requests or physical iPhone tests were run. See the [quick drink presets](screenshots/drinks-quick-water.png), [weekly energy chart](screenshots/insights-energy.png) and [Persian dark chart](screenshots/insights-energy-fa-dark.png).

## 2026-11-26 — Drink artwork, Bonyade Koodak and journal supplement entry

| Check | Outcome |
|---|---|
| Package verification, format, lint, typecheck and client/server builds | Passed. The bundled Bonyade Koodak variable font covers Eastern numerals and both app languages. No previous font files are referenced in the client build. |
| Vitest | 49 passed. Compound supplement creation and first serving commit together. An invalid serving rolls both back. Known mass amounts convert for insights, named blends remain separate, and backup export and restore preserve both label types. |
| Chrome and desktop WebKit | 20 passed. Verified images on all quick-drink buttons, the new font and numeral coverage, and compound supplement creation from the journal, offline reload and repeat registration. Insights reflected the expected converted test total. Existing RTL, dark mode and axe checks passed. |
| Local production smoke | Loopback journal, drinks, supplements, and service worker were reachable. All three generated JPEGs and the supplied WOFF2 used their correct MIME types and were in the precache. |

Reviewed the [Persian composer](screenshots/journal-fa-japandi.png), [drink artwork](screenshots/drinks-quick-water.png), and [journal supplement log](screenshots/journal-supplements.png). Physical iPhone standalone was not exercised in this run.

## 2026-11-26 — Lighter Japandi styling and directional navigation

| Check | Outcome |
|---|---|
| Package verification, format, lint, typecheck and both builds | Passed. The project keeps a single agent guide and only the licensed webfont used by the app. |
| Vitest | 49 passed across domain, storage, gateway and component tests. |
| Chrome and desktop WebKit | 22 passed. The browser test verified left and right motion, browser back/forward, Persian RTL mirroring, full opacity during transitions and no route animation with reduced motion. Existing offline, accessibility and responsive checks passed. |
| Local production smoke | The loopback app served the rebuilt directional slide and visual stylesheet. |

Reviewed the [Persian mobile journal](screenshots/journal-fa-japandi.png) and the [English dark journal](screenshots/journal-en-dark.png). The production domain has yet to be deployed. Physical iPhone standalone was not exercised in this run.

## 2026-11-26 — Lighter type and quieter form controls

| Check | Outcome |
|---|---|
| Format, lint, typecheck and production builds | Passed. Both the PWA and Node adapter built successfully. |
| Vitest | 49 passed using synthetic data. |
| Chrome and desktop WebKit | 22 passed. Verified the lighter headings, Persian numerals, settings field and keyboard focus styles, and the 44 px action target. Existing offline, backup, calendar and RTL/LTR workflows passed. |
| Visual and accessibility checks | Reviewed the Persian journal and AI settings in both themes. The Persian settings page fit at 320 px in each theme. Its 36 px button face retained a 44 px touch target. Keyboard focus and automated axe WCAG A/AA scans passed in both themes. |

See the [Persian journal](screenshots/journal-fa-japandi.png), [light settings](screenshots/settings-fa-light.png) and [dark settings](screenshots/settings-fa-dark.png). Physical iPhone standalone was not exercised in this run. No live AI requests were made.

## 2026-11-26 — Calio 0.5.0 quick start and release notes

| Check | Outcome |
|---|---|
| Formatting, lint, typecheck, client and server builds | Passed. The package and lockfile both report version `0.5.0`. The loopback server returned 200 for Settings and the service worker. |
| Vitest | 49 tests passed using synthetic data. |
| Chrome and desktop WebKit | 24 tests passed. Verified Persian and English guide text, focus on the new screen, return to language selection and profile setup, and bypassing setup after saving a profile. Verified localized versions and release notes, keyboard expansion and collapse, and offline reload. |
| Responsive and accessibility checks | The Persian guide fit at 320 px. Axe scans passed for the guide and expanded release notes. Reviewed both new screens in the light theme at 390 px. |

Physical iPhone standalone was not exercised. No live AI requests were made.

## 2026-11-27 — Calio 0.5.1 AI settings recovery

| Check | Outcome |
|---|---|
| Format, lint, typecheck, client and server builds | Passed. The client build reports the missing Bonyade Koodak font removed in commit `336cb8f`. |
| Vitest | 50 passed, including a real loopback HTTP test of session renewal and private settings storage with a synthetic key. |
| AI settings in Chrome and WebKit | Passed in both browsers. Verified settings service recovery, session renewal on save, editing the base URL and both models, blank key readback, consent, disabled tests for unsaved edits, and a successful synthetic analysis test from Settings. |
| Local runtime smoke | The Persian API key field was editable after session renewal on both the Node and Vite addresses. In an isolated Vite instance, synthetic settings saved successfully and both file-serving paths denied access to the private configuration. |
| Full browser suite | 18 passed and 6 failed. All failures were font checks in the journal, offline asset cache and Persian digit scenarios across the two browsers. The browser could not load or cache the removed WOFF2. |

The removed font was left out of the workspace. No live provider calls or physical iPhone tests were performed.

## 2026-11-27 — Calio 0.6.0 offline launch and API key editing

| Check | Outcome |
|---|---|
| Format, lint, typecheck and Vitest | Passed. All 50 unit and integration tests passed. |
| Client and Node builds | Passed. Workbox precached 22 entries, including the approved WOFF2 and deferred features, totaling about 2.5 MiB. The running loopback server returned 200 for the app, settings, worker and font. |
| Chrome and desktop WebKit | All 24 browser tests passed, including axe. Verified offline navigation and reload on previously unvisited routes, an editable API key field during a connection outage, draft retention through retry, and authenticated synthetic saves. |
| Synthetic PWA release in Chrome and desktop WebKit | Verified download when reconnecting, retention of the current page until close, activation of the replacement on offline reopening, and preservation of browser storage. |

Physical iPhone standalone and live provider requests were not exercised.

## 2026-11-27 — Calio 0.7.0 direct provider connection

| Check | Outcome |
|---|---|
| Format, lint, typecheck, production builds | Passed. The Node bundle serves static files, and Workbox precaches 22 entries. |
| Vitest | All 51 tests passed. Verified that a saved key stays outside backup exports and demo storage, model edits can retain it, and a provider URL change requires a new key and new consent. |
| Chrome and desktop WebKit | All 24 browser tests passed, including axe. Verified saving while offline, retention across an offline reload, direct authenticated synthetic analysis and calorie requests, and zero calls to the Calio AI routes. |
| Node static host | Verified SPA navigation, worker activation, HTTPS provider connections allowed by CSP, and HTTP 404 for the retired settings and completion routes. |
| IranRouter CORS | A credential-free OPTIONS preflight for the planned app origin returned HTTP 204, allowing POST with Authorization and Content-Type. |

No authenticated live provider request was sent. Physical iPhone standalone remains untested.
