# SmartLab Layout Domain Contract

Status: Approved — Architecture Locked

This contract is the canonical Layout v1 architecture baseline. Implementation may refine internal code organization but must not silently change locked domain semantics; any contradiction or material architecture change requires a new reviewed architecture decision or RFC.

## 1. Scope

This RFC defines the canonical backend contract for a Laboratory's normal physical layout. It is design-only. It does not implement Laravel models, migrations, controllers, frontend integration, or OpenAPI changes.

The contract is constrained by the locked Device architecture and the existing canonical Laboratory API. The local AppDB Layout editor is evidence about useful behavior, not a server contract and not an identity source.

Layout v1 includes:

- a versioned Layout aggregate owned by one School and one Laboratory;
- sparse structural geometry;
- home Device placements that reference canonical Device ULIDs;
- draft, activation, and retained archived arrangements;
- server-authoritative unplaced-Device queries;
- exact permissions, tenant isolation, optimistic concurrency, and audit history.

Layout v1 excludes Asset, Loan, Transfer, Maintenance, Incident, Work Order, telemetry, agent heartbeat, QR workflows, collaborative editing, freeform CAD, image floorplans, 3D/AR, network topology, bulk placement, auto-discovery, and historical current-location projection.

## 2. Executive decisions

1. Use separate `layout_structural_elements` and `layout_device_placements` tables under a `layouts` aggregate root. A polymorphic element row would make `device_id` optional for hardware-like rows, weaken foreign-key and uniqueness rules, and continue the prototype's ambiguity between a printer icon and a real printer.
2. A placement is optional. A Laboratory may have no active Layout; a Layout may have no Device placements; a home Device may remain unplaced.
3. `student_pc` and `teacher_pc` are deprecated Layout element types. They are placement roles (`student_station` and `teacher_station`) for canonical `desktop_pc` or `laptop` Devices, not Device types.
4. Any managed printer, switch, access point, projector, router, UPS, server, or other equipment shown as equipment in a Layout is a Device placement referencing a canonical Device. V1 does not provide decorative hardware look-alike element types.
5. Empty space is implicit. The backend does not persist one `empty` row per vacant cell and does not require complete grid coverage.
6. Coordinates are one-based integer grid coordinates. Layout dimensions are 1 through 50 rows and columns. Every persisted footprint is a bounded rectangle with rotation `0`, `90`, `180`, or `270` degrees.
7. Status is the sole lifecycle discriminator: `draft`, `active`, or `archived`. There is no `isActive` boolean. Each Laboratory may have at most one draft and at most one active Layout, and any number of archived Layouts.
8. Active and archived Layouts are immutable through every editor and external-domain mutation path. Editing occurs on the single draft, whose ID remains stable while it is saved. Activation atomically archives the prior active Layout and activates the draft; external workflows must use a successor revision rather than mutate retained content.
9. The aggregate has one integer `version`. A full draft save is transactional, requires strong `If-Match`, and either changes all submitted root fields/elements/placements or changes nothing. Children do not have independent concurrency versions.
10. Effective no-ops preserve `version`, ETag, `updatedAt`, and audit history.
11. Backend geometry is authoritative; `templateKey` is nullable frontend template provenance only. The backend does not implement or validate named template algorithms.
12. The safe unplaced pool is a paginated server projection relative to a specific Layout. The frontend must not subtract a single page of `GET /devices`.

## 3. Existing local prototype audit

The prototype has valuable, well-tested behavior:

- immutable move, swap, resize, and property operations;
- rectangular footprints with collision and bounds validation;
- direct student workstation swapping;
- deterministic template generation;
- safe shrink rejection when occupied geometry would be clipped;
- baseline/draft/save/cancel behavior and no-op detection;
- local atomic persistence and audit summaries.

The following prototype assumptions are not canonical:

- every Laboratory must have exactly one active Layout;
- every home Device must appear exactly once in that Layout;
- every vacant cell must be an `empty` element;
- `status` and `isActive` are both persisted;
- `layoutRows` and `layoutCols` belong to Laboratory;
- `layoutType` controls backend mutation capability;
- `movable`, `swappable`, and `fixed` are durable domain facts;
- `student_pc` and `teacher_pc` are element types rather than placement roles;
- printer, switch, and access-point palette entries may exist without Device identity;
- local Laboratory, Device, Layout, or `referenceId` values can identify server records.

The local tests deliberately enforce many of these prototype rules. Those tests must continue protecting AppDB until a separately approved frontend migration replaces that boundary; they are not acceptance tests for this server contract.

## 4. Locked inputs and terminology

