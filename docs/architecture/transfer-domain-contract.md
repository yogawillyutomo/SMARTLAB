# Transfer Domain Contract RFC

Status: Proposed for architecture review

Scope: Transfer v1 architecture and implementation sequencing only. This document does not implement a model, migration, route, controller, OpenAPI change, frontend, Loan, Maintenance, Asset, or Layout change.

Baseline: `451cab75c4980eb343ce0522f33ad11b61805807` (`feat(web): integrate canonical layout editor (#32)`)

Related locked authorities:

- [Device Domain Contract](device-domain-contract.md)
- [Layout Domain Contract](layout-domain-contract.md)
- the implemented Laravel Device and Layout services/controllers
- `packages/contracts/openapi.yaml`
- the exact server permission and active-membership architecture

## 1. Decision summary

Transfer is a permanent reassignment of a canonical Device's home custody from one canonical Laboratory to another Laboratory in the same School. It is not Loan, Maintenance custody, a current-location override, a generic Device metadata update, an Asset accounting workflow, or procurement.

The successful v1 result is exactly one Device mutation:

```text
Device.homeLaboratoryId: LAB-A -> LAB-B
```

The Device ID, location-neutral `deviceCode`, opaque `qrPublicId`, lifecycle, technical profile, and Layout history remain unchanged. No destination Layout placement is created. The Device is therefore unplaced in LAB-B immediately after a successful transfer.

V1 is an atomic executed command with durable immutable history. It has no requested, approved, in-transit, received, rejected, or cancelled workflow states. Approval separation, bulk transfer, replacement, and convenience orchestration are deferred.

## 2. Invariants and terminology

| Term | Meaning | Authority |
| --- | --- | --- |
| Source Laboratory | The current non-null `Device.homeLaboratoryId` before the command | Device row, resolved server-side |
| Destination Laboratory | The same-School active Laboratory selected by the command | Laboratory row, resolved server-side |
| Home custody | Permanent normal responsibility for a Device | Device Transfer |
| Home placement | Optional placement in the active Layout of the home Laboratory | Layout |
| Current location | Derived projection, not a Transfer field | Loan/Maintenance/Layout/home projection |
| Executed Transfer | One committed home-custody change and its history | Transfer domain |

The client never supplies `schoolId`, source Laboratory, actor, Device ownership, timestamps, or a new Device identity. The server derives School from exactly one active SchoolMembership and resolves every identifier inside that School.

## 3. Eligibility rules

A transfer is valid only when all of the following hold in one transaction. The source is never a client input; it is the Device's current server-derived home Laboratory.

1. The Device belongs to the current School.
2. `Device.homeLaboratoryId` is non-null; otherwise return `TRANSFER_SOURCE_UNASSIGNED` (409).
3. The destination belongs to the current School.
4. The destination differs from the current server-derived source.
5. The destination is active and eligible to receive new custody.
6. No active Layout of the current source Laboratory contains the Device.
7. The current draft of the current source Laboratory does not reference the Device.
8. The Device lifecycle is transferable under section 7.
9. No active Loan or Maintenance custody exists once those domains are implemented; v1 fails closed at that integration boundary.
10. The required Device version precondition is current.

An inactive source Laboratory does not prevent custodial cleanup. An inactive destination is not eligible for a new home assignment. Unknown and cross-tenant identifiers do not disclose whether another tenant's record exists.

## 4. Layout coordination

Transfer never edits an active or archived Layout. If the active LAB-A Layout contains Device D, Transfer fails with `TRANSFER_ACTIVE_PLACEMENT_EXISTS`.

The required operator workflow is:

```text
active Layout A contains D
  -> create or edit successor draft
  -> remove D from that draft
  -> activate successor
  -> predecessor becomes immutable archived history
  -> successor active Layout no longer contains D
  -> execute Transfer A -> B
```

The archived predecessor continues to contain the historical placement. Transfer does not delete, rewrite, or re-home that archived row.

If a current LAB-A draft exists but does not reference D, it does not block Transfer. The draft rule is Device-specific because blocking every draft would turn an unrelated unsaved edit into an operational custody lock and would contradict the Layout contract's sparse, draft-only mutation boundary. If the current draft references D, Transfer fails with `TRANSFER_DRAFT_REFERENCE_EXISTS`; the operator must remove the placement or delete the draft as appropriate.

