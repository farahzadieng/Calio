# Decision ledger — update during implementation

Confirmed: Calio, warm cream Japandi (no green UI), dark mode, bilingual, dual calendar, local-first PWA, seven-day automatic foreground processing + manual, minimal confirmation, weekly AI report after Health sync, monthly weight comparison and external copy prompt, supplements, separate drinks, four read-only Health metrics, blank food library, full and food-only backup/import, custom visible controls, subtle transitions and moving charts, test messages, actual QA.

Blocking owner inputs (ask at point of need):
- [ ] Font files, weights, heading choice, license (before any CSS).
- [ ] Exact existing Shortcut name, clipboard/return and units.
- [ ] AI provider/model, search capability, deployment/auth, budget.
- [ ] Weekly anchor/timezone and monthly period.
- [ ] Weight model and discrepancy/coverage thresholds; 2600 unverified.
- [ ] Remotion live route feasibility / approval of lightweight adapter.

Proposed, not settled: exact color hex values, route hierarchy, supplement placement, dependency versions, Worker deployment. Ask before consequential changes. No font assets or private API credentials included.

## 2026-11-26 — Owner confirmations
- **Typography:** Bon for Persian and English. Owner confirmed PWA use and supplied both WOFF and WOFF2. Use WOFF2 with base 400, app title 900, h1 800, and progressively lighter styles for lower hierarchy.
- **UI:** Approved proposed light/dark cream Japandi palette, four primary routes, supplements accessible from Journal and Profile, lightweight live navigation transitions and genuine Remotion for a bounded report reveal.
- **Periods:** Persian reporting follows Solar Hijri calendar months with Saturday-start weeks. English reporting follows Gregorian calendar months with Monday-start weeks. Display calendar remains an independent preference per the product contract. Reporting timezone and switch behavior for existing periods need verification.
- **Weight:** 5,000 kcal/kg is an owner-selected static comparison coefficient. Label it custom and unvalidated. Await discrepancy and coverage thresholds before enabling comparisons.
- **Health:** Exact Shortcut `HealthKit-Bridge`, user-initiated clipboard transfer, count for steps, km for distance. The owner delegated a profile-derived resting-energy completeness heuristic. Exported energy label `cal` needs clarification on kcal vs small calories. No raw sample is stored or used in tests.
- **AI:** IranRouter OpenAI-compatible base URL `https://iranrouter.net/api/v1`, chosen model `openai/gpt-6-luna`. Await verified search capability, hosting, gateway authentication and budget. A fresh secret must be provisioned on the selected host. No live requests were made.

## 2026-11-26 — Owner clarifications
- Start with a minimal Persian/English language chooser. Use short, reduced-motion-aware transitions.
- Asia/Tehran is the onboarding timezone default and remains editable. Shortcut exports kcal for both energy arrays, count for steps, and kilometers for distance.
- Monthly discrepancy threshold is 2 kg. Use every eligible paired date and show coverage, with no extrapolation. A comparison requires at least one usable paired date and both endpoint weights.
- Request a Health sync before analysis when the last successful sync is older than 24 hours. Available valid data is used with visible coverage. An expired sync does not constitute a ready weekly report.
- Owner requests no AI spend cap and permits local environment-based testing after the synthetic workflows. Production gateway hosting and authentication and a supported search connector remain unresolved.

## 2026-11-26 — Live capability check
- With owner approval, sent one provider search probe using a public USDA query and no Calio diary or Health data. IranRouter returned HTTP 200 for the selected model, with no tool calls/citation annotations and an explicit search-unavailable response. The credential was used in memory and was not written to the repository or environment file.
- The owner requested free-form web research through a model or provider with verified search. Source-only, tool-backed research remains a production prerequisite. A private on-device or on-network server design is under discussion. Keep provider credentials outside the browser.
- The Health data-quality heuristic uses half the profile's approximate resting-energy estimate as a lower-bound flag. It never changes the imported measurement. Without an eligible reference, zero and current-day partial handling still apply. An explicit replay refreshes import provenance without duplicating rows or replacing later corrections.

## 2026-11-26 — Perplexity usage boundary
- The owner limits any Perplexity integration to sourcing energy values for food calorie calculations, to control costs. Keep intake arithmetic local. Only send the minimum food description needed for energy lookup. Reuse previously verified calorie values and keep Perplexity out of note extraction, non-energy nutrient lookup, and report generation. Enabling this route still depends on obtaining verifiable source metadata in a live test.

## 2026-11-26 — Calorie lookup and report model

- The owner selected plain `perplexity/sonar` for internet research of food energy only after cost feedback. Keep diary extraction and weekly analysis on `openai/gpt-6-luna`. No automatic Pro fallback.
- Reuse a matching local library or published Iranian food reference before making a request. The bundled table retains a source and kcal per 100 g for each sample, recipe, or clearly labeled restaurant serving. Restaurant labels only match the listed brand.
- Offer two calorie lookup methods. Default to copying a food-specific prompt and importing a reviewed structured reply to avoid API charges. Selecting automatic mode opts in to Sonar for an eligible measured food with unknown energy, subject to AI consent and an authenticated live gateway. Diary text and Apple Health fields stay out of calorie research payloads.

## 2026-11-26 — Japandi refresh and compatible AI connection

