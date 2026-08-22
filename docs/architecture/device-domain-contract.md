# Device Domain Contract RFC

Status: Proposed for architecture review

Scope: Contract and implementation sequencing only; no Device API, database, frontend, or migration implementation

Base: `841753f8d8fa131e1ddb6c67a4895b1dc34f49be` (`feat(web): integrate laboratory API (#25)`)

## 1. Executive decision summary

A Device is one stable record for a physical, individually managed piece of equipment whose operational identity matters to SmartLab. It is not an Asset accounting record, a Layout position, a telemetry sample, a Loan item, or an agent installation. Agent-capable and non-agent-capable equipment can both be Devices.

The proposed backend v1 contract makes these decisions:

- every Device belongs to exactly one School, derived from the authenticated active membership;
- the internal identity is a server-generated ULID and the required human identity is a client-supplied, strictly normalized, School-scoped, location-neutral `deviceCode` that ordinary Device PATCH cannot change;
- the QR identity is a separate, server-generated, opaque, stable, never-recycled `qrPublicId`; it identifies a Device but never authorizes access;
- `homeLaboratoryId` is the chosen name for the nullable Laboratory normally responsible for the Device;
- home Laboratory, home Layout placement, current physical location, temporary custody, permanent transfer, maintenance custody, lifecycle, availability, and telemetry health are separate dimensions;
- Device v1 persists lifecycle (`in_service`, `spare`, `retired`, `decommissioned`) but does not persist a combined operational-status enum;
- the ten existing managed hardware types become a closed v1 taxonomy stored as a string plus database check constraint and API enum validation;
- type-specific technical data uses a closed JSONB object validated by immutable Device type and a separate server-controlled `technicalProfileVersion`, not a giant table, subtype tables, or EAV;
- Device API v1 does not expose `assetId` until a canonical Asset backend and a real foreign key exist;
- Device stores no Layout geometry and no denormalized current-location field;
- generic Device PATCH v1 permits only `in_service <-> spare`; retirement and decommissioning are deferred action-specific workflows, and no hard-delete endpoint is proposed;
- the canonical list is `GET /api/v1/devices`, with filters such as `homeLaboratoryId`; a duplicate nested Laboratory collection is not proposed.

Architecture acceptance test: a desktop PC with home Laboratory RPL 1 that is temporarily checked out for an Aula seminar keeps `homeLaboratoryId = LAB-RPL-1`. Loan owns the temporary destination and custody. If a schema requires changing the Device home Laboratory to Aula, that schema is rejected.

## 2. Existing frontend model audit

Stage 4D.1 correctly established several boundaries worth preserving:

- `Device`, `Asset`, and `LayoutElement` have different ownership;
- Device type is hardware type, independent from a student/teacher Layout role;
- `qrPublicId` is opaque, stable, collision-checked, and not derived from Device ID, Asset code, serial number, Laboratory, or type;
- lifecycle is separate from the existing operational status;
- technical profiles form a closed discriminated union with exact field allowlists;
- missing telemetry is rendered as unavailable rather than fabricated;
- `LayoutElement.referenceId` preserves Device identity when an element moves;
- Device/Asset links are optional and fail closed when missing, ambiguous, duplicated, or inconsistent;
- linked Asset mutations are guarded against identity/location drift;
- AppDB migrations are atomic and raw-preserving on integrity failure.

The local prototype also exposes boundaries that must not be copied into Laravel:

- `Device.laboratoryId` currently means both ownership/assignment and location;
- `positionCode` is stored on Device although position belongs to Layout;
- `status` combines telemetry health (`Online`, `Offline`, `Warning`, `Critical`) with future workflow states (`Maintenance`, `Reserved`);
- CPU, RAM, disk, temperature, uptime, network, and heartbeat live beside durable identity;
- `assetCode`, brand, model, serial, year acquired, and Laboratory are duplicated between Device and Asset;
- Monitoring simulates heartbeat and synchronizes Asset condition/status from Device status;
- Monitoring and legacy Device screens still select Laboratories from local `db.labs`; they must not be joined to canonical API Laboratories by matching IDs;
- the Asset page renders a prototype QR-like graphic labelled with `assetCode` and its opname simulation searches Asset code/serial; neither is the managed Device `qrPublicId` contract;
- Incident, Work Order, and Maintenance mostly link by free-text `assetCode`, not canonical Device ID;
- Loan stores `itemName` and `quantity`, not per-Device items or custody;
- the active local Layout currently requires every Device in a Laboratory to appear exactly once;
- local Laboratory IDs and AppDB Device IDs are not backend identities.

The companion field classification contains the property-by-property A-F decision: [device-domain-field-classification.md](device-domain-field-classification.md).

## 3. Existing backend convention audit

The implemented Laravel API establishes the following conventions:

- models use ULIDs;
- School is the tenant boundary;
- `ResolveCurrentMembershipContext` accepts exactly one active membership in one active School;
- permission middleware resolves that context and places it in request attributes;
- `school_id` is derived server-side and is prohibited in client payloads;
- tenant-owned records are queried by both School and record ID;
- missing and cross-tenant Laboratory IDs return the same `LABORATORY_NOT_FOUND` response;
- mutation requests reject identifiers, ownership, timestamps, and unknown fields;
- responses use a `{ "data": ... }` envelope and camelCase API properties;
- Laboratory collection order is deterministic (`code`, then `id`);
- code uniqueness is School-scoped at validation and database levels;
- API errors have stable `message` and `code`; validation adds field errors;
- permission keys are exact `module.action` strings without wildcard semantics;
- the current catalog already contains `devices.view`, `devices.create`, `devices.update`, `devices.export`, and `devices.manage`;
- implemented HTTP contracts, not speculative APIs, belong in `packages/contracts/openapi.yaml`.