No destination draft or active Layout is created or modified by Transfer. “Unplaced after Transfer” means only that no destination placement was created. An `in_service` or `spare` Device may appear in LAB-B's narrower unplaced-device candidate projection when all existing Layout eligibility rules pass; a `retired` Device remains unplaced but is excluded by that projection's locked lifecycle filter.

## 5. Laboratory status policy

| Source | Destination | v1 result | Rationale |
| --- | --- | --- | --- |
| active | active | Allow if all other rules pass | Normal operational reassignment |
| inactive | active | Allow if all other rules pass | Custodial cleanup out of a closed Laboratory is valid |
| active | inactive | Reject `TRANSFER_DESTINATION_INELIGIBLE` | New custody must not be assigned to a non-operational Laboratory |
| inactive | inactive | Reject `TRANSFER_DESTINATION_INELIGIBLE` | Cleanup cannot create new custody in a closed destination |

Reads and historical references to inactive Laboratories remain valid. This policy does not silently rewrite existing Devices or Layouts when a Laboratory is deactivated.

## 6. Identity and home semantics

Transfer preserves:

- Device ULID;
- School ownership;
- normalized location-neutral `deviceCode`;
- opaque stable `qrPublicId`;
- device type, lifecycle, technical profile, and technical-profile version;
- all Device change history before the transfer.

Only `homeLaboratoryId` changes. Initial null-to-active-Laboratory assignment remains the existing Device create/conditional PATCH behavior; Transfer v1 is for an established LAB-A to LAB-B reassignment and is not an unassignment endpoint.

## 7. Device lifecycle decision

Transfer v1 allows `in_service`, `spare`, and `retired` Devices. It rejects `decommissioned` Devices with `TRANSFER_DEVICE_NOT_ELIGIBLE`.

The rationale is that retired inventory still has durable identity and may need permanent custodial reassignment for storage, disposal preparation, or historical ownership cleanup. A retired Device remains retired and unplaced after transfer; Transfer does not reactivate it. `decommissioned` is terminal, so moving its home custody would make terminal disposition ambiguous and is outside v1. A future controlled disposition/recovery workflow would need its own contract and permission.

Active Loan or Maintenance custody is a separate future blocker. Transfer must not race a temporary-custody workflow or pretend to own current location. In v1, the integration check is a fail-closed precondition; no future domain is implemented here.

## 8. Persistent domain model

V1 introduces one conceptual aggregate record: an immutable executed `DeviceTransfer` history entry. It is not a state machine and has no mutable status. A committed row means the Device mutation committed.

Proposed `device_transfers` fields:

| Field | Contract |
| --- | --- |
| `id` | Server-generated ULID primary key |
| `school_id` | Required tenant boundary, server-derived, FK to School with restrict delete |
| `device_id` | Nullable live FK with null-on-delete for history survivability |
| `device_id_snapshot` | Required immutable Device ULID snapshot |
| `device_code_snapshot` | Required immutable display snapshot |
| `source_laboratory_id` / `destination_laboratory_id` | Nullable live FKs with null-on-delete |
| `source_laboratory_id_snapshot` / `destination_laboratory_id_snapshot` | Required immutable ULID snapshots |
| `source_laboratory_code_snapshot` / `destination_laboratory_code_snapshot` | Required bounded display snapshots |
| `source_laboratory_name_snapshot` / `destination_laboratory_name_snapshot` | Required bounded display snapshots |
| `actor_user_id` | Nullable live FK with null-on-delete |
| `actor_user_id_snapshot` / `actor_name_snapshot` | Required identity snapshots |
| `reason` | Nullable bounded operator explanation; no free-form workflow state |
| `device_version_before` / `device_version_after` | Required optimistic-concurrency evidence |
| `created_at` | Immutable execution time; no `updated_at` |

Live references are useful for authorized joins while records exist, but snapshots are the historical authority. Laboratory renames, actor deletion, Device decommissioning, and any future controlled cleanup must not rewrite history. There is no cascade that deletes a transfer record.

Indexes lead with tenant: `(school_id, device_id_snapshot, created_at, id)`, plus source and destination snapshot indexes. V1 deliberately adds no general idempotency infrastructure.

## 9. Transaction and concurrency strategy

Device `version` is the only aggregate concurrency token. Transfer does not add a second Device aggregate version. Every command requires the same strong quoted `If-Match: "<version>"` convention used by Device PATCH; missing or malformed values return `PRECONDITION_REQUIRED`, and a stale value returns `DEVICE_VERSION_CONFLICT` (412).