### 4.1 Device and Laboratory inputs

Device owns stable hardware identity, School ownership, `deviceCode`, opaque QR identity, hardware type, lifecycle, nullable `homeLaboratoryId`, metadata, technical profile, and Device version. It does not own Layout geometry, a position code, a Layout ID, or universal current location.

Laboratory owns room identity, School ownership, descriptive metadata, capacity, and active/inactive operational status. Rows and columns belong to Layout.

### 4.2 Terms

- **Layout**: a named physical arrangement for one Laboratory.
- **Structural element**: non-inventory room geometry or annotation, such as a wall or label.
- **Device placement**: an assignment of one canonical Device to a normal/home footprint in one Layout.
- **Home placement** or **normal placement**: the Device's expected position in its home Laboratory. It is not guaranteed current location.
- **Unplaced Device**: an eligible Device whose `homeLaboratoryId` is the Layout's Laboratory and which has no placement in the queried Layout.
- **Active Layout**: the selected normal arrangement for a Laboratory. A Laboratory being inactive is a separate operational condition.

## 5. Aggregate boundary

`Layout` is the aggregate root. Structural elements and Device placements cannot be mutated independently of the root transaction or root version. The aggregate boundary is:

```text
Layout
├── StructuralLayoutElement[]
└── DevicePlacement[] -> canonical Device ULID
```

This is preferred over one polymorphic `LayoutElement` table because:

- placements can have a required Device FK while structural rows cannot;
- one-Device-per-Layout uniqueness is direct;
- Device lifecycle and home-Laboratory eligibility can be validated explicitly;
- equipment cannot silently degrade into an unbound icon;
- placement audit diffs are distinguishable from structure diffs;
- archived placements may retain Device references without copying Device metadata;
- Loan, Maintenance, and Transfer can coordinate placement without treating a wall or label as equipment.

| Candidate | Integrity and lifecycle result | Decision |
| --- | --- | --- |
| one polymorphic element table | Device FK must be nullable, hardware-like rows can exist unbound, placement uniqueness is conditional, and structure/placement audit semantics remain mixed | rejected |
| structural element plus DevicePlacement | required Device FK and direct uniqueness, clean aggregate diffs, retained historical references, and straightforward transfer/temporary-custody boundaries | selected |
| independent persistent slot plus placement | preserves named vacant stations, but adds another identity/lifecycle and is not required by demonstrated v1 workflows | deferred until a persistent vacant-slot requirement exists |

V1 does not add a persistent vacant-workstation or slot entity. A placement label identifies the assigned normal position while that placement exists. If product requirements later demand named vacant stations that survive unplacement, that is a separate reviewed `LayoutSlot` extension, not a nullable fake Device placement.

## 6. Layout identity and DTO

The canonical Layout detail DTO is:

```text
id                  ULID, server-generated
schoolId            ULID, read-only; derived from active membership
laboratoryId        ULID, immutable
name                non-blank string, max 255
templateKey         nullable string, max 100; provenance only
rows                integer 1..50
columns             integer 1..50
status              draft | active | archived
version             positive integer
structuralElements  StructuralLayoutElement[]
devicePlacements    DevicePlacement[]
activatedAt         nullable timestamp
archivedAt          nullable timestamp
createdAt           timestamp
updatedAt           timestamp
```

`school_id` is stored directly on Layout even though Laboratory is School-owned. This supports tenant-leading indexes, explicit query scoping, composite tenant FKs, and safer background jobs. The client never supplies or changes it.

The Layout ID is stable through draft saves, activation, and archival. Saving a draft mutates that versioned row; it does not create a revision per keystroke. Creating a new draft creates a new Layout ID. Activating it preserves both the new active ID and the old archived ID.

`templateKey` records the most recently applied frontend template, if any. It does not assert that current geometry still matches a template and must never enable hidden backend restrictions. `grid-classic`, `perimeter-center-island`, `u-shape`, `facing-rows`, and `custom` remain presentation/editor concepts rather than a closed backend `layoutType` enum.

After geometry generated from `perimeter-center-island` is modified, `templateKey` may remain `perimeter-center-island` as provenance; the UI may label it “modified” or treat the editor as custom. The backend does not silently rewrite the key or pretend the geometry still conforms.

## 7. Lifecycle and revisions

Allowed transitions are:

```text
create -> draft
draft --activate--> active
active --replacement activation--> archived
draft --delete--> removed
```

Rules:

