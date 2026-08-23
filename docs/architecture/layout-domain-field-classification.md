# Layout Domain Field Classification

Status: Proposed companion to Layout Domain Contract RFC

This document classifies the local AppDB `LaboratoryLayout`, `LayoutElement`, and legacy Device placement fields against the proposed canonical backend Layout domain. Local identifiers are not canonical backend ULIDs.

## Categories

| Category | Meaning |
| --- | --- |
| A | canonical Layout root field |
| B | canonical structural element field |
| C | canonical Device placement field |
| D | derived or presentation/editor-only data |
| E | deprecated legacy field/type; do not copy directly |
| F | deferred or owned by another/future domain |

## LaboratoryLayout fields

| Local field | Current meaning | Category | Canonical decision |
| --- | --- | --- | --- |
| `id` | local Layout identity | A | Canonical Layout uses a server-generated ULID. A local ID is never reused or assumed equal. |
| `laboratoryId` | local owning Laboratory ID | A | Required immutable canonical Laboratory ULID, resolved inside current School. Explicit mapping is required for migration. |
| `name` | operator-facing Layout name | A | Trimmed, non-blank, max 255. |
| `layoutType` | template name and editor capability switch | E/D | Not a canonical closed Layout field. Backend stores nullable `templateKey` provenance and validates geometry independently; UI derives editor/presentation state. |
| `rows` | grid row count | A | Canonical integer 1..50. Laboratory does not own this dimension. |
| `columns` | grid column count | A | Canonical integer 1..50. Laboratory does not own this dimension. |
| `version` | local numeric field, not consistently mutated | A | Positive aggregate optimistic-concurrency version; emits strong ETag and increments once per effective mutation. |
| `status` | `draft`, `active`, or `archived` | A | Sole canonical lifecycle discriminator with constrained transitions. |
| `isActive` | redundant active boolean | E | Removed. It can contradict `status`; active state is `status === active`. |
| `elements` | polymorphic array including empties, PCs, structure | D | Not one stored root column. API exposes separate `structuralElements` and `devicePlacements` child collections. |
| `createdAt` | local timestamp | A | Server timestamp, read-only. |
| `updatedAt` | local timestamp | A | Server timestamp, read-only; unchanged for effective no-op. |

### New canonical Layout root fields

| Field | Category | Decision |
| --- | --- | --- |
| `schoolId` | A | Direct tenant owner in storage/DTO; server-derived and client-immutable. |
| `templateKey` | A/D | Nullable backend-stored frontend-template provenance, max 100. It is not a backend enum or conformance promise. |
| `activatedAt` | A | Nullable lifecycle timestamp; set at activation. |
| `archivedAt` | A | Nullable lifecycle timestamp; set when a replacement activates. |
| `structuralElements` | D | Aggregate relationship/response collection, not a JSON persistence shortcut. |
| `devicePlacements` | D | Aggregate relationship/response collection, not a JSON persistence shortcut. |

## LayoutElement fields

Because the local object mixes structure and equipment, some fields classify differently by canonical child kind.

| Local field | Current meaning | Category | Canonical decision |
| --- | --- | --- | --- |
| `id` | local polymorphic element identity | B/C | Structural element or placement gets a server ULID. Local value is never reused automatically. |
| `layoutId` | parent local Layout ID | B/C | Required storage FK to canonical Layout; inherited in aggregate child payloads and not client-mutable. |
| `type` | structure, Device role, equipment icon, or empty | B/C/E | Split into structural `type` and placement `role`; see taxonomy below. |
| `referenceId` | optional local Device reference | E/C | Replaced by required canonical `deviceId` on DevicePlacement only. Never accepted on structural elements. Local values require explicit identity mapping. |
| `label` | element/device position text | B/C | Structural label under per-type rules, or optional placement-position label. It is never Device identity. |
| `row` | one-based anchor | B/C | Canonical one-based positive integer. |
| `column` | one-based anchor | B/C | Canonical one-based positive integer. |
| `rowSpan` | rectangular vertical footprint | B/C | Canonical positive integer bounded by Layout. |
| `columnSpan` | rectangular horizontal footprint | B/C | Canonical positive integer bounded by Layout. |
| `rotation` | visual right-angle rotation | B/C | Canonical `0`, `90`, `180`, or `270`; does not alter occupancy. |
| `movable` | local editor capability | D/E | Not persisted. Editor capability is derived from status, permission, and tool policy. |
| `swappable` | local PC movement capability | D/E | Not persisted. A swap is an atomic final aggregate geometry update. |
| `fixed` | local template/editor lock | D/E | Not persisted in v1. Template locks are frontend policy, not durable physical state. |

### New canonical child fields

| Field | Child | Category | Decision |
| --- | --- | --- | --- |
| `schoolId` | both, storage | B/C | Direct tenant ancestry for composite FKs and tenant-leading queries; inherited, never selected by client. |
| `deviceId` | DevicePlacement | C | Required canonical Device ULID with restrict-delete FK. |
| `role` | DevicePlacement | C | Nullable `student_station` or `teacher_station`; only for desktop/laptop placement. |
| `createdAt`, `updatedAt` | both | B/C | Server timestamps; child changes are protected by Layout version. |