- The owner requested the bundled reference art as a subtle background, circular presentation of the existing logo, and a more faithful Japandi journal. The notebook composer, practical shortcuts, navigation and background use the approved Bon and illustration assets. The originals are kept intact. A system glyph limited to the affected Persian numeral corrects Bon's U+06F1 appearance.
- Day, night and device theme choices update the content and browser's install metadata, using approved light and dark icon assets. The platform controls whether it updates an already-installed home icon.
- Quick water uses the existing 250 mL preset per press. Other drink types, custom sizes, editing and linking remain available in a dialog. The journal calendar offers today and yesterday in the configured diary timezone; ordinary notices dismiss after ten seconds and honor reduced motion.
- The owner approved any OpenAI-compatible API. Keep IranRouter, Luna and plain Sonar as editable defaults for one base URL and two model IDs. The key is captured for the local service; settings readback exposes only whether a key is present. Use compatible public HTTPS routes, consent and two explicit synthetic connection tests.

## 2026-11-26 — Quick drinks, calmer typography and insight charts

- Quick logging adds separate coffee, tea and alcohol-free beer types alongside water. The visible editable entry presets are water 250 mL, coffee 150 mL, tea 200 mL, and alcohol-free beer 250 mL. One tap records one serving on the selected date. Unknown caffeine and energy remain unknown.
- The owner requested a maximum type weight of 700 and smaller headings. Calio retains supplied Bon, using 700/600/500 for heading hierarchy and 400 for body. All active Bon faces omit U+06F1 and U+0661 so devices without a named local fallback still use their system glyph instead of reusing Bon's Latin-shaped numeral.
- Daily, weekly and monthly dashboards display accessible Japandi charts for calorie intake versus measured Apple Health expenditure, macros, steps, distance and drink volume. Partial intake is shown as a labelled known subtotal. Missing values have gaps and recorded zero is distinct. Energy balance and weight comparisons continue to use only eligible existing calculations.

## 2026-11-26 — New typography, drink art and journal supplements

- The owner supplied a replacement web font after the initial file was identified as a restricted Digikala font. Bonyade Koodak's standard variable WOFF2 now serves both locales. The heading hierarchy continues at 700/600/500 with body at 400; Persian one uses the new font's own glyph.
- Tea and alcohol-free beer use newly generated artwork matched to the existing water and coffee illustrations. The journal composer has a separate rice-paper background with a subdued leaf shadow and lighter decorative borders.
- Journal opens a direct supplement dialog for the selected date. Creating a product and recording its first serving save atomically. Known components can use compatible mass units. Label-only named blends preserve their amounts independently, including in consumption history and backups.

## 2026-11-26 — Lighter surfaces, directional navigation and project handoff

- The owner requested smaller, lighter Bonyade Koodak typography and gently rounded controls. Main titles use weight 600, section titles around 540 and controls around 500. Warm decorative borders sit close to the underlying surface, with stronger field and focus boundaries.
- Live navigation slides horizontally in both directions, mirrored for RTL. It uses one active scene and honors reduced motion. Remotion continues to run only the report reveal.
- The planned public address is `https://calio.luminiastudio.ir/` and has not been published. The owner confirmed public redistribution permission for the active Bonyade Koodak webfont in the Calio repository.
- Project-level agent instructions and visual architecture are consolidated into `AGENT.md`. Keep runtime, test, deployment, evidence and design references needed by the project. Exclude local credentials, generated caches and unused font variants.

## 2026-11-26 — Lighter type, quieter fields and compact buttons

- The owner requested thinner type after reviewing the previous pass. Use Bonyade Koodak at 330 for body, 390 for controls, 420 for section headings and 470 for page titles. Use warm brown for text in light mode and warm beige in dark mode.
- Use shallow, rounded action buttons with more horizontal space. Keep the 44 px touch target. In settings, the journal and other forms, use a tinted field surface and a subtle border. Keep clear keyboard focus and validation states.

## 2026-11-26 — App version and quick start

- The owner set the starting app version to 0.5. The package number is `0.5.0` and Settings displays `۰/۵` in Persian or `0.5` in English with expandable release notes. Increment the version by the scope of each app update and keep the latest notes in both languages.
- After language selection for a new profile, show a short guide to the journal, drinks and supplements, optional Apple Health import, and insights. The guide precedes the profile form and can return to language selection. Existing profiles continue to open the app directly.

## 2026-11-27 — Restore AI connection editing

- Restore expired local owner sessions through a same-origin request outside the PWA cache. Use the same authenticated settings and provider gateway in loopback Vite development, with a separate private configuration file. Static preview requires the Node service for AI.
- Keep both model tests visible. Enable them after saving and granting consent, and require saving edits before testing. Tests use synthetic inputs and can incur provider charges.

## 2026-11-27 — Offline-first navigation and connection editing
- Load primary routes with the app and precache the full production bundle, including deferred features. Check for releases on foreground and reconnection and periodically while open. Activate the downloaded release after existing app windows close to avoid interrupting unsaved edits.
- Keep the API key field editable while the service is unavailable and retain the draft during reconnection. Save the key through the existing authenticated gateway when it is reachable.
- Restore the previously approved Bonyade Koodak WOFF2 because the production stylesheet still requires it and the offline build must include it.

## 2026-11-27 — Device-owned API connection
- The owner requested a static host and direct provider calls from each installed PWA. Save the key and provider settings in a dedicated IndexedDB table outside backups and diagnostics. Require consent before any provider request, and reset it when first saving or changing the provider URL.
- Use browser-compatible HTTPS endpoints with CORS, versioned prompts and validated responses. The production and development hosts no longer expose AI gateway routes.