- at most one draft and one active Layout exist for a Laboratory;
- many archived Layouts may exist;
- active and archived content is immutable through ordinary update/delete endpoints and every external-domain workflow;
- a draft may be deleted with `layouts.delete` and a matching ETag;
- active and archived Layouts cannot be hard-deleted through v1;
- there is no standalone archive endpoint in v1; activation archives the previous active;
- activation locks the Laboratory, draft, current active Layout, and referenced Devices and completes in one transaction;
- activation revalidates every aggregate invariant against current Device and Laboratory state;
- the activated draft and archived predecessor each increment their own version once because their statuses change;
- a Laboratory may validly have neither a draft nor an active Layout.

Creating a draft clones the current active aggregate on the server when one exists, assigning new child ULIDs while preserving canonical Device references and geometry. With no active Layout, the request supplies initial name and dimensions and the server creates an empty sparse draft. The single-draft rule avoids ambiguous editor recovery without building a general CAD branch system.

### Inactive Laboratory

Existing active/archived/draft Layouts remain readable when the Laboratory is inactive. Inactivation does not destroy or silently archive the selected normal arrangement. Creating a draft, saving a draft, or activating a draft is rejected while inactive. Deleting an existing draft remains allowed with `layouts.delete` because it is cleanup and cannot change the operational arrangement.

## 8. Geometry model

Coordinates are one-based. Row 1/column 1 is the upper-left cell. One-based coordinates preserve the existing operator/editor mental model and use clear inclusive database checks without introducing a conversion boundary solely for API convention.

Global v1 rules:

- `rows` and `columns` are integers from 1 through 50;
- `row`, `column`, `rowSpan`, and `columnSpan` are positive integers;
- a top-left anchor plus its span must be fully inside Layout bounds;
- rotation is one of `0`, `90`, `180`, or `270` and does not change occupancy;
- all structural and placement footprints are rectangular;
- no two structural elements or Device placements may occupy the same cell;
- empty cells are the absence of a structural element or placement;
- complete grid coverage is not required;
- resize that would place any footprint out of bounds fails; it never clips, deletes, or moves content implicitly;
- there is no intentional overlap, Z-order, pixel coordinate, freeform polygon, or floorplan-image coordinate in v1.

The 50 by 50 limit is the prototype's centrally tested safe bound and gives v1 a deterministic validation and payload ceiling. Sparse persistence means a 2,500-cell room does not create 2,500 empty rows.

## 9. Structural elements

The v1 structural taxonomy is deliberately closed:

| Type | Meaning | Label | Span | Rotation |
| --- | --- | --- | --- | --- |
| `teacher_desk` | non-inventory furniture footprint | optional, max 60 | yes | four right angles |
| `door` | room opening | optional, max 60 | yes | four right angles |
| `window` | room opening | optional, max 60 | yes | four right angles |
| `wall` | wall footprint | optional, max 60 | yes | four right angles |
| `aisle` | reserved walking/clearance area | none | yes | four right angles |
| `label` | display annotation | required, 1..60 | yes | four right angles |

The public structural element DTO is:

```text
id          ULID
type        closed taxonomy above
label       nullable/required according to type
row         positive integer
column      positive integer
rowSpan     positive integer
columnSpan  positive integer
rotation    0 | 90 | 180 | 270
```

`schoolId` and `layoutId` exist in storage but are inherited from the aggregate and are not client-mutable child payload fields.

`movable`, `swappable`, and `fixed` are not persisted. They describe current editor capability or template policy, not immutable physical truth. All draft geometry changes use the same server validation; frontend tools may expose narrower capabilities. If a future product requirement needs a real protected/locked element state, it requires a named semantic field and authorization contract rather than three contradictory booleans.

No `marker` or generic `fixture` is added in v1. A label supplies non-inventory annotation. A hardware-shaped decorative marker is intentionally unsupported because it could be mistaken for managed equipment.

## 10. Device placements

The public placement DTO is:

```text
id          ULID
deviceId    canonical Device ULID
role        null | student_station | teacher_station
label       nullable trimmed string, max 60
row         positive integer
column      positive integer
rowSpan     positive integer
columnSpan  positive integer
rotation    0 | 90 | 180 | 270
```

Storage additionally holds `school_id`, `layout_id`, and timestamps. The placement has no independent version: the Layout version protects the complete edit. It stores no Device code, QR ID, hardware profile, Asset data, telemetry, lifecycle snapshot, or current-location claim.

`student_station` and `teacher_station` are valid only for `desktop_pc` or `laptop` Devices. They describe use of a placed computer and never rewrite `Device.deviceType`. Other Device types use a null role. Rectangular spans allow the Layout to represent a physical footprint without encoding per-hardware geometry rules.

