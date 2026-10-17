# Goldsmith

Personal daily-reflection app built with React, Vite, and Recharts. Rate effort across six questions and view scores over time.

## Storage

The browser calls `/api/scores`. A Vercel Node.js function reads `JSONBIN_ACCESS_KEY` from its server environment and calls JSONBin using `X-Access-Key`. The key is never included in the frontend bundle or sent to the browser.

Each browser receives a signed, HttpOnly cookie granting access to the private bin created for that browser. The API accepts individual dated score entries, validates them, and selects the bin from the verified cookie. It does not accept a bin ID or an upstream URL from the client. Writes require a matching request Origin. Responses are not cached.

This is browser-based access, without an account login or cross-device synchronization. Anyone can start a new browser session and create their own bin under the app's JSONBin account, consuming its quota. Clearing cookies, allowing them to expire, or replacing the server access key loses access to that browser's history. The app does not import old `goldsmith_bin_id` values from the previous JSONBin account. Names stay in browser local storage and are not sent to JSONBin.

The function keeps up to 1,000 dated entries per browser. JSONBin updates replace the record, so simultaneous saves in different tabs can overwrite each other. This change has not added account-wide abuse prevention.

## Configuration and development

1. Install dependencies with `npm ci`.
2. Create a JSONBin Access Key with Bins Create, Read, and Update permissions. Delete permission is not required.
3. In the existing Vercel project, set `JSONBIN_ACCESS_KEY` as a Secret for the intended deployment environment. Never use a `VITE_` prefix for it.
4. To run the full app locally, use `vercel dev` with a separate Development key in a Git-ignored `.env.local`. `npm run dev` starts the frontend only.

`.env.example` contains an empty server-variable template. Do not commit `.env` files or key values. Setting the Vercel secret alone does not change an existing deployment; the server function must be deployed with it.

## Checks

- `npm test`: real API handler tests with an isolated JSONBin stand-in; covers session isolation, cookie tampering, input validation, upstream failures, and Los Angeles dates.
- `npm run lint`
- `npm run build`

The current source no longer embeds the earlier account's master key. That key remains in existing Git history and has not been revoked as part of this change. No history was rewritten.
