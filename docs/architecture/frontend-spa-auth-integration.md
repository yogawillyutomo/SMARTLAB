# Frontend SPA Session Authentication Integration

## Scope and authority

The React SPA uses the Laravel Sanctum session cookie as its only authentication authority. Authentication state, credentials, current-user identity, session identifiers, and CSRF data are never persisted in browser storage. Existing AppDB data and UI preferences remain local because their API migrations are outside this authentication-only stage.

The frontend follows the implemented backend flow:

1. `GET /sanctum/csrf-cookie`
2. `POST /api/v1/auth/login`
3. `GET /api/v1/me`
4. Authenticated `/api/v1/*` requests
5. `POST /api/v1/auth/logout`

## State machine

The in-memory authentication store uses these states:

- `bootstrapping`: `/me` is in flight and protected routes wait;
- `unauthenticated`: `/me` returned a confirmed `401`, or an ordinary login failure occurred;
- `authenticating`: the CSRF, login, and `/me` sequence is in flight;
- `authenticated`: `/me` returned a valid identity with a usable recognized role;
- `logging_out`: logout is in flight while the existing principal remains available;
- `context_error`: the session lacks one usable membership context or a recognized compatibility role;
- `error`: a network, server, configuration, or malformed-response failure prevents an authoritative decision.

Bootstrap calls are deduplicated so React StrictMode cannot create duplicate visible requests. Protected deep links wait for bootstrap. Only a confirmed `401` redirects to `/login`; an unavailable backend displays a retry state instead. A successful login restores only a validated internal route and otherwise goes to `/dashboard`.

## API and CSRF client

All API requests use native `fetch`, `credentials: 'include'`, and `Accept: application/json`. JSON mutations also use `Content-Type: application/json`. A `204` response is returned without JSON parsing. HTML, empty non-204 bodies, malformed JSON, invalid error envelopes, configuration errors, and network failures become controlled client errors.

Before login, the client obtains the Laravel `XSRF-TOKEN` cookie, safely URL-decodes it, and sends it as `X-XSRF-TOKEN`. Session mutations that receive `419` refresh the CSRF cookie and retry exactly once. CSRF values are neither logged nor persisted.

`VITE_API_ORIGIN` configures the browser-visible API origin. Leave it empty for same-origin requests and local Vite proxying. `SMARTLAB_API_PROXY_TARGET` configures only the Vite development proxy for `/api` and `/sanctum`; its non-secret default is `http://127.0.0.1:8000`.

For the default Vite server, Laravel's `SANCTUM_STATEFUL_DOMAINS` must explicitly include the actual browser host and port, normally `localhost:5173` and/or `127.0.0.1:5173`. Using the proxy keeps the XSRF cookie readable on the SPA host; a direct cross-origin `VITE_API_ORIGIN` requires a deployment topology and cookie domain that intentionally allow the SPA to read the XSRF cookie.

## Identity and error handling

The `/me` payload is authoritative for user, school, membership, all membership roles, and all effective permission keys. Login becomes authenticated only after `/me` succeeds. `INVALID_CREDENTIALS`, `VALIDATION_FAILED`, `TOO_MANY_LOGIN_ATTEMPTS` with `Retry-After`, membership conflicts, service unavailability, and unexpected responses have distinct safe Indonesian presentation messages.

Logout clears the in-memory principal only after backend `204` or a confirming `401`. Network or server failure retains the principal and reports that logout could not be confirmed. It does not implement logout-all or token revocation.

## Temporary permission compatibility boundary

The backend role list currently matches the eight legacy frontend role names. The compatibility adapter selects the first recognized role in the server-provided order for existing local-only prototype guards. It never invents a role or falls back to Super Admin; an identity with no recognized role fails closed. The profile displays the complete server role list rather than permitting role switching.

The complete backend permission list is retained read-only, and `hasServerPermission` performs an exact permission-key check for API-integrated features. Existing module guards continue to use the local permission matrix only for prototype modules not yet migrated to API authority. Those guards are a presentation convenience, not a backend security boundary. Laboratory API persistence and authorization now use exact server permissions as documented in `frontend-laboratory-api-integration.md`.

## Legacy cleanup

The first authentication operation removes only the obsolete `smartlab_pplg_auth` key from local and session storage. It does not clear AppDB, schema version, UI/theme preferences, the local permission matrix, or unrelated storage. No replacement authentication key is written.

## Deployment configuration

The Laravel deployment must configure `APP_URL`, exact `SANCTUM_STATEFUL_DOMAINS`, the intended `SESSION_DOMAIN`, production-appropriate `SESSION_SECURE_COOKIE`, and an explicit credentialed CORS origin list. Cross-origin deployments must expose `Retry-After` if the UI is expected to display the server throttle delay. Wildcard credentialed CORS is not permitted. The browser and API topology must remain compatible with the backend session-cookie and SameSite policy.

## Remaining UAT

Automated tests cover transport, CSRF retry bounds, state transitions, role compatibility, storage cleanup, and safe deep-link restoration. Browser integration UAT still requires a reachable Laravel server and a valid development account. It must exercise successful and failed login, authenticated refresh, logout, post-logout protection, both remember values, deep links, and API-unavailable bootstrap behavior.
