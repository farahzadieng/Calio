# QA & diagnostics — mandatory execution plan

## Diagnostic UI
Settings > Diagnostics (visible, not hidden dev-only). Buttons: Test UI message (success/info/warning/error), Test AI connection (real minimal non-sensitive request only after consent/key; show actual status, latency, model, usage), Test AI pipeline (mock fixture by default), Test Apple Health (parse sample locally, launch exact shortcut separately, clipboard/import result), Test weekly report (mock due window), Test monthly discrepancy (mock), Test backup (roundtrip in isolated DB), Test offline/retry, Clear demo data. Test messages clearly marked TEST / آزمایشی, never mistaken for real report or real Health sync. Show actual stage, timestamp, redacted error codes, retry action; never show keys/full payload. Persist bounded debug history and copy redacted diagnostic report. Provide real event messages: saved offline, weekly due, processing started/progress, awaiting sync, sync complete/partial, network failure, AI invalid output, needs review, weekly ready only after saved, weight due, monthly prompt ready, backup/import successful/failed. Use custom Message/Toast, accessible live regions, dedupe repeat notifications, no native alerts. No production mutation from mock mode.

## Automated and real device tests
Use Vitest for deterministic functions, Testing Library for components, Playwright Chromium + WebKit for E2E, axe accessibility checks, screenshot comparisons for both themes/locales; manual real iPhone Safari and installed standalone PWA for shortcuts, keyboard, permissions, offline, install and safe area. WebKit emulation is not proof of actual iOS. Run install, lint, format check, typecheck, unit, integration, E2E, build, worker checks and production smoke; exact commands in repo README. Record actual pass/fail, dates, device, commit, blocked tests. Do not report app tested until built.

| ID | Acceptance criterion |
|---|---|
| T01 | Onboarding persists valid profile; invalid fields custom errors; no AI call; REE/TDEE tested; missing reference variable not fabricated. |
| T02 | Journal save offline, reload, edit/delete/past date, fa text and digits, no per-entry requests; draft not lost navigating. |
| T03 | Seven-day due only on foreground; before due no auto calls; missed intervals, multiple tabs, restart, timeout/retry no duplicates. Manual analyze works. |
| T04 | Extract fixture structured, negation/planned food ignored, symptoms not counted; invalid JSON/extra fields/wrong IDs rejected. |
| T05 | Known exact food + known unit no research; known food unknown unit only portion call; unknown variant separate; search unavailable leaves null; source verification and recipe math tested. |
| T06 | 39 keys all present, unknown vs zero, per100g/100mL math, density missing, sodium-to-salt, added sugar distinct, food/supplement totals no double count. |
| T07 | Health 4 arrays + dates valid; malformed, unequal lengths, duplicate dates, nonfinite, negatives reject atomically; replay, corrections, stale/partial/zero energy, missing dates no deletion. |
| T08 | Shortcut launch actual exact name, clipboard denial/manual paste, cancel, no write, return from Shortcuts actual iPhone. |
| T09 | Weekly state awaiting sync until fresh; no report ready on failure; after successful sync report validated and saved, one ready message; coverage explicit. |
| T10 | Weekly AI has valid evidence IDs, no unsupported causal/diagnostic claim, nulls and missing days preserved; low steps not sitting; retry and bad output. |
| T11 | Monthly weight compare correct sign/model/coverage, missing weight prompt, threshold configured, external prompt includes all required fields and can copy offline; no external send. |
| T12 | Drinks independent water/caffeine, edit, unknown coffee caffeine; duplicate note reconciliation; supplement known label/dose, unknown dose review, units IU verified. |
| T13 | Production library empty on new install; food-only JSON/CSV import/export roundtrip; full backup all tables; merge/replace preview, rollback on corrupted/future schema, no secrets. |
| T14 | FA RTL and EN LTR in both calendars, date boundaries/leap days and timezone, mixed text, focus, keyboard, 44px target, screen reader labels, 200% zoom. |
| T15 | Light/dark/system no flash; contrast tested, no green tokens, user font files only, custom visual inputs/date/select/dialog/toast, no native alert. |
| T16 | Smooth short transitions and animated charts, reduced motion immediate; no double form mount/focus loss; no chart false zero; slow-device test. |
| T17 | Install manifest square icons, offline shell/fonts/assets, update/reload no loss, storage quota warning and backup, no sensitive SW cache. |
| T18 | AI secret not in source/bundle/backup/logs, auth/rate limits, consent off blocks, search prompt injection, import malicious text escaped, demo separate. |
| T19 | All diagnostic buttons and test messages work, no mock real data contamination, status reflects actual outcome. |
| T20 | Responsive 320–430px and desktop, iOS standalone/safe area, final production build and deployment smoke. |

Test fixtures are deliberately synthetic. Real API/Shortcut tests require user's credentials/device and font gate. Until then report blocked; no fake pass. Test harness in this handoff only checks package contracts, not future app.