Device implementation should reuse these conventions. This RFC must not be copied into OpenAPI until the implementation slice is approved and built.

## 4. Domain terminology

| Term | Meaning | Owner |
| --- | --- | --- |
| Device | Stable identity for one physical managed equipment unit | Device domain |
| School ownership | Tenant/security ownership; exactly one School | Identity/Device |
| Home Laboratory | Laboratory normally responsible for the Device | Device |
| Home placement | Optional permanent placement in a home Layout | Layout |
| Current physical location | Derived answer about where equipment is now | Projection across Layout/Loan/Maintenance |
| Temporary custody | Time-bounded possession outside normal custody | Loan or Maintenance |
| Transfer | Permanent reassignment of home custody | Future Transfer domain |
| Lifecycle | Durable service-life state | Device |
| Availability | Whether the Device can be allocated now | Future availability projection |
| Telemetry health | Agent/manual observations such as heartbeat and metrics | Telemetry subsystem |
| Asset | Administrative, procurement, financial, warranty, condition, and disposal record | Future Asset domain |
| Agent installation | Revocable credential and software installation reporting observations | Telemetry/agent domain |

## 5. Device identity model

| Identity | Required | Uniqueness | Mutable | Sensitivity | URL/public lookup suitability |
| --- | --- | --- | --- | --- | --- |
| Internal `id` | Yes | Global primary key | No | Internal identifier; not a secret | Acceptable in authenticated Device admin routes; never encode in QR |
| `school_id` | Yes | Ownership, not a standalone unique value | No | Tenant-security critical | Never client-selectable and not a public lookup key |
| `deviceCode` | Yes | Unique within School after canonical case normalization | No in ordinary v1 operations | Human-visible and guessable | Suitable for display/search, not an unauthenticated lookup key |
| `qrPublicId` | Yes | Global unique | No | Public identifier, not a credential | Future QR lookup only with authorization and rate limiting |
| `serialNumber` | No | Not hard-unique; duplicate warning within School | Yes, audited | May expose vendor/inventory detail | Authenticated search only; not public identity |
| `hostname` | No | Not hard-unique | Yes, audited | Network metadata | Authenticated search only |
| MAC address | No root field in v1 | Ambiguous: multiple, reused, virtual, randomized | Changes with interface/hardware | Network identifier | Not a URL or QR identity; future network-interface/telemetry model |

`deviceCode` is retained from the backend foundation terminology because it avoids confusion with Asset code. V1 chooses **client-supplied under a strict normalized pattern**, rather than server-generated. Existing inventories commonly have labels that operators must preserve or map deliberately, while server-only generation would force avoidable relabelling. The server trims and uppercases input, then requires `^[A-Z0-9][A-Z0-9-]{2,31}$` (3-32 ASCII characters) and enforces unique normalized `(school_id, device_code)`. It must be location-neutral. Examples such as `DEV-000123` or type-prefixed `PC-000123` are acceptable; `PC-RPL1-001` is discouraged because permanent transfer would make the code misleading. The code is a human-facing identifier, not a database foreign identity or authorization token. A transfer preserves `deviceCode` and `qrPublicId`.

Ordinary PATCH cannot rewrite `deviceCode`. This is an API v1 mutation policy, not a claim that the value can never be corrected. A future controlled administrative correction may fix proven data-entry mistakes without changing the Device ULID, with normalized uniqueness checks, a reason, an audit event, and retained alias/history. This is not part of Device API v1.

## 6. School/tenant ownership

Every Device row has a required `school_id` foreign key. The active membership context is the sole authority for that value.

Invariants:

- create ignores no ownership supplied by the client; ownership fields are prohibited;
- list, detail, and patch begin with `where school_id = currentSchoolId`;
- another School's Device is indistinguishable from an unknown Device;
- every related canonical Laboratory must belong to the same School;
- cross-tenant Laboratory validation fails with the same safe field error as an unknown Laboratory;
- authorization is server-side and exact-permission based; frontend roles are never authoritative;
- School hard deletion is restricted while Devices exist.

## 7. Home Laboratory semantics

The canonical field is `homeLaboratoryId` (database `home_laboratory_id`).

Why this name:

- `home` communicates the normal/base relationship rather than live location;
- `custodianLaboratoryId` can be confused with a person or temporary custodian;
- `assignedLaboratoryId` is often read as the current assignment and invites Loan code to overwrite it.

The relationship is nullable. Valid nullable cases include a newly received Device awaiting assignment, a spare Device in central School storage, centralized network infrastructure, and a retired Device no longer under a Laboratory. Null means “no home Laboratory assigned”; it does not mean the Device lacks School ownership.

If present, the ID must resolve to a canonical Laravel Laboratory in the current School. An inactive Laboratory may remain referenced for history, but product policy should prevent assigning new Devices to it. The foreign key should restrict Laboratory deletion rather than silently nulling or cascading Device ownership.

Create may set null or a valid same-School home Laboratory. Generic PATCH implements only the following state machine:

