# UI implementation guide

Use https://ui.persian-labs.ir/llms.txt as live catalog. PersianLabs is source-distributed, shadcn-compatible, Base UI/TypeScript/Tailwind. Verify registry installation from https://ui.persian-labs.ir/docs/installation; `npx shadcn@latest add @persianlabsui/button` appears in RTL docs, but confirm project registry configuration and current command before applying. Use relevant documentation links from catalog; some .md endpoints were unavailable during preparation, HTML/catalog accessible. Do not invent API signatures. Source registry components are editable, not unstyled browser defaults. Rework their styling into Calio wrappers after font gate.

| Feature | Candidate components (verify APIs) |
|---|---|
| onboarding | Questionnaire, Field, Input, Radio Group, Button, Progress |
| dates | Calendar, Date Picker, Date Wheel Picker (calendarType), Popover, Drawer |
| notes | Textarea, Field, Button, custom list, Empty |
| drink/supplement/weight | Input Group, Select (not Native Select), Combobox, Wheel Picker, custom stepper |
| filters/navigation | Tabs, Toggle Group, custom bottom bar, Sheet |
| reports | Charts, Card, Accordion, Table, Tooltip, Skeleton |
| settings | Switch, Select, Dialog, Alert Dialog, Data Table |
| status | Message, Toast, Alert, Status Button, Spinner, Progress |

Custom from scratch means custom visible appearance, layout, validation/error states, labels, focus, icons, date/time/calendar/select/checkbox/radio/switch/number steppers/drawer/dialog/toast/file trigger. Keep native semantic input/textarea/button internals for screen readers, keyboard, IME, autofill and platform-required browser picker/permissions. Never use browser default date/time/select popup, `alert/confirm/prompt`, default spinners or unstyled file field. OS keyboard, file chooser and permission dialogs cannot be replaced securely. Custom inputs use inputMode, prevent accidental numeric normalization while typing, handle Persian/Arabic digits and decimals; store canonical numeric values. Use field errors and focus first invalid. Validate clipboard paste locally.

Routes: `/` journal, `/drinks`, `/insights` (daily/weekly/monthly), `/insights/day/:date`, `/insights/week/:period`, `/insights/month/:period`, `/profile`, `/profile/supplements`, `/settings`, `/settings/library`, `/settings/backup`, `/settings/integrations`, `/settings/diagnostics`. Onboarding guard only for first run, optional integrations can skip. Mobile bottom navigation with safe area; desktop sidebar or centered layout; avoid duplicate nav and content obscured by keyboard. Route names are proposed, user may change. Theme preference system/light/dark, early appearance before paint, and circular in-app logo. The favicon, Apple Touch link and selected install manifest follow the effective theme. Existing launcher icon refresh is controlled by the platform. Use the same manifest app ID in both modes.

RTL: document `lang` and `dir`; use library Direction provider when appropriate, `bdi` for mixed fragments, logical CSS inline/start/end, locale-based directional icons and navigation transition. Persian display uses Eastern Arabic-Indic digits. The supplied Bonyade Koodak web font draws the Persian digits directly. ISO dates and decimal numbers remain canonical in storage. Calendar choice independent of language; convert display only; DST/local dates tests. Chronological plots keep a left-to-right axis with localized dates and exact values. All copy localized, including errors, test messages, units, accessibility labels. English and Persian layouts checked separately.

## Remotion integration
The interactive app uses a short horizontal slide without fading. The main navigation order determines the slide for different sections. Within a section, entering or leaving a child route and the browser history determine the direction. Persian mirrors English. Only the active interactive scene is rendered, and reduced motion disables the slide. Remotion is reserved for the bounded visual scene of a report reveal. Read the [visual architecture in the agent guide](../AGENT.md).


## Assets
`assets/brand/logo-light.png` and `logo-dark.png` are selected full-square originals, preserve corners. Icon derivatives 192/512 PNG with no pre-rounded mask; light default, dark in-app alternate. Do not promise system icon changes by theme. `assets/reference` contains prior UI and illustration board (reference only; UI composition not approved). `assets/illustrations` cropped decor, optimized WebP, paper backgrounds; use sparingly on compatible surfaces, not as icons or exact nutrition illustrations. Crops need visual QA and dark adaptation; don't invert photos blindly. Use the supplied local Bonyade Koodak WOFF2. Any missing production artwork or desired recolor ask owner. Keep all real controls and charts as code.

## Insight charts

Display daily, weekly and monthly energy, macronutrients, steps, distance and drink volume in the warm neutral dashboard. Chronology goes left to right and the rest of the interface follows locale direction. Pair the solid intake bar with an outlined Health expenditure bar. Use stripes for partial intake and gaps for missing values, distinct from measured zeros. Provide exact selected-day values and an expandable period table.
