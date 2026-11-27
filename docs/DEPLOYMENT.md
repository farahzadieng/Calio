# Calio deployment

## Static application and HTTPS

- Run `npm ci` and `npm run build`. Serve `dist/` at the origin root with an SPA fallback to `index.html` for frontend routes. Keep `/api/` outside the fallback. Serve `sw.js` and `index.html` with cache revalidation and hash-named assets with immutable caching.
- For local hosting with the static Node adapter, run `npm run build:server` and `npm start`. It binds to loopback on port 4173 by default. Restart a running legacy Node instance to pick up the new static adapter and policy. If the host sets a Content Security Policy, allow HTTPS provider connections in `connect-src`.
- Install on iPhone from Safari at the app's HTTPS origin. Keep the same origin when upgrading to retain IndexedDB.
- The first online production launch precaches the complete app, including deferred features, fonts, and images. Calio checks for updates on startup, on return to the foreground or network, and hourly while visible. A downloaded release activates after all open Calio windows close.

## Direct AI connection

Open **Settings → Apple Health and AI**. The defaults are IranRouter's OpenAI-compatible base URL, `openai/gpt-6-luna` for analysis and `perplexity/sonar` for calorie search. Enter and save the key on each device, then grant AI consent before running either model. Saving uses IndexedDB and works offline. A connection previously configured on the server requires entering the key again on the device.

The browser sends the key only to the configured provider's HTTPS chat completion endpoint. The provider must allow the app's origin through CORS and permit POST with `Authorization` and `Content-Type`. Calio rejects redirects and keeps requests and replies outside the PWA cache. Keys stay out of exported backups and diagnostics. Changing the base URL requires a key for the new endpoint and resets consent.

Each model test makes one synthetic provider request and may incur a charge. Automatic calorie lookup requires provider citations. Extraction and weekly reporting use the analysis model. The local reference table and Copy prompt work offline. Generic multi-nutrient and portion search still require a verified search connector.

## Real-device verification

Use a private test origin and synthetic data to verify install/update, offline reload, direct provider connectivity, and the Apple Health Shortcut flow on a physical iPhone.