Moving a placement changes its geometry but preserves placement and Device identity. Unplacing removes it from the current draft; archived Layout rows and audit events preserve historical evidence. Swapping two placements is simply one atomic aggregate save containing both final geometries.

## 11. Optional placement and eligibility

The canonical invariant is **at most one active home placement per Device**, never exactly one.

Consequences:

- an active Laboratory may have zero Layouts;
- a Layout may have zero Device placements;
- a Device with `homeLaboratoryId = LAB-A` may remain unplaced;
- a Device with `homeLaboratoryId = null` cannot be placed;
- a Device whose home is LAB-A cannot be placed in LAB-B's Layout;
- a Device may occur at most once in one Layout;
- the same Device may occur in a draft clone, one active Layout, and archived Layouts; only the active reference is an active home placement;
- archived references are immutable history and do not reserve the Device.

For a new or activated placement, the Device must:

- exist in the current School without revealing cross-tenant existence;
- have `homeLaboratoryId` exactly equal to the Layout's Laboratory;
- have lifecycle `in_service` or `spare`;
- not already occur elsewhere in the submitted Layout;
- satisfy the one-active-placement rule at activation.

The one-active-placement rule follows from three enforced invariants: one active Layout per Laboratory, same-home-Laboratory placement, and unique `(layout_id, device_id)`. Because a Device has only one home Laboratory, it cannot validly enter active Layouts for two Laboratories.

### Lifecycle interaction

- `in_service -> spare`: an existing placement remains; spare equipment may also be intentionally placed in a storage/normal position.
- `spare -> in_service`: an existing placement remains.
- placing a `retired` or `decommissioned` Device is forbidden.
- a normal Device transition to `retired` or `decommissioned` is blocked while the Device has an active home placement or a reference in the current draft. An active placement requires activation of a successor Layout that omits the Device; a draft-only reference must be removed from or deleted with that draft before transition.
- a future coordinated lifecycle workflow may combine successor-draft preparation, activation/archive, and the terminal transition atomically, but it cannot update or delete child rows of an existing active or archived Layout.
- archived references remain regardless of later Device lifecycle.

## 12. Unplaced Device pool

The editor uses:

```http
GET /api/v1/layouts/{layoutId}/unplaced-devices?page=1&perPage=25&search=...
```

This is a Layout application projection, evaluated relative to the requested draft or active Layout. It selects current-School Devices whose home Laboratory equals the Layout Laboratory, whose lifecycle is `in_service` or `spare`, and for which no placement exists in that Layout. It returns a deterministic page ordered by `deviceCode`, then `id`, with the standard `page`, `perPage`, `total`, and `lastPage` metadata.

Each item is a minimal placement candidate: `id`, `deviceCode`, `deviceType`, `lifecycleStatus`, `hostname`, `brand`, and `model`. It does not duplicate a full Device technical profile or QR identity. It requires both exact `layouts.view` and `devices.view`, because it exposes Device inventory data.

The projection is advisory. A later save/activation revalidates Device state transactionally. This avoids pagination bugs, race-prone client subtraction, and an unbounded `unplacedDeviceIds` array in every Layout response.

## 13. Boundaries with other domains

Active and archived Layout aggregates are immutable evidence. Transfer, terminal lifecycle, Loan, Maintenance, or any other external domain must never directly update or delete their structural elements or Device placements. Changes to the selected normal arrangement occur only by preparing a draft and activating it as the successor.

### Transfer

Permanent Transfer is not implemented here. From the Layout perspective, a normal future Transfer may proceed only when the Device has no active home placement and no reference in the current draft of the source Laboratory. Archived references are historical evidence and do not block Transfer.

If the active Layout contains the Device, the operator must create or edit the successor draft, remove the Device from that draft, and activate it. Activation archives the unchanged predecessor and makes the successor without that Device active. Only then may Transfer change `homeLaboratoryId` from LAB-A to LAB-B; the Device begins unplaced in LAB-B.

A current source-Laboratory draft blocks Transfer only when that draft references the Device being transferred. An unrelated draft that does not reference the Device is not a Layout-level blocker when no active placement exists. A future Transfer orchestration may atomically coordinate a successor Layout revision, its activation/archive, the home-Laboratory change, and audit, but it must preserve existing active/archived rows unchanged; this RFC does not design that convenience workflow further.

The locked generic Device PATCH is not a Transfer operation. Once Layout exists, generic Device metadata updates must not change established home-Laboratory custody, repair placement inconsistencies, or mutate Layout rows. Device identity and QR remain unchanged through a future Transfer.

### Loan

Loan is temporary custody. It does not change `homeLaboratoryId`, delete the home placement, or create a destination home placement. A current-location projection must prefer active Loan custody over the home Layout.