Because the source is derived from Device state while the repository-wide lock order remains Laboratory -> Layout -> Device, implementation uses two phases:

1. Perform a tenant-scoped read of Device ID, current `homeLaboratoryId`, and a version candidate. This is a routing candidate, not final authority.
2. If the candidate home is null, fail with `TRANSFER_SOURCE_UNASSIGNED`.
3. Resolve the destination inside the current School.
4. Lock source and destination Laboratories in ascending ULID order.
5. Lock the source active Layout and current source draft in deterministic Layout-ID order.
6. Lock the Device row.
7. Revalidate School ownership, `If-Match`, current home against the candidate source, destination activity, lifecycle, active placement, draft reference, and future custody blockers.
8. Increment Device `version` once, insert history and the transfer event, and commit.

If Device state changed during the pre-read window, the Device version check is authoritative. A stale request returns 412; after a deliberate reload, a request uses the newly current server-derived source. This algorithm introduces no second source token and aligns with existing Layout locking.

## 10. No-op and ambiguous-outcome policy

`A -> A` is invalid with `TRANSFER_SAME_LABORATORY`; it is never a history row and never a Device version increment. V1 has no retry-token or general idempotency framework. Mutations must not be automatically replayed after an ambiguous response.

If a successful POST response is lost, the client must GET the canonical Device and GET its Transfer history to reconcile whether the command committed. If the client manually repeats the exact old POST with the stale `If-Match`, it receives `DEVICE_VERSION_CONFLICT` (412) and no duplicate history row. A caller that intentionally loads the current Device version then submits a new command follows the normal current-state rules.

## 11. Exact permissions

The locked Device contract's exact future module is `device-transfers`. V1 uses only:

- `device-transfers.create`: execute an immediate permanent transfer;
- `device-transfers.view`: read Transfer history.

`devices.manage`, `devices.update`, `layouts.manage`, role names, and Super Admin fallbacks are not Transfer authority. Transfer does not require `devices.update` or `laboratories.update`; it is a dedicated custody mutation.

History access is authorized by `device-transfers.view` alone within the active School. It does not silently require `devices.view` or `laboratories.view`; the dedicated permission is the explicit authority to see Transfer snapshots. Unknown and cross-tenant Device IDs still return the same `DEVICE_NOT_FOUND` result. A client that needs live Device or Laboratory detail must separately hold those domain permissions and call those APIs.

## 12. Minimal REST API proposal

No duplicate root collection is needed for v1.

| Method and path | Permission | Result |
| --- | --- | --- |
| `POST /api/v1/devices/{deviceId}/transfers` | `device-transfers.create` | Execute one atomic transfer; requires `If-Match` |
| `GET /api/v1/devices/{deviceId}/transfers?page=&perPage=` | `device-transfers.view` | Deterministic paginated immutable history, newest first |

Request body:

```json
{
  "destinationLaboratoryId": "01J...",
  "reason": "Custodial reassignment after laboratory closure"
}
```

Only `destinationLaboratoryId` and optional bounded `reason` are accepted. `schoolId`, `sourceLaboratoryId`, `deviceId`, status, actor, timestamps, Device metadata, Layout IDs, placement coordinates, and unknown fields are rejected.

Successful POST returns HTTP 201 with the established `{ "data": ... }` envelope, `ETag: "<deviceVersionAfter>"`, and a Transfer DTO. GET returns HTTP 200 with the established paginated collection metadata and the same DTO shape. No Transfer detail endpoint or destination-placement endpoint is needed.

## 13. DTOs

Executed Transfer DTO:

```json
{
  "id": "01J...",
  "deviceId": "01D...",
  "deviceCode": "DEV-000123",
  "sourceLaboratory": { "id": "01A...", "code": "LAB-A", "name": "RPL 1" },
  "destinationLaboratory": { "id": "01B...", "code": "LAB-B", "name": "RPL 2" },
  "reason": "Custodial reassignment after laboratory closure",
  "actor": { "id": "01U...", "name": "Operator" },
  "deviceVersionBefore": 3,
  "deviceVersionAfter": 4,
  "createdAt": "2026-08-25T12:00:00Z"
}
```

