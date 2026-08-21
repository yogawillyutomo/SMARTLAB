# Backend Foundation Sprint 1

SmartLab's backend is a Laravel 13 REST API under `apps/api`. PostgreSQL is the canonical application database for local development and production. The early automated suite uses SQLite in-memory storage only for portable tests; it does not validate PostgreSQL-specific behavior. PostgreSQL integration validation is therefore pending.

Authentication uses Laravel Sanctum with stateful session-cookie middleware for the first-party SPA and bearer tokens for mobile or API token clients. Application identity models use ULIDs, including `User`; Sanctum's `personal_access_tokens.tokenable_id` is an ULID morph key so token authentication remains compatible with that identity type.

Schools are tenant boundaries. A global `User` may have multiple `SchoolMembership` records. Roles are assigned to memberships, never directly to users, and permissions are inherited through membership roles. The current `/api/v1/me` endpoint succeeds only when the authenticated user has exactly one active membership; no active membership and multiple active memberships are explicit context errors. Controllers stay thin while membership resolution lives in an application service.

`packages/contracts/openapi.yaml` is the source of truth for implemented HTTP contracts. Sprint 1 documents only health and current-user context endpoints; it intentionally does not speculate about future resource APIs.

The forthcoming core model remains deliberately separate: Asset is not Device, and neither is a LayoutElement. `deviceCode` will be the stable Device identity, `slotCode` the physical layout-position identity, and a Device's current position will be derived from active layout binding. A later Incident history model will capture reporter, laboratory, device, asset, and position snapshot. None of those future domains are implemented by this foundation.
