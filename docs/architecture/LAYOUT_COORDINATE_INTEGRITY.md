# Layout Coordinate Integrity (PR 3A)

## Purpose and current boundary

The current prototype stores laboratory dimensions in `Laboratory.layoutRows` and `Laboratory.layoutCols`, and the live layout page directly updates `Device.row` and `Device.col`. That behavior remains unchanged in PR 3A.

In PR 3A, the new layout model is not yet the persisted source of truth.
The current layout page continues to use Device.row/col.
PR 3B will integrate persistence and UI operations after this engine is
reviewed.

The new `laboratory-layout` domain module is pure TypeScript. It does not access localStorage, SeedData, AppDB, repositories, routes, or UI state.

## Complete-grid representation

`LaboratoryLayout` and `LayoutElement` are persistent-domain interfaces, but are not yet persisted. Coordinates are 1-based: row 1/column 1 is the first grid cell. A valid layout represents every cell exactly once; vacant cells are explicit `empty` elements. Intentional spanning elements occupy each cell in their footprint and cannot overlap another element.

`empty` elements are placeholders rather than fixed physical objects: `movable: false`, `swappable: false`, and `fixed: false`.

## Operations

- A `student_pc` moves into an `empty` cell by exchanging the two element coordinates.
- A `student_pc` dropped on another `student_pc` performs one atomic swap. Element IDs and device `referenceId` values remain unchanged.
- A `teacher_pc` can move into an empty cell but never auto-swaps with a student PC.
- Other movable non-PC elements can move only into empty cells; occupied targets are rejected.
- Fixed elements, empty sources, non-movable sources, invalid targets, and unsupported spans return typed failures.
- Spans are fully validated, but movement of a source or target with a span larger than 1x1 is intentionally rejected in PR 3A.

Successful `moved` and `swapped` operations receive `LayoutOperationOptions.updatedAt`; the supplied timestamp becomes `layout.updatedAt`. This keeps domain operations deterministic and avoids `new Date()` in the engine. A `noop` applies only to an otherwise eligible movable one-cell source, returns an immutable clone without changing `updatedAt`, and does not consume the supplied timestamp.

## Validator and migration diagnostics

Validation returns structured issues rather than throwing for ordinary invalid data. It checks complete coverage, bounds, spans, rotations, element and reference IDs, PC-reference requirements, empty-reference prohibition, fixed/movable consistency, and layout status/activity consistency.

`migrateLegacyDeviceCoordinates` is an explicit, pure helper for later use. It filters to the target laboratory, validates duplicate/invalid device IDs and coordinates, emits deterministic row-major elements and IDs, preserves device labels/references, and returns diagnostics instead of partially migrating invalid data. It never mutates source devices or persists a layout.

## Dependency summary and PR 3B

`inspectLaboratoryDependencies` returns a complete zero-inclusive count record for every current laboratory-bound collection and a `canHardDelete` decision. It is not integrated with the existing deletion UI in PR 3A.

Stage 3B introduces persistence, migration execution, UI/editor integration, authorization checks, audit, and atomic save behavior on top of the reviewed pure engine.

## Stage 3B persistence integration

Stage 3B introduces schema version 2 inside the single AppDB/localStorage blob. `SeedData` now contains `schemaVersion: 2` and `layouts: LaboratoryLayout[]`. Fresh and reset data create one deterministic, active `grid-classic` layout per laboratory. Every cell is represented, device elements reference stable device IDs, and all remaining cells are explicit `empty` elements.

After Stage 3B, LaboratoryLayout is the persisted source of truth for laboratory coordinates. Device records no longer store row or col.

Old backups without `schemaVersion` are treated as version 1. Normalization migrates every laboratory through `migrateLegacyDeviceCoordinates` using an injected timestamp, strips legacy device coordinates, and validates the complete result before writing it. The migration is all-or-nothing: malformed dimensions, missing or duplicate coordinates, invalid generated layouts, or broken layout/device references preserve the original raw localStorage value. A validated seed is used only in memory for that session, so the original backup remains recoverable. Valid version-2 data is idempotent: it keeps element ordering and timestamps unchanged and is not rewritten unless normalization made a real change.

Persisted integrity verifies individual layout validity, an existing laboratory owner, matching grid dimensions, exactly one active layout per laboratory, and one same-laboratory PC reference per device in each active layout. It rejects stale Device `row`/`col` properties, orphan layouts, missing device references, and duplicated or missing active-layout device references.