The DTO uses immutable snapshots and does not claim that the Device currently resides in the destination Layout. It does not embed Layout placement, Loan custody, Maintenance state, Asset fields, telemetry, or a fabricated workflow status.

## 14. Stable error taxonomy

Platform errors remain authoritative: `UNAUTHENTICATED`, `FORBIDDEN`, `ACTIVE_MEMBERSHIP_REQUIRED`, `SCHOOL_CONTEXT_REQUIRED`, and `VALIDATION_FAILED`.

Transfer-specific errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 404 | `DEVICE_NOT_FOUND` | Device missing or outside current School |
| 404 | `LABORATORY_NOT_FOUND` | Destination missing or outside current School, without existence disclosure |
| 409 | `TRANSFER_SOURCE_UNASSIGNED` | Device has no established home Laboratory and cannot use Transfer v1 |
| 409 | `TRANSFER_SAME_LABORATORY` | Destination equals current source |
| 409 | `TRANSFER_ACTIVE_PLACEMENT_EXISTS` | Active source Layout still references the Device |
| 409 | `TRANSFER_DRAFT_REFERENCE_EXISTS` | Current source draft references the Device |
| 409 | `TRANSFER_DESTINATION_INELIGIBLE` | Destination is known but inactive or otherwise not receivable |
| 409 | `TRANSFER_DEVICE_NOT_ELIGIBLE` | Device is decommissioned or blocked by a future custody/lifecycle rule |
| 412 | `DEVICE_VERSION_CONFLICT` | `If-Match` is stale |
| 428 | `PRECONDITION_REQUIRED` | `If-Match` is missing or malformed |
| 422 | `VALIDATION_FAILED` | Malformed ULID, body, reason, pagination, or unknown field |

Rejected/no-op attempts never create a Transfer history row or a material Device audit event.

## 15. Audit and reconstruction

The immutable `device_transfers` row is the domain history. The same transaction also writes one `DeviceChangeEvent` with event type `device.transferred`, changed field `homeLaboratoryId`, Transfer ID, source/destination snapshots, actor snapshot, and Device version evidence. It must not copy technical profiles, telemetry, Asset data, or Layout geometry.

The combination of Transfer history and Device events reconstructs Device, source Laboratory, destination Laboratory, actor, time, and reason. Rejected validation, stale preconditions, same-Laboratory submissions, and ambiguous-response reconciliation write no new event.

## 16. Current-location and future-domain boundaries

Transfer changes permanent home custody only. The future location projection remains, in precedence order:

1. active Loan destination/custodian;
2. active Maintenance/repair custody;
3. active home Layout placement;
4. home Laboratory without placement;
5. unknown/unassigned.

V1 blocks an active Loan or Maintenance custody rather than trying to coordinate an unimplemented aggregate. A future Loan or Maintenance implementation may either close custody before Transfer or provide an explicitly reviewed orchestration command; it must not let Transfer rewrite temporary location, delete home placement, or bypass its own approval/return rules.

Asset relations are likewise future integration points. Transfer must not invent an Asset mutation or synchronize an AppDB Asset by matching codes.

## 17. PostgreSQL storage and integrity

PostgreSQL is canonical; portable SQLite tests must exercise equivalent constraints. Use ULIDs, ordinary strings, and check constraints rather than a PostgreSQL-native enum.

Required database protections:

- tenant-leading indexes for Device history and source/destination reporting;
- immutable timestamps (application policy and no update path);
- bounded snapshot strings and bounded reason;
- foreign keys with null-on-delete for optional live history joins and restrict-on-delete for School;
- no cascade from Device/Laboratory/Layout deletion into history;
- indexes for per-Device history and source/destination reporting;
- no `status` column for a workflow that v1 does not implement.

The Device home update, version increment, Transfer insert, and audit event must be one transaction. A failed history insert must roll back the home change.

## 18. Adversarial test matrix for later implementation