| Existing value | Requested value | Generic PATCH result |
| --- | --- | --- |
| null | null or omitted | No-op |
| null | same-School canonical Laboratory ID | Allowed once as initial assignment |
| Laboratory A | Laboratory A or omitted | No-op |
| Laboratory A | Laboratory B | Forbidden; future Device Transfer required |
| Laboratory A | null | Forbidden; future Device Transfer/unassignment workflow required |

An unknown and a cross-tenant Laboratory ID fail closed with the same field error and reveal no existence. Initial assignment is audited and protected by the same optimistic concurrency rule as other PATCH fields. Permanent reassignment and removal of established custody belong to the future Device Transfer domain.

## 8. Current location and temporary custody semantics

Device v1 has no `currentLocation`, `currentLaboratoryId`, `currentRoom`, or equivalent denormalized field. Current location is a projection with precedence and provenance, not a second writable Device property.

A future projection may answer:

1. active Loan checkout destination/custodian, if any;
2. active Maintenance/repair custody, if any;
3. active home Layout placement, if any;
4. home Laboratory without a placement, if known;
5. unknown/unassigned.

Every projected answer must state its source and effective period. Temporary Loan or repair custody must not rewrite `homeLaboratoryId` and must not delete home Layout placement.

## 9. Lifecycle model

Device v1 persists exactly one lifecycle dimension:

- `in_service`: intended for operational service;
- `spare`: retained and potentially allocatable, but not normally deployed;
- `retired`: removed from normal service but identity/history retained;
- `decommissioned`: terminal disposition state; identity/history retained.

Device API v1 deliberately narrows the Stage 4D.1 foundation. Generic PATCH supports only `in_service <-> spare`; same-state requests are no-ops. It never accepts `retired` or `decommissioned` as a target.

| Existing lifecycle | Requested through generic PATCH | Result |
| --- | --- | --- |
| `in_service` | `in_service` | No-op |
| `in_service` | `spare` | Allowed with `devices.update` |
| `spare` | `spare` | No-op |
| `spare` | `in_service` | Allowed with `devices.update` |
| `in_service` or `spare` | `retired` or `decommissioned` | Forbidden through generic PATCH |
| `retired` or `decommissioned` | any value | No generic PATCH transition |

Future terminal lifecycle actions use dedicated services/endpoints and exact permissions such as `devices.retire` and `devices.decommission`. They must audit the action and transactionally reject incompatible active Loan or maintenance custody. Decommissioning is terminal; Device code and QR remain reserved. Existing `devices.manage` grants no implicit lifecycle authority.

Lifecycle is not Online/Offline health, Loan availability, Maintenance custody, reservation, or physical condition.

## 10. Operational health and telemetry boundary

The core `devices` table does not store Online, Offline, Warning, Critical, CPU, RAM, disk, temperature, uptime, network state, IP address, or last heartbeat.

Future telemetry should use separate records such as agent installations, heartbeats, metrics, detected hardware/software inventory, alerts, and a replaceable latest-health projection. Raw metrics should have retention appropriate to the PRD (pilot guidance: 30-90 days); durable summaries may have a longer lifecycle.

`Maintenance` and `Reserved` are not telemetry values. Maintenance belongs to maintenance workflow/custody; reservation and on-loan states belong to availability/transaction projections. A future Device detail response may embed an authorized `operationalSummary`, but it is not a Device persistence contract and absence must display as unknown.

Declared technical information (for example expected OS or configured firmware) may live in a technical profile. Agent-observed OS or firmware must retain observation source/time and must not silently overwrite declared inventory data.

## 11. Device type taxonomy

Backend v1 supports the ten audited values unchanged:

`desktop_pc`, `laptop`, `server`, `network_switch`, `router`, `access_point`, `printer`, `projector`, `ups`, `other`.

Representation policy:

- API: closed string enum;
- application: PHP enum or equivalent single catalog plus FormRequest `Rule::in`;
- PostgreSQL: `varchar(32)` with an explicit CHECK constraint, not a native PostgreSQL enum;
- OpenAPI: root enum plus Device-schema `oneOf` variants that validate `technicalProfile` from root `deviceType` without duplicating a discriminator inside the profile;
- unknown strings: rejected with `VALIDATION_FAILED`;
- new types: additive contract plus validation/check-constraint migration, backward-compatible profile addition, tests, and documentation.

`deviceType` is required at create and immutable through Device PATCH v1. Reclassifying a desktop PC as a router, server, or another hardware type is not ordinary metadata editing; a future audited administrative correction/data-migration workflow must validate and transform the complete profile explicitly. The `other` type is the controlled escape hatch and does not allow undocumented root Device types.

## 12. Technical profile recommendation

Recommendation: a non-null JSONB `technical_profile` object containing only type-specific properties, paired with a required server-controlled integer `technical_profile_version >= 1`. The root `device_type` is the sole discriminator. The profile does not duplicate `kind` or `schemaVersion`.

Minimum valid profile example:

```json
{}
```

Why JSONB:

- Laravel can select the complete validation schema from immutable `deviceType` plus server-controlled `technicalProfileVersion`, then validate exact allowed fields, scalar types, ranges, and cross-field rules;
- PostgreSQL stores the complete profile atomically and can add targeted expression/GIN indexes when real reporting needs emerge;
- OpenAPI can describe a discriminated `oneOf` contract;
- incomplete inventories remain valid without hundreds of nullable columns;
- new profile fields/types have lower migration cost than subtype tables;
- the contract remains stricter and more type-safe than EAV.