The layout editor holds a separate persisted baseline and editable draft. Drag/drop runs the pure move/swap engine against the draft only. Save replaces the active layout atomically with one audit log; a business-equivalent no-op does not update timestamps, add an audit log, or write storage. Cancel restores the baseline without persistence. Dirty comparison canonicalizes element positions and flags, ignores `updatedAt`, protects browser unload, and uses the React Router data-router blocker for internal navigation.

Laboratory creation atomically creates its devices and active complete layout. Existing laboratory forms keep PC count and dimensions read-only in Stage 3B. Deletion consults the complete dependency inspector at confirmation time; when dependencies exist it leaves the laboratory, devices, and layout untouched. Import/export always uses normalized version-2 data, and failed imports never replace the active database.

Stage 4 remains responsible for grid resizing, multiple templates, non-PC element tools, layout publishing/version history, and richer editor controls.

### Stage 3B recovery hardening

Loading now returns an explicit persisted or recovery result. If a legacy or v2 blob cannot be normalized, its raw storage is never replaced: the application displays a validated in-memory fallback, a persistent warning, and blocks ordinary mutations, repository writes, and layout saves. Only a successful explicit import or deliberate reset can replace preserved raw data and exit recovery.

Normalization constructs a canonical AppDB from approved collections only. Every required top-level array and the `stock`/`maintenance` nested arrays are checked before referential layout validation; unknown top-level keys are omitted from normalized and exported data. Laboratory IDs, layout IDs, and device ownership are unique and referentially valid.

Browser storage writes return results rather than being swallowed. A DB-key write failure leaves provider state unchanged. Ordinary v2 saves write the DB blob once and do not rewrite the version key; initial seed, migration, import, reset, and stale-version repair are the only version-key write paths. A failed version repair is reported without misrepresenting a successful DB write as failed.

Storage reads distinguish a missing database key from malformed raw JSON and storage-read failure. Only a genuinely missing key creates a seed. Malformed or unreadable raw database content enters recovery unchanged, and ordinary writes remain blocked. During recovery, Settings disables clear-all because it would violate raw-data preservation; valid import and deliberate reset remain the explicit recovery exits. Mutation callers must inspect their typed results before showing success UI, and laboratory creation reports precise invalid/duplicate laboratory, layout, and device identity diagnostics.

Version-key reads are typed as well. A read or repair failure never makes a valid database unusable and never rewrites the DB blob; load results carry a warning and `versionWriteOk` state so a later load can retry repair. Monitoring status/incident/maintenance actions inspect mutation results, while heartbeat simulation always clears its loading state in `finally`.

Migration follows the same storage-health contract: when a normalized legacy blob is written successfully but its version-key write fails, the successful load returns the exact `persistDB` warning and `versionWriteOk: false` rather than replacing it with a clean default. `AppDataProvider` exposes this non-blocking state as `storageHealth` (`warnings` and `versionWriteOk`) and refreshes it for its bootstrap reload, explicit refresh, reset, and import paths. The app shell shows a concise retry-on-reload warning only when recovery is not active; recovery remains a separate, write-blocking/raw-preserving state.

Focused regression coverage uses deterministic storage doubles to exercise `getItem` read failures and version-key write failures. It asserts that unreadable DB storage never seeds over the original value, valid DB data stays usable when only the version key fails, current versions write neither key, stale or missing versions repair only the version key, failed repairs retry on later loads without rewriting the DB, and migration writes its DB blob exactly once while propagating a failed version write. The same suite covers malformed raw preservation, blocked ordinary writes and clear-all during recovery, explicit import/reset recovery exits, exact laboratory/layout/device identity failure codes, and failure guards for monitoring, incident, maintenance, and heartbeat UI flows.

Ordinary business saves intentionally do not read, validate, repair, or write the storage-version key. Consequently, `mutate` and ordinary `replaceDB` preserve the provider's current storage-health state after a successful DB write; they cannot turn an unresolved version warning into a healthy result. Only a load/refresh or explicitly version-aware initial seed, migration, import, or reset may replace storage health. A later successful version repair clears the warning, while a failed DB save preserves both the in-memory AppDB state and the existing storage-health warning.

## Stage 4A physical layout templates

Stage 4A adds a pure physical-template registry with `rpl-perimeter-center-island-36`: an exact 11×6 grid containing 66 cells: 36 `student_pc` elements, one real-device `teacher_pc`, one entrance door, and 28 fixed walking aisles. The teacher designation belongs to `LayoutElement.type`; no Device role field, fake Device, template ID persistence, or schema-version change is introduced. Compatibility requires exactly 37 same-laboratory Device records and an explicit teacher selection, so a 36-device lab remains safely incompatible.