| # | Scenario | Expected result |
| --- | --- | --- |
| 1 | Ordinary active LAB-A -> active LAB-B | 201; home changes; one history/event |
| 2 | Active source placement contains Device | 409 `TRANSFER_ACTIVE_PLACEMENT_EXISTS` |
| 3 | Current source draft references Device | 409 `TRANSFER_DRAFT_REFERENCE_EXISTS` |
| 4 | Current source draft omits Device | Transfer allowed when other rules pass |
| 5 | Only archived Layout references Device | Transfer allowed; archive unchanged |
| 6 | Destination Layout exists | No destination placement or Layout mutation |
| 7 | In-service Device appears in LAB-B candidate projection | Device is eligible for unplaced query after commit |
| 8 | Cross-school Device ID | 404 `DEVICE_NOT_FOUND`; no leak |
| 9 | Cross-school destination ID | 404 `LABORATORY_NOT_FOUND`; no leak |
| 10 | Unknown Device ID | Same 404 as cross-school Device |
| 11 | Unknown destination ID | Same 404 as cross-school destination |
| 12 | Source equals destination | 409 `TRANSFER_SAME_LABORATORY`; no row/version |
| 13 | Device home is null | 409 `TRANSFER_SOURCE_UNASSIGNED`; use initial-assignment workflow |
| 14 | Current home is LAB-C, destination is LAB-B, current version supplied | Valid C -> B Transfer when other rules pass |
| 15 | Stale Device `If-Match` | 412; no row/version |
| 16 | Missing/malformed `If-Match` | 428; no row/version |
| 17 | Two concurrent A -> B transfers with the same initial version | One success; loser 412; one row |
| 18 | Home changes during the pre-read window | Stale `If-Match` is authoritative; 412; no row |
| 19 | Caller reloads after a committed change and submits a new current-state transfer | Newly derived source is used; normal rules apply |
| 20 | Inactive source -> active destination | Allowed for custodial cleanup |
| 21 | Active source -> inactive destination | 409 `TRANSFER_DESTINATION_INELIGIBLE` |
| 22 | Inactive source -> inactive destination | Same destination rejection |
| 23 | `in_service` Device | Transfer allowed |
| 24 | `spare` Device | Transfer allowed; remains spare and may be a candidate |
| 25 | `retired` A -> B | 201; remains retired, home becomes B, no placement, absent from unplaced candidates |
| 26 | `decommissioned` Device | 409 `TRANSFER_DEVICE_NOT_ELIGIBLE` |
| 27 | Active future Loan custody | Fail closed as Device operation blocked |
| 28 | Active future Maintenance custody | Fail closed as Device operation blocked |
| 29 | Successful POST response is lost | GET canonical Device and history reconcile outcome; no automatic POST replay |
| 30 | Manual repeat of old POST after committed Transfer | 412 stale version; one Transfer row only |
| 31 | Rejected transfer | No Transfer row, audit event, or version bump |
| 32 | Actor or Laboratory renamed/deleted later | Snapshot history remains reconstructable |
| 33 | Caller has create but not devices.update | Transfer allowed; no wildcard coupling |
| 34 | Caller has view but not devices.view/laboratories.view | History allowed through dedicated permission only |
| 35 | Cross-tenant active membership context | Operation fails before record lookup |
| 36 | History pagination with identical timestamps | Stable `createdAt DESC, id DESC` order |

## 19. Implementation sequencing gate

This RFC must be independently reviewed and locked before implementation. The later vertical slice may then add the migration, model, request, policy/middleware permission entries, application service, controller, OpenAPI contract, PostgreSQL migration/seed proof, portable tests, and audit assertions together.

No implementation in this RFC may:

- change generic Device PATCH semantics;
- mutate active or archived Layout rows;
- treat an unrelated draft as a blocker;
- create destination placement;
- add a current-location field;
- implement Loan, Maintenance, Asset, Transfer UI, or Transfer workflow states;
- match AppDB identifiers to canonical records;
- change schema/storage versions or the locked Device/Layout documents.

## 20. Consistency review checklist

- Device contract preserved: established home changes remain Transfer-only; identity and QR survive; lifecycle remains separate; version is the single Device concurrency token.
- Layout contract preserved: draft-only edits, immutable active/archived evidence, Device-specific draft blocker, archived references allowed, no automatic destination placement.
- Backend alignment: ULIDs, active-membership School scope, `{data: ...}` envelopes, exact permissions, 428/412 preconditions, tenant-scoped queries, and Device change events match current conventions.
- Tenant safety: client cannot choose School; unknown and cross-tenant Device/Laboratory IDs are indistinguishable.
- Race safety: Laboratory/Layout/Device lock ordering is explicit and compatible with current Layout mutation locking.
- Future safety: Loan/Maintenance/Asset remain named integration points rather than hidden Transfer behavior.

No source implementation, OpenAPI, migration, seed, dependency, frontend, or locked-contract mutation is part of this RFC.