### Maintenance

Maintenance/repair custody does not normally change Layout geometry. UI may decorate a placed Device as temporarily unavailable by joining a future Maintenance projection; Layout does not persist Maintenance status. Current-location projection prefers active repair custody over home placement.

### Asset

Layout references Device identity only. It stores no `assetId`, `assetCode`, price, funding source, condition, warranty, or other procurement data. Layout implementation does not depend on an Asset backend.

### Current physical location

A Device placement is normal/home assignment, not guaranteed current location. The future projection precedence remains: active Loan, active Maintenance/repair custody, active home placement, home Laboratory without placement, then unknown/unassigned.

## 14. Concurrency, atomicity, and no-ops

Layout detail GET emits a strong ETag equal to the quoted positive integer version, for example `"7"`. Draft PUT, activation, and draft deletion require `If-Match`.

- the only accepted request format is exactly one strong quoted positive integer version: `If-Match: "<version>"`;
- missing `If-Match` returns HTTP 428 `PRECONDITION_REQUIRED`;
- invalid preconditions also return HTTP 428 `PRECONDITION_REQUIRED`, including an unquoted value, weak ETag, non-numeric value, wildcard, multiple ETags, zero/negative version, or any other malformed form;
- only after parsing a syntactically valid strong version, a value unequal to the current Layout version returns HTTP 412 `LAYOUT_VERSION_CONFLICT` without disclosing cross-tenant state;
- every effective root, structure, placement, or status mutation increments the affected Layout version exactly once and updates `updatedAt` once;
- canonical equality ignores array order, JSON object key order, request-only child temp order, and semantically empty optional values after normalization;
- an effective no-op returns current canonical data and ETag without changing version, timestamps, or audit history.

PUT is a full draft aggregate replacement. Its exact mutable allowlist is:

```text
name
templateKey
rows
columns
structuralElements[]: id? type label? row column rowSpan columnSpan rotation
devicePlacements[]: id? deviceId role? label? row column rowSpan columnSpan rotation
```

Existing child IDs must belong to that draft; new children omit `id` and receive server ULIDs. Unknown, foreign, active/archived child IDs are rejected. `schoolId`, `laboratoryId`, `status`, `version`, timestamps, Device metadata, and arbitrary fields are not mutable.

The service locks and validates the aggregate, Laboratory, and referenced Devices, computes the canonical final state, then writes root/children/events in one database transaction. If any move, addition, resize, removal, collision, permission, tenant, lifecycle, or version check fails, the complete save rolls back. There are no command endpoints that can leave half of an editor save persisted.

## 15. Minimal v1 API proposal

There is one nested Layout collection under Laboratory and root member operations; no duplicate root collection is needed.

| Method and path | Purpose | Permission |
| --- | --- | --- |
| `GET /api/v1/laboratories/{laboratoryId}/layouts?status=...` | paginated Layout summaries; `status=active` gets the active summary | `layouts.view` |
| `POST /api/v1/laboratories/{laboratoryId}/layouts` | create the sole draft, cloning active if present | `layouts.create` |
| `GET /api/v1/layouts/{layoutId}` | get one full aggregate and ETag | `layouts.view` |
| `PUT /api/v1/layouts/{layoutId}` | atomically replace a draft aggregate | `layouts.update` + `If-Match` |
| `POST /api/v1/layouts/{layoutId}/activate` | activate draft and archive prior active | `layouts.update` + `If-Match` |
| `DELETE /api/v1/layouts/{layoutId}` | delete a draft only | `layouts.delete` + `If-Match` |
| `GET /api/v1/layouts/{layoutId}/unplaced-devices` | paginated canonical placement candidates | `layouts.view` and `devices.view` |

POST creates a draft. If an active Layout exists, the server clones it and an optional `name` may override the cloned name. If none exists, `name`, `rows`, and `columns` are required; `templateKey` is optional. There is no archive, clone, template, bulk-placement, or individual move endpoint in v1. The draft creation behavior is the only required clone operation and is part of lifecycle, not a general copy API.

Responses use the established `{ "data": ... }` envelope and paginated collection metadata. Client-supplied `schoolId` is forbidden. OpenAPI remains unchanged until implementation is approved.

## 16. Error semantics

Existing platform errors remain authoritative: `UNAUTHENTICATED`, `FORBIDDEN`, `ACTIVE_MEMBERSHIP_REQUIRED`, `SCHOOL_CONTEXT_REQUIRED`, and `VALIDATION_FAILED`.