Alternatives:

| Strategy | Decision | Reason not chosen |
| --- | --- | --- |
| Giant Device table | Reject | Excessive sparse columns, weak type-specific meaning, high schema noise |
| JSONB profile | Choose | Best balance of validation, evolution, PostgreSQL support, and API clarity |
| Per-type subtype tables | Defer | Strong relational typing but high join and migration burden for ten evolving types |
| EAV/specification rows | Reject | Weak typing, difficult validation/querying, unclear OpenAPI, poor integrity |

Risks and controls:

- database constraints cannot express the full profile contract: use one centralized server validator and contract tests;
- JSON shape can drift: reject unknown keys, keep the version in `technical_profile_version`, and migrate profiles explicitly on the server;
- reporting over arbitrary keys can become expensive: index only proven fields or promote stable reporting dimensions later;
- full-profile PATCH replacement can lose concurrent edits: protect PATCH with optimistic versioning; do not apply unvalidated JSON merge semantics.

If a client PATCH includes `technicalProfile`, the supplied object replaces the entire previous object. There is no recursive, deep, JSON Merge Patch, or key-preserving merge behavior. The replacement must be complete for the Device's immutable `deviceType` and current server-controlled `technicalProfileVersion`. Clients cannot supply or select that version. A server data migration may transform a profile and increment `technicalProfileVersion` explicitly; it also increments the Device concurrency `version` and is audited.

For type `other`, v1 permits at most 32 properties. Keys must be 1-64 characters matching `^[A-Za-z][A-Za-z0-9_.-]*$`; values may only be string, finite number, boolean, or null; strings are limited to 500 Unicode characters; nested objects and arrays are rejected. Serialized `technicalProfile` is limited to 16 KiB, while normal request/body protections continue to apply.

Current Stage 4D.1 type-specific profiles are the candidate v1 field catalog, subject to the companion classification. Frontend `technicalProfile.kind` is used only to validate/migrate the local record and maps to root `deviceType`; it is not copied into backend JSONB. Free-text monitor/peripheral ownership, battery health, and lamp hours require special treatment because they may represent separate Assets or observations rather than static specifications.

## 13. QR public identity

`qrPublicId` is required, opaque, URL-safe, non-sequential, stable, globally unique, and never recycled. Only the server generates it; create and PATCH reject the field. V1 uses the literal prefix `devq_` followed by unpadded base64url encoding of at least 128 cryptographically random bits (22 characters for 128 bits). The database unique constraint remains the final collision guard. The value must not equal or encode the Device ULID, Device code, Asset code, serial number, School, Laboratory, or Device type.

The identifier survives transfer, retirement, and decommissioning. Replacement creates a new Device and new QR identity. Decommissioned QR lookup may eventually resolve a read-only historical record rather than being reassigned.

QR identity is not authorization. A future scan flow still requires authentication where appropriate, tenant context, endpoint permission/policy, rate limiting, safe not-found behavior, and action-specific authorization. No scan endpoint, QR image, label, or print contract is included here.

## 14. Asset boundary

Device owns operational physical identity and technical classification. Asset owns administrative inventory: acquisition, funding, price, supplier, warranty, condition inspections, documents, disposal, and accounting identity. Neither is a substitute for the other.

Decision: choose Option A. Device API v1 exposes no `assetId` while no canonical Asset backend exists.

- Option B (nullable placeholder without FK) is rejected because it creates unverifiable identifiers and migration debt.
- Option C (block Device until Asset is built) preserves immediate referential integrity but delays the needed Device authority and is unnecessary if the contract omits the relation.
- Frontend AppDB Asset IDs and `assetCode` values must never be written into backend Device relations.

Recommended sequencing is Device v1 without Asset relation, canonical Asset backend, then a dedicated Device-Asset link migration/contract using a same-School foreign key and a unique constraint for zero-or-one on both sides. Linking must be explicit and audited; code/text similarity is only a migration candidate, never proof.

## 15. Layout boundary

Layout owns rooms, versions, geometry, elements, coordinates, slot labels, and placement history. Device owns Device identity. Device rows never store row, column, span, rotation, `positionCode`, or Layout element ID.

A future authoritative placement references the canonical backend Device ULID. At most one active home placement may reference a Device, but placement is optional. The current local invariant that every Device must appear in an active Layout must not become a Device creation invariant.

Moving equipment inside a room is a Layout operation. Temporary Loan/repair custody leaves home geometry intact and projects the Device as temporarily away. Permanent transfer must coordinate the old placement, home Laboratory, optional new placement, and history without circular ownership.

Existing local `LayoutElement.referenceId -> AppDB Device.id` remains untouched. A future Layout migration needs an explicit local-to-backend Device ID map.

## 16. Loan/event scenario

Scenario: the School needs two desktop PCs, one router, one network switch, one projector, and supporting cables for a seminar in the Aula. The managed Devices originate from Laboratory RPL 1.

Future workflow:

`REQUEST -> AVAILABILITY CHECK -> APPROVAL -> DEVICE SELECTION -> QR CHECKOUT -> CONDITION CHECK -> HANDOVER -> TEMPORARY USE IN AULA -> RETURN -> RETURN INSPECTION -> INCIDENT IF DAMAGED -> LOAN CLOSED`

