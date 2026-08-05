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

Successful `moved` and `swapped` operations receive `LayoutOperationOptions.updatedAt`; the supplied timestamp becomes `layout.updatedAt`. This keeps domain operations deterministic and avoids `new Date()` in the engine. A `noop` returns an immutable clone without changing `updatedAt` and does not consume the supplied timestamp.

## Validator and migration diagnostics

Validation returns structured issues rather than throwing for ordinary invalid data. It checks complete coverage, bounds, spans, rotations, element and reference IDs, PC-reference requirements, empty-reference prohibition, fixed/movable consistency, and layout status/activity consistency.

`migrateLegacyDeviceCoordinates` is an explicit, pure helper for later use. It filters to the target laboratory, validates duplicate/invalid device IDs and coordinates, emits deterministic row-major elements and IDs, preserves device labels/references, and returns diagnostics instead of partially migrating invalid data. It never mutates source devices or persists a layout.

## Dependency summary and PR 3B

`inspectLaboratoryDependencies` returns a complete zero-inclusive count record for every current laboratory-bound collection and a `canHardDelete` decision. It is not integrated with the existing deletion UI in PR 3A.

PR 3B can introduce persistence, migration execution, UI/editor integration, authorization, audit, and atomic save behavior after this pure engine and its contract are reviewed.