Likely Layout v1 codes are intentionally limited:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 404 | `LAYOUT_NOT_FOUND` | Layout unknown or outside current School |
| 409 | `LAYOUT_DRAFT_ALREADY_EXISTS` | Laboratory already has its one draft |
| 409 | `LAYOUT_STATUS_CONFLICT` | operation invalid for draft/active/archived state |
| 409 | `LAYOUT_LABORATORY_INACTIVE` | create/save/activate attempted for inactive Laboratory |
| 409 | `LAYOUT_DEVICE_ALREADY_PLACED` | duplicate Device in final Layout or conflicting active placement |
| 409 | `LAYOUT_DEVICE_HOME_MISMATCH` | Device has no home Laboratory or a different home Laboratory |
| 409 | `LAYOUT_DEVICE_NOT_ELIGIBLE` | Device lifecycle forbids placement |
| 409 | `LAYOUT_POSITION_OCCUPIED` | final footprints collide |
| 412 | `LAYOUT_VERSION_CONFLICT` | syntactically valid strong Layout version is stale |
| 428 | `PRECONDITION_REQUIRED` | required `If-Match` is absent or invalid |

Malformed fields, unknown fields, invalid dimensions, unsupported type/role, invalid span/rotation, out-of-bounds geometry, and excessive text use HTTP 422 `VALIDATION_FAILED` with field errors rather than a proliferation of geometry codes. Cross-tenant Laboratory and Device identifiers follow not-found semantics without revealing existence; a supplied cross-tenant Device may surface only as a generic placement reference validation failure.

## 17. PostgreSQL storage proposal

PostgreSQL is canonical. SQLite automated tests must exercise equivalent checks and partial unique indexes where supported. Native database enums are not used.

### 17.1 `layouts`

| Column | Contract |
| --- | --- |
| `id` | ULID primary key |
| `school_id` | ULID, FK schools, not null |
| `laboratory_id` | ULID, not null |
| `name` | varchar(255), not blank |
| `template_key` | varchar(100), nullable |
| `rows`, `columns` | unsigned/safe integer, not null |
| `status` | varchar(16), not null |
| `version` | positive bigint, default 1 |
| `activated_at`, `archived_at` | nullable timestamps |
| `created_at`, `updated_at` | timestamps |

Constraints and indexes:

- composite FK `(school_id, laboratory_id) -> laboratories(school_id, id)` with restrict delete;
- checks for status, dimensions 1..50, version > 0, non-blank name;
- temporal check: draft has neither lifecycle timestamp; active has `activated_at` only; archived has both;
- partial unique index `(school_id, laboratory_id) WHERE status = 'active'`;
- partial unique index `(school_id, laboratory_id) WHERE status = 'draft'`;
- index `(school_id, laboratory_id, status, updated_at)` and `(school_id, status, updated_at)`.

### 17.2 `layout_structural_elements`

| Column | Contract |
| --- | --- |
| `id` | ULID primary key |
| `school_id`, `layout_id` | ULID, not null |
| `element_type` | varchar(32), not null |
| `label` | varchar(60), nullable |
| `row`, `column`, `row_span`, `column_span` | positive integer, not null |
| `rotation` | small integer, not null, default 0 |
| `created_at`, `updated_at` | timestamps |

Constraints and indexes:

- composite FK `(school_id, layout_id) -> layouts(school_id, id)` with cascade on Layout deletion;
- checks for the closed type set, positive geometry, allowed rotations, and label policy;
- index `(school_id, layout_id)` and anchor index `(layout_id, row, column)`.

### 17.3 `layout_device_placements`

| Column | Contract |
| --- | --- |
| `id` | ULID primary key |
| `school_id`, `layout_id`, `device_id` | ULID, not null |
| `role` | varchar(32), nullable |
| `label` | varchar(60), nullable |
| `row`, `column`, `row_span`, `column_span` | positive integer, not null |
| `rotation` | small integer, not null, default 0 |
| `created_at`, `updated_at` | timestamps |

Constraints and indexes:

- composite FKs to `(school_id, layout_id)` and `(school_id, device_id)`; Device delete is restricted;
- unique `(layout_id, device_id)`;
- checks for nullable role enum, positive geometry, and allowed rotations;
- indexes `(school_id, layout_id)`, `(school_id, device_id)`, and `(layout_id, row, column)`.

### 17.4 `layout_change_events`