The Loan domain must eventually record borrower, event/purpose, destination, requested start/end, approval, checkout, actual return, checkout/return condition, accessories, handover actors, and per-Device items. Supporting cables may be serialized Devices/Assets or quantity stock depending on inventory policy. Router configuration backup/restore metadata belongs to a later handover/technical procedure.

Throughout the workflow:

- each Device retains School ownership;
- each Device retains `homeLaboratoryId = LAB-RPL-1`;
- the home Layout placement is not deleted;
- active Loan items own temporary custody and Aula destination;
- return closes custody and restores availability without “moving back” the Device home field;
- damage creates an Incident linked to the canonical Device (and Asset later).

Acceptance assertion: if checkout requires setting `homeLaboratoryId` to Aula, the Device/Loan design fails this RFC.

## 17. Transfer semantics

Transfer is permanent home-custody reassignment, not Loan, maintenance, lifecycle, or a generic Device PATCH.

A future transfer transaction should record Device, from/to home Laboratory (nullable where policy permits), reason, requested/approved/effective timestamps, actors, condition/handover evidence, and status/history. Completion must lock the Device, verify same-School relationships, reject incompatible active Loan/maintenance states, update home Laboratory, coordinate home Layout placement, coordinate linked Asset only after Asset exists, and emit audit history atomically.

Device ID, Device code, and QR identity survive transfer. Transfer endpoints and tables are deferred.

## 18. Proposed canonical Device DTO

```json
{
  "id": "01ARZ3NDEKTSV4RRFFQ69G5FAV",
  "schoolId": "01ARZ3NDEKTSV4RRFFQ69G5FAW",
  "deviceCode": "DEV-000123",
  "qrPublicId": "devq_v7LhQ8rKx2tYp4Nc6Wm9Ag",
  "deviceType": "desktop_pc",
  "lifecycleStatus": "in_service",
  "homeLaboratoryId": "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  "serialNumber": "SN-2026-00123",
  "hostname": "PC-RPL-023",
  "brand": "ExampleBrand",
  "model": "ExampleModel",
  "technicalProfileVersion": 1,
  "technicalProfile": {
    "processor": "Example CPU",
    "ramGB": 16,
    "storageGB": 512
  },
  "version": 1,
  "createdAt": "2026-08-23T09:00:00Z",
  "updatedAt": "2026-08-23T09:00:00Z"
}
```

`homeLaboratoryId`, `serialNumber`, `hostname`, `brand`, and `model` are nullable but always present in the canonical DTO. `technicalProfileVersion` is an integer controlled by the server. `version` is the optimistic-concurrency token and is independent from the profile schema version.

These are canonical persisted Device fields. The DTO deliberately excludes Asset relation, Layout placement/geometry, current location, Loan destination/custody, transfer history, maintenance state, current availability, telemetry health, IP/MAC, and agent identity. Those may appear only in future explicitly named projections or related resources, never silently as Device core fields.

## 19. Proposed create payload

Exact client allowlist:

```json
{
  "deviceCode": "DEV-000123",
  "deviceType": "desktop_pc",
  "homeLaboratoryId": "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  "lifecycleStatus": "in_service",
  "serialNumber": "SN-2026-00123",
  "hostname": "PC-RPL-023",
  "brand": "ExampleBrand",
  "model": "ExampleModel",
  "technicalProfile": {
    "processor": "Example CPU",
    "ramGB": 16,
    "storageGB": 512
  }
}
```

Rules:

- only `deviceCode` and `deviceType` are required;
- `deviceCode` is client-supplied, then trimmed, uppercased, pattern-validated, and checked case-insensitively within the current School;
- lifecycle is optional and limited to `in_service` or `spare` at creation, default `in_service`;
- home Laboratory is optional/nullable and same-School validated;
- `serialNumber`, `hostname`, `brand`, and `model` are optional nullable strings;
- technical profile is optional; when absent the server stores `{}` under profile schema version 1, and when present it must pass complete strict validation for `deviceType` version 1;
- unknown fields are rejected;
- `id`, `schoolId`, snake_case ownership aliases, `qrPublicId`, `technicalProfileVersion`, Asset fields, timestamps, concurrency `version`, status, location, Layout, network identity, and telemetry fields are prohibited.

## 20. Proposed patch payload

The request body may contain any non-empty subset of this exact allowlist:

```json
{
  "serialNumber": null,
  "hostname": "PC-RPL-023",
  "brand": "ExampleBrand",
  "model": "ExampleModel",
  "homeLaboratoryId": "01ARZ3NDEKTSV4RRFFQ69G5FAX",
  "technicalProfile": {
    "processor": "Example CPU",
    "storageGB": 512,
    "ramGB": 32
  },
  "lifecycleStatus": "spare"
}
```

Rules:

- at least one mutable field is required;
- unknown fields are rejected;
- `serialNumber`, `hostname`, `brand`, and `model` are nullable metadata replacements;
- `homeLaboratoryId` is conditionally mutable only for null-to-same-School initial assignment; established Laboratory-to-other-Laboratory and Laboratory-to-null changes are forbidden;
- `technicalProfile` atomically replaces the complete previous object and is validated against immutable `deviceType` plus the server-controlled current profile version; no deep merge occurs;
- `lifecycleStatus` accepts only `in_service` or `spare`, with only the `in_service <-> spare` transition and same-state no-op;
- explicitly not patchable: `id`, `schoolId`, `qrPublicId`, `deviceCode`, `deviceType`, `technicalProfileVersion`, `createdAt`, and `updatedAt`;
- also prohibited: Asset relation, Layout, current location, network identity, telemetry, terminal lifecycle targets, concurrency `version` in the body, and every undocumented field;
- detail and successful PATCH responses emit strong `ETag: "<version>"`; list items expose the same integer in `version`;
- PATCH requires the matching strong `If-Match: "<version>"` header; the update matches School, Device ID, and version and increments version atomically;
- missing/invalid precondition returns `428 PRECONDITION_REQUIRED`; a stale version returns `412 PRECONDITION_FAILED` with stable code `DEVICE_VERSION_CONFLICT`; neither performs a partial mutation.