## Element type classification

| Local type | Current behavior | Category | Canonical decision |
| --- | --- | --- | --- |
| `student_pc` | Device-bound student workstation | E/C | Deprecated type. Canonical DevicePlacement references a `desktop_pc`/`laptop` and uses role `student_station`. |
| `teacher_pc` | Device-bound teacher workstation | E/C | Deprecated type. Canonical DevicePlacement references a `desktop_pc`/`laptop` and uses role `teacher_station`. |
| `teacher_desk` | non-inventory furniture | B | Canonical structural type with optional label, span, and rotation. |
| `projector` | ambiguous equipment element | E/C | If represented as equipment, it must be a canonical Device placement whose Device type is `projector`; no unbound projector structural type. |
| `printer` | locally placeable unbound equipment icon | E/C | Must be a canonical Device placement whose Device type is `printer`. |
| `network_switch` | locally placeable unbound equipment icon | E/C | Must be a canonical Device placement whose Device type is `network_switch`. |
| `access_point` | locally placeable unbound equipment icon | E/C | Must be a canonical Device placement whose Device type is `access_point`. |
| `door` | room opening | B | Canonical structural type. |
| `window` | room opening | B | Canonical structural type. |
| `wall` | room boundary/partition | B | Canonical structural type. |
| `aisle` | reserved walking space | B | Canonical structural type without a label. |
| `label` | display text | B/D | Persisted structural annotation; required text, but not physical inventory. |
| `empty` | explicit vacant grid-cell row | E/D | Not persisted. Absence of a footprint is empty space; complete grid coverage is not required. |

Canonical Device types not present in the local Layout union—`laptop`, `server`, `router`, `ups`, and `other`—are also represented only through DevicePlacement when shown as managed equipment. A decorative hardware icon is not a substitute. V1 adds no `marker` or generic `fixture` type.

## Legacy Device placement fields

| Legacy Device field | Current meaning | Category | Canonical decision |
| --- | --- | --- | --- |
| `positionCode` | Device-carried display/position label | E/C | Removed from Device. A reviewed migration may use it only as a placement-label hint after explicit Device identity mapping. |
| `row` | Device-carried Layout row in older schemas | E/C | Removed from Device. Canonical coordinate belongs to DevicePlacement. |
| `col` | Device-carried Layout column in older schemas | E/C | Removed from Device. Canonical coordinate belongs to DevicePlacement. |
| `laboratoryId` | legacy combined ownership/location | E/F | Never treated as canonical identity. Canonical Device `homeLaboratoryId` owns normal custody; canonical Layout owns placement. Temporary location belongs to Loan/Maintenance projections. |

## Structural capability classification

| Canonical structural type | Label policy | Geometry | Persisted capability flags |
| --- | --- | --- | --- |
| `teacher_desk` | optional, max 60 | rectangular span, four right-angle rotations | none |
| `door` | optional, max 60 | rectangular span, four right-angle rotations | none |
| `window` | optional, max 60 | rectangular span, four right-angle rotations | none |
| `wall` | optional, max 60 | rectangular span, four right-angle rotations | none |
| `aisle` | no label | rectangular span, four right-angle rotations | none |
| `label` | required, 1..60 | rectangular span, four right-angle rotations | none |

Every footprint is exclusive and bounded. Rotation is visual and does not exchange row/column span. Editor tools may offer narrower movement or resize controls without storing UI booleans.

## Device placement classification

| Concern | Category | Decision |
| --- | --- | --- |
| placement identity | C | server ULID, stable while moved inside the same draft |
| tenant/Layout ownership | C | direct School and Layout FKs in storage |
| hardware identity | C | required canonical `deviceId`; never copied Device metadata |
| student/teacher semantics | C | nullable placement role, not Device type |
| position label | C | optional max-60 assignment label, not Device identity |
| geometry | C | one-based rectangular footprint and right-angle rotation |
| concurrency version | D | no child version; Layout ETag protects the aggregate |
| universal current location | F | not stored; future projection combines Loan, Maintenance, Layout, and home Laboratory |
| Asset/procurement fields | F | Asset-owned and forbidden in placement |
| telemetry/availability | F | telemetry/Maintenance projection; not Layout persistence |

## Local-to-canonical migration disposition

| Local data | Default disposition |
| --- | --- |
| Laboratory/Layout/Device IDs | reject as canonical IDs; require explicit reviewed maps |
| explicit `empty` elements | discard; convert to implicit sparse space |
| valid walls/doors/windows/aisles/desks/labels | eligible for explicit mapped conversion after bounds/collision validation |
| `student_pc` / `teacher_pc` with mapped Device | convert to DevicePlacement plus role |
| unbound printer/switch/AP/projector | require operator mapping to a canonical Device or removal; never auto-fabricate Device |
| `layoutType` | optional reviewed conversion to `templateKey`; never backend conformance |
| `movable` / `swappable` / `fixed` | discard as editor policy |
| `positionCode` | optional placement-label hint only after Device mapping |

No automatic match by text, code, hostname, serial number, Asset code, array order, or coordinate is part of this classification.