| Column | Contract |
| --- | --- |
| `id` | ULID primary key |
| `school_id` | ULID, not null |
| `layout_id` | nullable live FK for draft deletion |
| `layout_id_snapshot`, `laboratory_id_snapshot` | ULID, not null |
| `actor_user_id` | nullable live actor FK |
| `actor_id_snapshot`, `actor_name_snapshot` | nullable/bounded snapshots |
| `event_type` | varchar(64), not null |
| `changed_fields` | JSON array, not null |
| `changes` | bounded JSON object, not null |
| `created_at` | timestamp; no update timestamp |

Indexes lead with School: `(school_id, layout_id_snapshot, created_at)`, `(school_id, laboratory_id_snapshot, created_at)`, and `(school_id, event_type, created_at)`. Layout/actor deletion nulls live FKs but never erases snapshot IDs. JSON must contain only bounded Layout/placement diffs, not QR IDs, Device profiles, telemetry, or Asset data.

### 17.5 Integrity limits

The migration may add unique `(school_id, id)` keys to canonical Laboratories and Devices solely to support composite tenant FKs. Global ULID primary keys remain canonical.

Database constraints directly enforce one active/draft per Laboratory, child tenant ancestry, required Device identity, and one Device per Layout. Rectangular collision, footprint bounds against parent dimensions, Device home-Laboratory equality, role/hardware compatibility, lifecycle eligibility, and activation validity cross rows/tables and are enforced by the locked application transaction. The contract does not pretend a simple check constraint can enforce those joins.

Partial unique indexes are supported by PostgreSQL and modern SQLite and must be included in migration tests. At most one active home placement follows from the combined constraints described in section 11 rather than a denormalized `is_active` placement flag that could drift from Layout status.

## 18. Audit and history

Archived Layout aggregates are the durable full arrangement snapshots. Change events explain mutations without copying unrelated Device state.

Successful effective mutations write events in the same transaction:

- `layout.created`;
- `layout.structure_updated` for root/structural geometry changes;
- `device.placed`, `device.moved`, and `device.unplaced` for placement diffs;
- `layout.activated`;
- `layout.archived` for the predecessor;
- `layout.draft_deleted`.

One save may write one aggregate structure event and zero or more placement events. Events record IDs, bounded old/new geometry, role/label changes, actor snapshots, and timestamps. No-op and rejected requests write no events. No public audit endpoint is required by v1.

## 19. Permissions and tenant isolation

Permission checks are exact and server-authoritative:

- list/detail: `layouts.view`;
- create draft: `layouts.create`;
- save/activate: `layouts.update`;
- delete draft: `layouts.delete`;
- unplaced pool: both `layouts.view` and `devices.view`.

Placement changes do not mutate Device metadata and therefore do not require `devices.update`. `layouts.manage`, although present in the current permission seed and granted through the explicit all-permissions Super Admin assignment, is not a wildcard and has no v1 endpoint semantics.

Current role seed evidence is: Admin Lab has view/create/update/delete; Kepala Lab and Pimpinan have view; Teknisi has view/update; Guru, Siswa, and Ketua Kelas have none. This RFC does not silently change those grants.

Every query starts with current membership `school_id`. Route-bound Laboratory/Layout and all submitted Device/child IDs are resolved inside that scope. Unknown and cross-tenant identifiers use indistinguishable not-found/validation behavior. The request cannot choose School ownership.

## 20. Legacy AppDB migration boundary

Canonical backend Layout starts empty/new. The local AppDB Layout remains isolated until a separately reviewed migration tool exists.

A future migration must require explicit mappings for local Laboratory and Device IDs to canonical server ULIDs, validate every mapping and collision, preview the sparse converted aggregate, and fail closed on missing or ambiguous identities. It must not silently match by local ID, array order, `deviceCode`, hostname, serial number, Asset code, `positionCode`, or textual Laboratory name/code.

Legacy `referenceId` values are local Device IDs. They must never be sent as canonical `deviceId`. Legacy `positionCode` may be presented as a migration hint for a placement label only after identity mapping is explicitly approved. Explicit `empty` rows are discarded; their absence becomes sparse empty space. Legacy device-like unbound elements require operator resolution to a canonical Device or removal/conversion to a true structural annotation.

## 21. Test strategy for later implementation

Backend implementation must add PostgreSQL-first and portable SQLite coverage for:

