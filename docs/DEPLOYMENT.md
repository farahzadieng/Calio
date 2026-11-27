# Calio deployment

## Local application and HTTPS

- Run `npm ci` and `npm run build`. Serve `dist/` at the origin root with an SPA fallback to `index.html` for frontend routes. Keep `/api/` outside the fallback. Serve `sw.js` and `index.html` with cache revalidation. Hash-named assets may use immutable caching.
- The Node adapter serves the built app, applies CSP and security headers, and exposes the same-origin gateway route. Run `npm run build:server` and `npm start`. It binds to loopback on port 4173 by default.
- For an iPhone, put the Node adapter behind a private HTTPS reverse proxy on a reachable device. Install from Safari. Keep the same origin when upgrading to retain the browser's local IndexedDB. Export a backup before changing the origin.
- The supplied Bonyade Koodak variable WOFF2 and approved square icons are bundled locally. Theme switching updates the in-app artwork. The iOS Home Screen icon is the manifest/Apple Touch icon.

## Private AI gateway

Open **Settings → Apple Health and AI** on the Node-served app. The editable defaults are IranRouter's OpenAI-compatible base URL, `openai/gpt-6-luna` for analysis and `perplexity/sonar` for calorie search. Supply a key and save, then grant AI consent before running either model. The two model IDs must be offered by the selected endpoint. Use the model-test buttons for one synthetic request at a time. Those tests can incur provider fees.

Calio sends the entered key once to its own local service. The service stores it in the ignored, owner-only `.calio-ai.json` file next to the application by default. An optional `CALIO_AI_CONFIG_FILE` points to private persistent storage. The key never enters browser storage, backup, or responses. When changing the base URL, supply a key for that endpoint and grant consent for the new provider. Transport accepts public HTTPS endpoints through the authenticated gateway and blocks private/special-use addresses and redirects. It pins the resolved upstream address for each connection.

On a direct loopback install, the Node adapter issues an HttpOnly, same-site owner session cookie to the app. Call it at the configured origin, normally `http://127.0.0.1:4173`. For a reachable HTTPS installation, authenticate the owner at the reverse proxy. Overwrite `X-Calio-Authenticated` with the private `CALIO_AUTH_PROXY_TOKEN`, and set `CALIO_PUBLIC_ORIGIN` to the exact public origin. Keep the Node port on loopback. Same-origin validation, request size limits, schema validation, timeouts, and in-flight deduplication also apply. An explicit host-managed legacy profile can use the variables in `.env.example`. The static preview alone has no connection service.

The local PWA renews its owner session when the Node service restarts. `npm run dev` also includes the gateway on loopback and uses the ignored `.calio-ai.json.dev` file, independently of the Node installation. Open the exact address printed by the server. If the connection service is temporarily unavailable, use **Check connection service again** in Settings.

The first online production launch precaches the complete app, including deferred features, fonts, and images. Calio checks for updates on startup, on return to the foreground or network, and hourly while visible. A downloaded release activates after all open Calio windows close. The service worker omits all `/api/` responses. Browser records remain in IndexedDB. The visible logo, favicon, Apple Touch icon link, and install manifest follow the selected theme. The home screen stores the installed icon according to browser and system behavior, and may require a new installation to pick up a different icon. Back up the diary before removing an existing iPhone installation.

## Search capability and test

The previous live probes confirmed structured USDA URL annotations on the plain Sonar route. The `calories` operation routes to the configured calorie model, `perplexity/sonar` by default. It submits food identity and the requested kcal basis. The gateway checks that the HTTPS source in the reply matches a provider citation annotation and returns energy-only provenance. There is no fallback to Sonar Pro. Extraction and weekly reports continue to use the configured main Luna model. Generic multi-nutrient and portion research still require their own verified connector. The live probes used a public food prompt. The integrated route was verified with synthetic replies. See the [test report](TEST-REPORT.md).

The Calorie lookup and reference page offers a local reference table and Copy prompt by default, available without the live gateway. Automatic API lookup is an explicit setting. The production app needs a saved gateway configuration and consent. Matching saved energy or a published reference bypasses the paid request.

## Real-device verification needed

Verify Safari and installed iPhone standalone behavior for the existing Shortcut launch, return flow, clipboard denial and paste, install/update, keyboard and safe areas, and offline reload. Use a private test origin and synthetic data. Desktop WebKit is browser coverage and does not verify physical iOS.