## 21. Proposed REST endpoints

| Method | Path | Permission | Behavior |
| --- | --- | --- | --- |
| GET | `/api/v1/devices` | `devices.view` | Tenant-scoped paginated list |
| POST | `/api/v1/devices` | `devices.create` | Create one Device; server generates School/ULID/QR/version |
| GET | `/api/v1/devices/{deviceId}` | `devices.view` | Tenant-scoped detail; cross-tenant equals missing |
| PATCH | `/api/v1/devices/{deviceId}` | `devices.update` | Allowlisted metadata update, initial home assignment, or active/spare transition with optimistic concurrency |

No DELETE endpoint is proposed. Decommissioning retains identity and history. QR lookup, QR image/print, bulk import/export, transfer, replacement, telemetry, Loan, and Layout binding use later contracts.

Canonical Laboratory filtering uses `/devices?homeLaboratoryId=...`, not a duplicate `/laboratories/{id}/devices` collection. A flat collection composes with type, lifecycle, bounded search, and pagination; it also represents null-home Devices without inventing another route.

## 22. Filtering, sorting, and pagination

Exact v1 collection query allowlist:

- `homeLaboratoryId`: exact canonical same-School Laboratory ULID;
- `deviceType`: one exact enum value;
- `lifecycleStatus`: exact enum;
- `search`: trimmed 1-100 character search over `deviceCode`, `hostname`, `serialNumber`, `brand`, and `model` only;
- `page`: positive integer, default 1;
- `perPage`: integer 1-100, default 25.

V1 exposes no client-selected sort. Canonical order is normalized `deviceCode ASC`, then `id ASC`; the secondary key is mandatory for deterministic pages. Page-number pagination supports administration totals and direct page navigation.

Proposed collection envelope:

```json
{
  "data": [],
  "meta": {
    "page": 1,
    "perPage": 25,
    "total": 0,
    "lastPage": 1
  }
}
```

Unknown query parameters, arrays where scalars are required, malformed ULIDs, invalid enum values, out-of-range pagination, or invalid search length return `422 VALIDATION_FAILED` with field errors. `homeLaboratoryId` filtering accepts only a canonical Laboratory in the current School; unknown and cross-tenant IDs return the same `422` field error and reveal no existence. An inactive same-School Laboratory remains a valid filter because existing Devices may retain that home reference. V1 does not search JSONB technical profiles and does not define a null-home filter.

## 23. Permission proposal

The current permission catalog already contains:

- `devices.view`
- `devices.create`
- `devices.update`
- `devices.export`
- `devices.manage`

The four Device CRUD endpoints in this RFC use only:

| Endpoint | Exact permission |
| --- | --- |
| `GET /api/v1/devices` | `devices.view` |
| `POST /api/v1/devices` | `devices.create` |
| `GET /api/v1/devices/{deviceId}` | `devices.view` |
| `PATCH /api/v1/devices/{deviceId}` | `devices.update` |

There is no export endpoint in Device API v1. `devices.manage` receives no new authority and is not an implicit wildcard.

Proposed exact future keys when corresponding workflows exist:

- `devices.retire`
- `devices.decommission`
- `device-transfers.view`
- `device-transfers.create`
- `device-transfers.approve`
- `device-qr.view`
- `device-qr.print`
- `device-telemetry.view`
- `device-telemetry.manage`

The two-segment names preserve the repository's exact `module.action` convention. No `devices.*`, `devices.qr.*`, role-name fallback, or implicit `manage` wildcard is proposed.

Proposed role matrix (policy proposal, not a seed change):

| Role | Core Device | Lifecycle/transfer | QR | Telemetry |
| --- | --- | --- | --- | --- |
| Admin Lab | view, create, update, export | retire, initiate transfer | view, print | view |
| Kepala Lab | view, export | approve/authorize policy through future transfer domain; no generic update | view | view |
| Teknisi | view, update technical fields | request/execute authorized operational steps; no unilateral permanent transfer | view | view, manage |
| Guru | view limited operational detail | none | view through permitted workflow | safe summary only |
| Siswa | no inventory-wide Device view | none | future incident/scan-specific restricted flow only | none |
| Pimpinan | view, export read-only | none | none by default | aggregated/read-only summary |

Super Admin continues to receive explicitly catalogued permissions through the existing seeder convention, not through controller role checks.

## 24. Error contract proposal

Reuse:

- `UNAUTHENTICATED` (401)
- `FORBIDDEN` (403)
- `ACTIVE_MEMBERSHIP_REQUIRED` (409)
- `SCHOOL_CONTEXT_REQUIRED` (409)
- `VALIDATION_FAILED` (422 with field errors)

Add when implemented:

- `DEVICE_NOT_FOUND` (404) for missing and cross-tenant Device IDs;
- `PRECONDITION_REQUIRED` (428) for a missing or malformed required `If-Match` precondition;
- `DEVICE_VERSION_CONFLICT` (412 `PRECONDITION_FAILED`) for a stale optimistic version;
- `DEVICE_HOME_LABORATORY_TRANSFER_REQUIRED` (409) when generic PATCH attempts established-home reassignment or removal;
- `DEVICE_LIFECYCLE_TRANSITION_INVALID` (409) for a future action endpoint whose requested transition is disallowed; generic PATCH terminal values fail as `VALIDATION_FAILED` because they are outside its allowlist;
- `DEVICE_OPERATION_BLOCKED` (409) for an invariant such as active Loan/maintenance preventing a transition;
- `DEVICE_TECHNICAL_PROFILE_INVALID` should normally be represented as `VALIDATION_FAILED` field errors, not a second validation envelope.

Unknown/cross-tenant home Laboratory produces the same validation message. Production responses never include SQL, stack traces, model names, or another tenant's identifiers.

## 25. Tenant/security invariants

- exactly one School owns every Device;
- the server derives School from active membership;
- clients cannot choose or patch School;
- every Device lookup and mutation is School-scoped before ID matching;
- home Laboratory must be canonical and same-School;
- cross-tenant identifiers fail closed and do not reveal existence;
- exact server permissions and policies authorize every action;
- frontend role names and local permission matrices are not security boundaries;
- QR identity does not grant access;
- mass assignment is closed; FormRequests reject unknown and protected fields;
- technical profile keys and scalar/range rules are allowlisted;
- Device code, QR, lifecycle, transfer, and material profile changes are audited;
- audit text should not unnecessarily expose QR identifiers or sensitive network data;
- no invasive telemetry is permitted; agent rules explicitly prohibit keystrokes, screenshots, browser history, documents, or user content.

## 26. Data integrity and concurrency invariants

Proposed database-level guarantees:

- ULID primary key;
- required `school_id` FK with restricted delete;
- nullable `home_laboratory_id` FK with restricted delete;
- unique normalized `(school_id, device_code)`;
- globally unique `qr_public_id`;
- CHECK constraints for Device type and lifecycle;
- non-null JSON object plus integer `technical_profile_version >= 1`, with complete versioned shape validation in application code;
- integer `version >= 1` for optimistic locking;
- indexes for School plus home Laboratory, type, lifecycle, and normalized search candidates.

Serial numbers and hostnames are not hard-unique because manufacturer data, cloned machines, blanks, and administrative reuse are real. Non-empty duplicates within one School should be surfaced as warnings/data-quality findings, not silently chosen as identity. Hostname is nullable, mutable, and not universally applicable. MAC and IP addresses remain entirely outside canonical Device v1: one Device may have multiple/replaced/randomized interfaces, while IP is mutable runtime or network configuration. Neither receives a Device-column uniqueness rule, and this RFC does not introduce a network-interface subsystem.

PostgreSQL is canonical production storage and SQLite is the portable automated-test database. Device type and lifecycle therefore use ordinary string columns plus portable `CHECK (value IN (...))` semantics supported by both engines, never a PostgreSQL native enum. The implementation migration must use Laravel/schema SQL that is exercised on both drivers; if one framework helper emits driver-specific DDL, use explicitly tested driver-aware equivalent checks. FormRequest/domain validation remains mandatory and identical across databases even when a database constraint provides defense in depth.

Concurrency rules:

- Device-code races rely on the School-scoped unique constraint and deterministic validation/conflict mapping; a server-generated QR collision is retried before response, with the global unique constraint as the final guard;
- every generic PATCH requires `If-Match: "<version>"`, conditionally updates by current School, Device ID, and version, then increments `version` exactly once; ordinary metadata is therefore not last-write-wins;
- initial home Laboratory assignment and atomic technical-profile replacement use that same optimistic lock;
- a server profile-schema migration increments `technicalProfileVersion` and Device `version` in one audited transaction;
- future Loan checkout must lock/check selected Devices so two approvals cannot check out the same Device;
- decommissioning must check active custody under the same transaction when Loan exists;
- future Layout placement must enforce one active home placement per Device and same home Laboratory;
- transfer coordinates Device, placement, and later Asset relation atomically;
- no operation may partially update Device and then fail related integrity work.

## 27. Local AppDB migration considerations

No automatic migration is approved by this RFC. A future import must be explicit, previewable, auditable, and atomic.

Classification:

- potentially canonical after validation: Device type, lifecycle, hostname, serial, brand, model, and selected technical profile fields;
- requires new identity: every backend Device gets a new ULID; AppDB IDs are mapping inputs only;
- requires Laboratory mapping: local `laboratoryId` maps to canonical Laboratory by reviewed code/data mapping, never coincidental ID equality;
- requires normalization: blank strings to null, code policy, case normalization, numeric ranges, profile version, and type/profile consistency;
- do not migrate as Device core: `positionCode`, coordinates, combined status, IP, network, heartbeat, and metric values;
- Layout references: retain an import mapping from AppDB Device ID to backend Device ULID for a later Layout migration;
- Asset links: ignore local `assetId` and do not infer a backend link until Asset exists; preserve candidate evidence separately for review;
- `assetCode`: do not automatically promote to `deviceCode`; operators may supply reviewed location-neutral Device codes under the canonical pattern, and collisions block import;
- QR: local values are migration evidence only and are never accepted through create/PATCH or copied as canonical identifiers; the server generates every backend `qrPublicId`, and migration produces an old-label-to-new-QR mapping/relabel report;
- duplicate/ambiguous local QR evidence must be reported rather than selecting a record;
- telemetry is disposable prototype/runtime data and is not imported;
- free-text monitor/peripheral data may require Asset/accessory mapping instead of profile migration.

