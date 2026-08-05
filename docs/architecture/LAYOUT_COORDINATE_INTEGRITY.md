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
