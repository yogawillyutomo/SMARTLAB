# Managed Device Inventory Foundation (Stage 4D.1A)

## Domain ownership

SmartLab keeps three separate responsibilities:

- `Asset` is the administrative inventory record: acquisition, funding, supplier, warranty, condition, and inventory status.
- `Device` is the stable physical managed-hardware identity and operational record.
- `LayoutElement` is the physical placement and geometry. Its optional `referenceId` binds a position to a `Device`.

`Device.deviceType` describes hardware (`desktop_pc`, `laptop`, `server`, network equipment, printer, projector, UPS, or other). It is independent from the layout role. A desktop Device can be referenced by a `student_pc` element and later by a `teacher_pc` element without changing Device identity or hardware type.

The existing `Device.status` remains operational state. `Device.lifecycleStatus` is lifecycle state. `Asset.condition` and `Asset.status` remain physical/inventory condition and administrative inventory status respectively.

## Stable identity and QR contract

Every schema-version-3 Device has an opaque, URL-safe, globally unique `qrPublicId`. Production generation uses the platform-native cryptographic UUID source and does not encode the Device ID, Asset code, serial number, laboratory, or hardware type. The deterministic seed generator uses isolated fixture-only values so fresh/reset data remains reproducible.

The QR identifier identifies the physical Device. It is not a secret, Asset code, serial number, or layout position. Ordinary repository updates cannot change `id`, `deviceType`, `lifecycleStatus`, `qrPublicId`, `assetId`, `assetCode`, `serialNumber`, or `laboratoryId`. Lifecycle transitions preserve the exact QR. The read-only resolver succeeds only for one exact match; missing IDs return not found and duplicate corrupted IDs return an integrity failure rather than an arbitrary first record.

Future replacement creates a new Device and QR. Future transfer keeps the same Device and QR. Retired and decommissioned Devices retain their historical QR identity. Routes, QR rendering/scanning, labels, replacement, transfer, and placement workflows are outside Stage 4D.1A.

## Asset relationship and legacy linking

`Device.assetId` is the optional persisted Device-to-Asset relationship. One Device may reference zero or one Asset, and one Asset may be referenced by at most one Device. A canonical link requires the Asset to exist and its `assetCode` and `laboratoryId` to equal the Device values.

Schema-version-2 migration looks for Assets with an exact `assetCode` and same `laboratoryId`:

- exactly one match sets `assetId`;
- no match leaves the Device unlinked;
- multiple matches also leave it unlinked rather than choosing arbitrarily.

Migration never fabricates an Asset or invents procurement data. Link status is derived as linked, unlinked, or invalid and is not another persisted field.

Ordinary Asset mutations are link-aware. A linked Asset may retain administrative edits that preserve the relationship, but its `assetCode` and `laboratoryId` cannot change independently. Linked Asset deletion and Asset-only transfer are rejected before persistence or audit. Unlinked Assets retain their existing edit, delete, and transfer behavior. A future controlled Device transfer must coordinate Device, Asset, placement, and history atomically; Stage 4D.1A does not simulate that workflow.

## Lifecycle policy and audit

Lifecycle states are `in_service`, `spare`, `retired`, and terminal `decommissioned`. Transfer is a future location-history event, not a lifecycle state.

Allowed real transitions are:

- `in_service` to `spare` or `retired`;
- `spare` to `in_service` or `retired`;
- `retired` to `in_service`, `spare`, or `decommissioned`.

`decommissioned` has no outgoing transition. A same-state request is a true no-op: it returns the existing database, creates no audit event, and does not consume timestamp or audit identity. Every real transition changes only `lifecycleStatus` in the Device and prepends exactly one existing-format audit entry with action `device.lifecycle.change`, old/new lifecycle, actor, time, Asset code, and hardware type. QR values are excluded from audit text.

## Persistence migration and recovery

Stage 4D.1A advances the AppDB schema from 2 to 3 and the external storage version from `2.0.0` to `3.0.0`. The single controlled v2-to-v3 migration assigns every legacy PC `deviceType: desktop_pc`, `lifecycleStatus: in_service`, and one collision-checked QR, then applies the conservative Asset-link rule. Existing Device identity, operational/technical fields, laboratory ownership, layout references, and unrelated AppDB collections are preserved.

The candidate database is validated before any write. QR generation exhaustion or canonical Device/Asset integrity failure returns no partial AppDB. `loadDB` retains the existing raw-preserving recovery mode for malformed or invalid source data. A successful migration writes the canonical blob once with storage version `3.0.0`; subsequent reads validate version 3 directly and preserve QR identifiers exactly.

Canonical validation checks managed hardware type, lifecycle state, QR format and global uniqueness, linked Asset existence and one-to-one ownership, and linked code/laboratory agreement. Legacy Devices may remain intentionally unlinked. This stage does not add global serial-number or Asset-code uniqueness rules.

## Stage boundary

Stage 4D.1A adds domain identity, lifecycle, QR resolution, migration, validation, tests, and documentation only. It does not add non-PC creation UI, type-specific technical profiles, hard deletion, replacement, transfer, detach/place operations, layout binding changes, QR routes/images/scanning/printing, backend contracts, or monitoring redesign. Device coordinates remain absent; LaboratoryLayout remains the only persisted coordinate source.