- tenant-scoped list/detail and non-leaking cross-tenant IDs;
- exact permission matrix for every endpoint;
- partial uniqueness for one draft and one active Layout;
- empty/no-Layout/no-placement valid states;
- same-home, nullable-home, lifecycle, role/hardware, and duplicate Device rules;
- draft clone identity and archived reference retention;
- every geometry bound, span, rotation, collision, sparse empty, and safe resize rule;
- exact single strong quoted positive-integer ETag parsing; absent/invalid 428; valid-but-stale 412; effective no-op; and one-increment semantics;
- full transaction rollback on any invalid child;
- atomic activation/archive under concurrency;
- correct paginated unplaced query with more Devices than one page;
- immutable active/archived and draft-only deletion;
- Transfer and terminal-lifecycle preconditions for active placement, Device-specific draft reference, unrelated draft, archived-only reference, and successor-revision orchestration without direct active/archive mutation;
- inactive Laboratory mutation policy;
- bounded audit events with no sensitive/unrelated Device fields;
- PostgreSQL migration/seed proof and SQLite test migration compatibility.

Frontend integration later needs strict DTO parsing, server permission guards, deep links, loading/empty/error/retry states, stale-save conflict recovery, and explicit isolation from AppDB IDs. Existing local Layout tests stay intact until that migration is separately approved.

## 22. Adversarial review

| # | Scenario | Contract result |
| --- | --- | --- |
| 1 | LAB-A has 40 Devices; 36 placed | valid; four eligible Devices appear in paginated unplaced pool |
| 2 | Device has null home Laboratory | placement fails `LAYOUT_DEVICE_HOME_MISMATCH` |
| 3 | LAB-A Device submitted to LAB-B Layout | fails without cross-tenant/extraneous disclosure |
| 4 | Device submitted twice/into second active placement | unique/final-state and activation validation reject it |
| 5 | Device appears in archived and active Layout | valid; archived row is immutable history |
| 6 | placed Device becomes spare | placement remains; spare is placeable |
| 7 | placed Device becomes retired/decommissioned | blocked until a successor Layout omitting it is activated; existing active/archive rows remain unchanged |
| 8 | Device loaned to Aula | home placement is unchanged; Loan wins current-location projection |
| 9 | Device enters external repair | home placement is unchanged; Maintenance wins projection |
| 10 | Transfer while active placement exists | blocked until a successor Layout omitting the Device is activated; Transfer never edits the active Layout directly |
| 11 | two editors save same version | first wins; second receives 412 and cannot overwrite |
| 12 | no-op save | version, ETag, timestamp, and events remain unchanged |
| 13 | shrink clips content | entire save fails validation; nothing is dropped |
| 14 | canonical printer plus decorative printer | hardware look-alike structural type is unavailable; real printer requires Device placement |
| 15 | LAB-A becomes inactive | reads continue; create/save/activate blocked; draft cleanup allowed |
| 16 | cross-tenant Device ULID | scoped lookup fails without existence leak |
| 17 | delete active Layout | forbidden; only draft deletion exists |
| 18 | 1,000 Devices with paginated Device API | dedicated server query and independent pagination remain correct |
| 19 | save fails after some proposed operations | database transaction rolls back root, children, and events |
| 20 | legacy local Device IDs | no automatic binding; explicit mapped migration is required |
| 21 | source draft still references transferring Device | Transfer is blocked because the draft would become invalid after the home-Laboratory change |
| 22 | no active placement; unrelated source draft omits Device | Layout does not block Transfer merely because the unrelated draft exists |
| 23 | only archived Layouts reference transferring Device | Transfer is allowed from the Layout perspective; archives remain unchanged |
| 24 | terminal transition while current draft references Device | transition is blocked pending a successor/current draft that omits the Device and activation where required |
| 25 | future atomic Transfer/lifecycle convenience workflow | may coordinate successor revision and activation/archive, but cannot mutate existing active/archived content |

The proposed architecture passes all twenty-five scenarios without weakening locked Device boundaries.

## 23. Resolved decisions and remaining questions

Resolved for v1:

- separate structural elements and Device placements;
- optional placement and sparse empty space;
- one draft/one active/many archives;
- immutable active/archived arrangements and atomic activation;
- one-based 50 by 50 grid;
- frontend-owned template generation;
- Layout-level strong optimistic concurrency;
- dedicated paginated unplaced projection;
- exact permissions and retained audit history.

No human/product decision blocks backend implementation after architecture approval. One non-blocking future question remains: if operators need named vacant workstation slots that survive Device unplacement, review a dedicated `LayoutSlot` entity. V1 recommends not adding it until that workflow is demonstrated; a Device placement label is sufficient for the current scope.

## 24. OpenAPI sequencing and implementation gate

`packages/contracts/openapi.yaml` is intentionally unchanged. After this RFC and its field classification are independently reviewed and locked, backend implementation should update OpenAPI together with the first Layout vertical slice, then implement persistence/application services/controllers/tests, and only afterward migrate the frontend. Asset, Transfer, Loan, Maintenance, telemetry, or other deferred domains must not be bundled into that slice.
