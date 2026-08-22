# Frontend Laboratory API Integration

## Source of truth

Laravel's tenant-scoped Laboratory API is the only canonical source for the frontend Laboratory list and detail routes. The legacy `AppDB.labs` collection remains unchanged for backward compatibility with local prototype domains, but the API-integrated pages do not read it, write it, or silently fall back to it.

The owning `schoolId` always comes from the backend's active membership context. The browser neither asks the user for it nor includes it in a mutation payload.

## HTTP surface and permissions

| Capability | Endpoint | Exact server permission |
| --- | --- | --- |
| List | `GET /api/v1/laboratories` | `laboratories.view` |
| Create | `POST /api/v1/laboratories` | `laboratories.create` |
| Detail | `GET /api/v1/laboratories/{laboratoryId}` | `laboratories.view` |
| Update/status | `PATCH /api/v1/laboratories/{laboratoryId}` | `laboratories.update` |

The sidebar, list/detail routes, and mutation actions use exact permission keys returned by `/me` through `hasServerPermission()`. They do not infer API access from the local role matrix or a Super Admin fallback. Laravel remains the final authorization boundary.

There is intentionally no Laboratory DELETE action because the backend exposes no DELETE endpoint. Operational deactivation uses `PATCH status=inactive`.

## DTO and mutation boundary

`LaboratoryDto` is separate from the legacy frontend `Laboratory` type. It accepts only the canonical response fields:

- `id`
- `schoolId`
- `code`
- `name`
- `location`
- `capacity`
- `status`
- `createdAt`
- `updatedAt`

Single and collection envelopes are parsed independently. Missing envelopes, malformed fields, non-integer or non-positive capacity, unsupported status values, and invalid timestamps fail closed as controlled contract errors.

Create and update payload builders allowlist only `code`, `name`, `location`, `capacity`, and `status`. Update sends only fields that differ from the current server DTO. IDs, ownership, timestamps, personnel names, PC counts, and layout dimensions cannot cross the service boundary even if an unsafe caller supplies extra properties. Laboratory IDs are URL-encoded before use in a detail path.

PATCH uses the shared session API client: `credentials: include`, JSON `Accept` and `Content-Type`, the decoded Laravel XSRF cookie, and at most one retry after a 419 response. GET requests do not read or send CSRF data.

## Page and error behavior

List and detail requests expose explicit loading states. The list distinguishes an empty server collection from a failed request. Retry actions are available for network, server, and malformed-response failures; the UI never substitutes AppDB data.

Create and update validate required strings and a positive integer capacity before transport. Server 422 errors are mapped to matching form fields. A submission gate and disabled controls prevent duplicate mutation requests, and dialogs close only after a successful response. Returned DTOs are merged and sorted deterministically.

Error behavior is intentionally controlled:

- `401 UNAUTHENTICATED` forces an authoritative `/me` re-bootstrap so the existing auth guard decides whether to redirect;
- `403 FORBIDDEN` shows a safe access error and never simulates success;
- `404 LABORATORY_NOT_FOUND` shows an explicit detail not-found state;
- `409 ACTIVE_MEMBERSHIP_REQUIRED` and `409 SCHOOL_CONTEXT_REQUIRED` force session-context revalidation;
- `422 VALIDATION_FAILED` maps recognized mutable fields to the form;
- network, server, configuration, and invalid-response failures expose safe messages without internal details.

## Deliberately unintegrated local domains

The backend currently has no authoritative contract for personnel assignment, Device, Asset, LaboratoryLayout, Schedule, Journal, Maintenance, or Laboratory activity. Therefore the API pages do not display or synthesize:

- `headName` or `technicianName`;
- `pcCount`, online/problem counts, `layoutRows`, or `layoutCols`;
- devices, assets, schedules, journals, maintenance, or local audit activity.

No API Laboratory creation creates local devices or layouts. No record is joined to AppDB merely because its identifier happens to match. Denah and Monitoring actions are absent from the API list/detail. Direct access to the former layout route returns a controlled “Belum terintegrasi” state while the existing local data and schema remain untouched.

## Next integration steps

The next safe boundary is a backend Device API with explicit Laboratory ownership and technical-profile contracts, followed by a LaboratoryLayout API and an intentional placement/binding workflow. Jurnal Teknisi integration should then reference canonical Laboratory and Device identifiers through its own API contract, including offline conflict and synchronization semantics. None of those domains are migrated by this change.
