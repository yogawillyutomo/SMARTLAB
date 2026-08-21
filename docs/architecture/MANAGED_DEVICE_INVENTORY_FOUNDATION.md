# Managed Device Inventory Foundation (Stages 4D.1A–4D.1B)

## Domain ownership

SmartLab keeps three separate responsibilities:

- `Asset` is the administrative inventory record: acquisition, funding, supplier, warranty, condition, and inventory status.
- `Device` is the stable physical managed-hardware identity and operational record.
- `LayoutElement` is the physical placement and geometry. Its optional `referenceId` binds a position to a `Device`.

Stage 4D.1B adds a fourth explicitly separate responsibility: `Device.technicalProfile` stores hardware-type-specific specifications, while optional root Device telemetry stores runtime observations. `Asset` remains the procurement/administrative record and does not own the technical profile.

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

Stage 4D.1B also locks `brand`, `model`, and `serialNumber` during ordinary edits of a linked Asset. Those fields remain on both legacy/admin Asset presentation and Device technical identity, but canonical validation deliberately does not require historical values to be equal. This prevents new drift without forcing valid legacy databases into recovery. A future controlled Device workflow must coordinate technical-identity changes.

## Type-specific technical profiles

`DeviceTechnicalProfile` is a `kind`-discriminated union. Its discriminator must exactly equal `Device.deviceType`:

| Device type / profile kind | Optional specification scope |
| --- | --- |
| `desktop_pc` | processor, RAM, storage, GPU, monitor, OS, desktop peripherals |
| `laptop` | processor, RAM, storage, GPU, OS, display, battery health |
| `server` | processor, sockets, cores, RAM, storage, RAID, OS |
| `network_switch` | ports, managed/PoE capability, PoE budget, switching/uplink capacity, firmware |
| `router` | WAN/LAN ports, throughput, Wi-Fi capability, firmware |
| `access_point` | Wi-Fi standard and bands, client capacity, PoE, firmware |
| `printer` | print technology, color, duplex, network capability, paper size |
| `projector` | technology, brightness, native resolution, lamp hours |
| `ups` | VA/watt capacity, battery details, runtime |
| `other` | conservative scalar key/value specifications |

Specification fields are optional because incomplete inventory information is valid. Each profile kind has an exact top-level field allowlist; fields belonging to another hardware kind and unknown fields fail validation instead of being retained silently. Desktop `peripherals`, when present, has the exact required boolean keys `monitor`, `keyboard`, `mouse`, `headset`, `network`, and `ups`. The `other.specifications` map alone allows arbitrary keys, and every value must be a finite number, string, or boolean.

Validation also rejects an absent profile, unknown or mismatched kind, invalid primitive values, non-finite or negative capacities/counts, battery health outside 0–100, unsupported access-point bands, unsupported printer technology, and non-scalar `other` values. Canonical schema-version-4 Devices reject legacy root `processor`, `ramGB`, `storageGB`, `gpu`, `monitor`, `os`, and `peripherals` fields so there is no second specification source.

The generic Device repository treats the profile, hardware type, lifecycle, QR, Asset relationship, code, serial, brand, model, and laboratory as protected identity. Stage 4D.1B does not expose a technical-profile editing UI.

## Optional operational telemetry

`cpuUsage`, `ramUsage`, `diskUsage`, `temperature`, `uptimeHours`, `network`, and `lastHeartbeat` remain root operational telemetry and are optional. They are not technical specifications. Monitoring display helpers render missing measurements as unavailable, and heartbeat/status simulation mutates only telemetry fields already present. A router, printer, unmanaged switch, projector, or UPS is never assigned fabricated PC metrics.

The current desktop seed retains all existing telemetry and PC-card behavior. Monitoring specifications and peripherals are read through centralized technical-profile accessors; non-desktop profiles can be represented without fake desktop fields even though non-PC creation and generic monitoring-card design remain future work.

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

Stage 4D.1B advances AppDB schema 3 to 4 and external storage `3.0.0` to `4.0.0`. Every official v3 Device is a desktop PC. Migration moves its seven root PC specification areas into a deeply independent `desktop_pc` profile, removes those root fields, and preserves Device identity, QR, lifecycle, Asset link/code, operational status, telemetry, timestamps, layout references, and unrelated collections. Existing QR values are never regenerated and Assets are never relinked.

Older imports still reach the final schema in one in-memory normalization and one atomic canonical write:

- v1: migrate coordinates to layouts, add managed identity, then create desktop profiles;
- v2: add managed identity, then create desktop profiles;
- v3: create desktop profiles only;
- v4: validate canonical data without rerunning migration.

An unexpected non-desktop v3 Device fails with `unsupported-v3-device-profile-migration`; SmartLab does not guess specifications or coerce its type. Because official schema v3 has no nested profile, any own `Device.technicalProfile` property fails closed with `unexpected-v3-technical-profile` instead of being discarded or merged. The existing recovery path keeps the original raw storage bytes and prevents partial writes. Malformed canonical profiles, including foreign profile fields, use the same raw-preserving recovery semantics.

## Stage boundary

Stages 4D.1A–4D.1B provide managed identity, lifecycle, QR resolution, type-specific technical profiles, safe legacy migration, validation, monitoring compatibility, tests, and documentation. They do not add non-PC creation UI, hard deletion, replacement, transfer, detach/place operations, layout binding changes, QR routes/images/scanning/printing, backend contracts, or a monitoring subsystem redesign. Device coordinates remain absent; LaboratoryLayout remains the only persisted coordinate source.