The migration should produce a dry-run report, deterministic mapping file, row errors/warnings, counts, and rollback strategy. It must not change AppDB schema or local data during Device API implementation.

## 28. Explicit deferred scope

Deferred and not implemented by this RFC:

- Laravel Device model, migration, requests, resources, controllers, policies, services, routes, tests, or OpenAPI changes;
- frontend Device service/UI/API integration or AppDB schema bump;
- Asset backend and Device-Asset link;
- Layout backend, placement, binding, geometry, and local reference migration;
- Loan, Loan items, checkout, handover, return, availability, and custody projection;
- Transfer and location history;
- Maintenance/repair custody;
- Incident, Work Order, and Jurnal Teknisi backend links;
- telemetry ingestion, agent enrollment, heartbeat, metrics, alerts, realtime, and WebSocket;
- QR scan routes, images, labels, printing, or authorization flows;
- replacement, bulk import, CSV/export, hard delete, deployment, CI, and new dependencies.

## 29. Recommended implementation sequence

1. Architecture review: approve terminology, identity, nullable home relationship, API shape, JSONB profile, and permission additions.
2. Contract slice: add Device OpenAPI contract and server test plan only when implementation is authorized.
3. Device persistence/domain: migration, model, profile validator, lifecycle service, optimistic lock, tenant/policy services, and audit.
4. Device REST vertical slice: list/create/detail/PATCH, exact permissions, errors, pagination, feature tests, and PostgreSQL checks.
5. Frontend Device integration: strict DTO parser, server-authoritative permissions, list/detail/create/update states; do not join AppDB Layout/Asset.
6. Canonical Asset foundation: inventory/procurement model and API.
7. Device-Asset relationship: real FK, one-to-one integrity, controlled link/unlink, and reviewed migration candidates.
8. Transfer/custody foundation: permanent transfer history and transaction invariants.
9. Loan domain: per-Device availability, checkout/return, condition, destination, and incident creation.
10. Layout domain: canonical Device bindings and optional home placement; later migrate local references with explicit ID maps.
11. Telemetry/agent domain: revocable credentials, heartbeats/metrics, retention, latest-health projection, alerts, and safe monitoring integration.
12. Incident/Work Order/Maintenance links: canonical Device references and snapshot semantics.

Each stage is a separate reviewed PR. Device core must not pre-implement the later domains with placeholder IDs or status fields.

## 30. Open architectural questions

No blocking `HUMAN_DECISION_REQUIRED` item remains in this RFC. The following bounded implementation parameters still require confirmation during the implementation backlog item, without changing the locked contracts above:

- exact maximum lengths and Unicode normalization rules for nullable serial, hostname, brand, and model metadata;
- which already-classified type-specific profile fields ship in server-controlled `technicalProfileVersion = 1` after inventory data profiling;
- retention and aggregation settings for the later telemetry subsystem.

These are bounded contract parameters, not reasons to mix home and current location, expose placeholder Asset IDs, put telemetry in `devices`, or weaken tenant isolation.

## Major decision records

| Decision | Alternatives considered | Why chosen | Primary risk | Future migration cost |
| --- | --- | --- | --- | --- |
| Nullable `homeLaboratoryId` with one-time generic initial assignment | Required Lab; unrestricted PATCH; Transfer-only initial assignment | Represents normal custody without pretending to be current location and supports unassigned equipment without blocking first assignment | Clients may mistake the conditional field for unrestricted mutability | Low: future Transfer owns every established-home change |
| Client-supplied, normalized, location-neutral `deviceCode`, not PATCHable in v1 | Server-generated code; unrestricted mutable code; location-encoded code | Preserves reviewed existing labels while stable identity survives transfer | Input collisions and later data-entry correction | Low/medium: audited alias/history correction later |
| Separate opaque QR | Internal ULID, serial, Device code, Asset code | Prevents exposing/encoding internal or mutable identifiers | QR is mistaken for authorization | Low if endpoint policies remain explicit |
| Lifecycle only in Device core | One giant status; persisted availability; persisted latest health | Avoids contradictory dimensions and stale operational truth | UI needs projections from domains not yet built | Medium, but additive and clean |
| JSONB profile with separate server-controlled version and atomic replacement | Version inside JSON; giant table; subtype tables; EAV; deep merge | Keeps one root discriminator, deterministic validation, and manageable evolution | Validation primarily application-enforced; full replacement requires complete client state | Medium: explicit server migrations by version |
| No `assetId` in v1 | Placeholder ID; build Asset first | Preserves referential integrity without blocking Device authority | Temporary inability to show canonical Asset relation | Low: additive FK after Asset exists |
| Flat Device collection with Laboratory filter | Duplicate nested collection | Supports nullable home, combined filters, and one canonical contract | Consumers may expect nested navigation | Low: frontend builds filter links |
| Required `If-Match` over optimistic integer `version` | Last-write-wins; timestamp comparison | Deterministic protection for metadata, initial home assignment, and full-profile replacement | Clients must retain/send version | Low and safer than retrofitting after conflicts |
