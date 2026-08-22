# First-Party SPA Session Authentication

## Purpose and boundary

SmartLab's first-party React SPA authenticates with Laravel's `web` session guard through Sanctum's stateful API middleware. The backend implements only `POST /api/v1/auth/login` and `POST /api/v1/auth/logout`; the corresponding React integration is documented in `frontend-spa-auth-integration.md`. This flow does not add registration, password reset, email verification, MFA, OAuth, tenant selection, personal-access-token issuance, or logout-all-devices.

Sanctum bearer tokens remain a separate authentication mechanism for future mobile or API clients. Session login never creates a token, and logout never deletes or revokes a bearer token.

## Browser flow and CSRF

The first-party SPA flow is:

1. `GET /sanctum/csrf-cookie`
2. `POST /api/v1/auth/login`
3. `GET /api/v1/me`
4. Authenticated API requests
5. `POST /api/v1/auth/logout`

The SPA must send credentials and requests from a host listed in `SANCTUM_STATEFUL_DOMAINS`. Sanctum then applies encrypted cookies, queued cookies, Laravel session startup, CSRF validation, and session authentication to API requests from that stateful origin. The login endpoint is not exempted from CSRF protection.

## Login security

Login accepts only `email`, `password`, and optional strict JSON boolean `remember`. Unknown fields are rejected. The submitted email is used as entered because the existing User identity contract does not define a canonical email rewrite; stored identity data is never changed by login.

Laravel's stateful `web` guard checks email, password, and `status=active`. Unknown email, wrong password, and inactive account all return the same `401 INVALID_CREDENTIALS` body. Laravel's timeboxed credential validation limits timing differences, and successful guard authentication regenerates and destroys the previous session identifier to prevent session fixation.

Login attempts are limited to five failures per 60 seconds for a SHA-256-hashed normalized-email-plus-IP key. Hashing keeps raw email and IP values out of the cache key. A blocked request returns `429 TOO_MANY_LOGIN_ATTEMPTS` with `Retry-After`; successful authentication clears that exact counter.

## Current-session logout

Logout requires `auth:sanctum`. For a stateful SPA session it:

- calls the web guard's current-device logout operation, which does not cycle the shared remember token;
- invalidates the current session and rotates its identifier;
- regenerates the CSRF token;
- clears only the in-memory Sanctum guard user for the completed request; and
- returns `204 No Content`.

Other sessions, other-device remember tokens, and personal access tokens remain valid. A bearer-authenticated call may reach the endpoint because `auth:sanctum` preserves token compatibility, but it does not revoke that token or invent a session-wide logout operation.

## Deployment configuration

Deployments must configure `APP_URL`, exact `SANCTUM_STATEFUL_DOMAINS`, the intended `SESSION_DOMAIN`, HTTPS-only session cookies in production, and an appropriate SameSite policy for the actual same-site or cross-subdomain topology. Credentialed CORS must list trusted SPA origins explicitly and must never use a wildcard origin. Production should use a shared durable cache for login throttling and a durable session store appropriate to the deployment. Secrets, production credentials, and environment-specific domains do not belong in source control.