The generated template is local editor draft state until the existing Simpan action persists it. Student devices are naturally sorted by position code and occupy the four deterministic banks: right (column 6, PC-01 through PC-09), center-right (column 4, PC-18 through PC-10), center-left (column 3, PC-19 through PC-27), and left (column 1, PC-36 through PC-28). PC Guru is fixed at row 1/column 1; Pintu Masuk is fixed at row 1/column 6; row 1 columns 2–5, all of row 2, and columns 2 and 5 in rows 3–11 are fixed aisles. Student references may subsequently swap within valid student slots through the Stage 3A engine. The structure validator recognizes this exact supported arrangement, including template-controlled 11×6 dimensions. `saveActiveLaboratoryLayout` permits a dimension change only for that valid structure, atomically updates Laboratory dimensions and the active layout, creates one audit log, and still rejects arbitrary resizing.

### Template and Custom architecture

Laboratory layouts have two future editing modes:

```text
Denah Laboratorium
├── Template
│   ├── Grid Classic
│   ├── Perimeter + Center Island
│   ├── U-Shape
│   └── Facing Rows
└── Custom
    └── freely resize and arrange elements
```

A Template has a recognized structural pattern and generates a validated local draft. A student-PC-to-student-PC seat swap within valid slots does not alter that topology, so it retains the template `layoutType`. Future Stage 4C operations that alter topology—arbitrary row or column resizing; adding/removing structural cells, aisles, walls, or windows; moving the door or structural furniture away from the template definition; or any other change that no longer validates as the named template—should convert the layout to `custom`.

Custom editing is not implemented in Stage 4A. Stage 4B adds an element palette for PC siswa, PC guru, teacher desk, door, window, wall, aisle, printer, network switch, access point, and label. Stage 4C will add template-to-custom conversion, row/column resizing, safe grid expansion/shrinking, free valid arrangement, element properties, and supported rotation/span operations. Expansion must create explicit `empty` cells. Shrinking must reject any operation that would clip a non-empty, structural, or device element; it must never silently delete a Device or structural element. Both future stages retain the local-draft → validation → Save/Cancel flow and the existing persistence, recovery, and audit contracts.

Manual UAT: create a temporary 37-device `LAB UAT PHYSICAL` (for example 6×6), open Denah, select the template and PC-37 as PC Guru, confirm the dirty draft, expected banks/aisles/door, fixed teacher, student swap and aisle rejection, cancel restore, then save and refresh to verify the persisted 11×6 layout and monitoring references. Check 1280×900, 768×1024, and 375×812; narrow layouts may scroll horizontally inside the canvas but must retain readable cells and contained surrounding content.

## Stage 4B element palette

Stage 4B adds a reusable Element Palette for local-draft placement, movement, and removal of one-cell non-PC elements: teacher desk, printer, network switch, access point, door, window, wall, aisle, and label. Palette-created elements have no `referenceId`, no Asset binding, one-cell spans, rotation `0`, and `fixed: false`, `movable: true`, `swappable: false`. Printer, network switch, and access point are therefore visual/infrastructure elements only until a later asset-binding stage.

`student_pc` and `teacher_pc` remain Device-managed vocabulary rather than palette-created elements. The palette displays them with a Data Perangkat explanation, but it cannot create, duplicate, or remove a Device reference. This preserves the active-layout requirement that every laboratory Device is represented exactly once.

Structural palette edits are permitted only for `grid-classic` and `custom` layouts. Named physical templates (`perimeter-center-island`, `u-shape`, and `facing-rows`) keep their structural contract locked; the palette explains that Custom Editor is required and domain operations reject placement/removal before altering the draft. Stage 4B does not convert templates to `custom`.

Placement replaces exactly one existing explicit `empty` element; removal replaces exactly one removable non-PC element with a caller-identified explicit `empty` element. The grid therefore remains complete throughout draft editing. Drag from the palette uses a distinct payload from existing-element movement, and touch/keyboard users can select a palette button then tap an empty canvas cell. Label placement requires trimmed non-empty text with a UI limit of 60 characters.

Palette changes never persist directly. They participate in the existing baseline → draft → dirty → Save/Cancel flow, including before-unload and navigation protection. A successful save remains one atomic database write and one `layout.save` audit; its summary now records `repositioned`, `added`, and `removed` element-ID deltas. No-op and rejected saves create no audit entries.

Stage 4C remains responsible for arbitrary resize, safe expand/shrink, template-to-custom conversion, rotation/span editing, and a richer property inspector.
