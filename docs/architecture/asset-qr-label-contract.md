# Asset QR Identity & Label Batch Contract

**Status:** LOCKED FOR S5.6 IMPLEMENTATION  
**Baseline:** `main@276326946bd4d4b9c6cf7073058886a893279e52`  
**Branch:** `feat/s5-6-asset-qr-labels`

## 1. Purpose

S5.6 adds a durable QR identity and printable physical label workflow for canonical SmartLab Assets. It does not create a new Asset, Device, Inventory, Loan, Maintenance, Work Order, scheduling, or Laboratory-availability authority.

The QR is an entry point to current canonical data. It is not a copy of mutable technical, financial, custody, or operational state.

## 2. Ownership boundary

- One QR identity belongs to exactly one canonical Asset.
- Device remains technical authority. Existing Device `qr_public_id` is not reused as the Asset QR.
- Asset remains administrative/custody subject authority.
- Loan, MaintenanceExecution, WorkOrder, Incident, and LaboratorySession never own the physical Asset sticker.
- Replacing/upgrading RAM, storage, OS, or other Device technical profile does not require replacing the Asset sticker.
- Asset↔Device link/unlink does not rotate the Asset QR by itself.

## 3. QR payload

The encoded value contains only a random, non-enumerable public identifier routed to an Asset scan endpoint.

The QR must not encode:

- Asset ULID or School ULID;
- Device ULID;
- serial number;
- purchase price;
- funding source;
- supplier;
- notes;
- borrower/person identity;
- Loan/Maintenance/Work Order identifiers;
- audit/event payload;
- technical profile/specifications.

A leaked or photographed label therefore reveals no sensitive record directly from QR bytes.

## 4. Identity lifecycle

`AssetQrIdentity` is history-preserving:

- `active` — current public identifier for one Asset;
- `revoked` — no longer resolves publicly.

Rules:

1. One Asset has at most one active QR identity.
2. `public_id` is globally unique and random.
3. `token_version` increases monotonically per Asset.
4. Rotation revokes the current row and inserts a new row transactionally.
5. Revocation requires actor snapshot, reason, and timestamp.
6. A revoked public identifier resolves as not found; it never redirects to the replacement token.
7. Identity issue/rotation/revoke does not increment Asset `version` because it is not an Asset metadata mutation.
8. Historical identity rows are never deleted or rewritten except the single active→revoked transition and nullable live-actor FK cleanup.

## 5. Public scan projection

Anonymous scan uses a dedicated resource and must never reuse `AssetResource`.

Allowed anonymous fields are intentionally minimal:

- display-safe School name/code;
- Asset code;
- Asset name;
- category;
- condition label;
- lifecycle status;
- Home Laboratory code/name when assigned.

Anonymous scan must not expose internal IDs, serial number, acquisition/funding/price/supplier fields, notes, linked Device identity/specification, custody holder, Incident/WO history, actor identities, or audit data.

Unknown, malformed, revoked, or cross-scope public identifiers are indistinguishable safe not-found responses.

## 6. Authenticated expansion

An authenticated user with an active SchoolMembership may resolve richer live data only through existing permissions.

Examples:

- `assets.view` permits canonical Asset detail;
- `devices.view` permits live linked Device technical data;
- `loans.view`, `maintenance.view`, and `work-orders.view` permit their own authorized projections.

QR scanning does not grant any new permission and does not broaden row visibility.

Platform Super Admin has no implicit tenant access. The normal active SchoolMembership boundary remains mandatory.

## 7. Permissions

S5.6 introduces:

- `assets.manage-qr` — issue, rotate, or revoke Asset QR identity;
- `assets.generate-labels` — create label batches and record reprints.

Baseline grants:

- `admin-lab`: both;
- `kepala-lab`: both;
- `super-admin`: both only through the existing all-catalog role and still subject to active membership;
- no automatic grants to `teknisi`, `guru`, `ketua-kelas`, `siswa`, or `pimpinan`.

## 8. Label batch authority

`AssetQrLabelBatch` records one immutable generation request. `AssetQrLabelBatchItem` records the exact Assets and active QR identities selected at that time.

Batch filters may include:

- Home Laboratory;
- Asset category;
- lifecycle;
- condition;
- linked/unlinked Device state;
- search;
- printed/not-yet-printed state once derived from canonical batch history.

Initial physical templates:

- `40x25` mm;
- `50x30` mm — default;
- `70x40` mm.

A batch stores generated-by snapshots, selected filters, template, count, generation time, and per-item Asset/QR/Laboratory snapshots. Reprints are separate append-only events; batch/item rows are not rewritten.

## 9. Label content

A label may show:

- SMARTLAB / BP branding;
- QR;
- Asset code;
- short Asset name;
- Home Laboratory code/name when space allows.

A label must not show price, funding, supplier, borrower, audit metadata, or sensitive serial information.

The later PDF tranche must use high QR error correction, preserve quiet zone, and limit centered BP logo obstruction to approximately 15–18% of the QR area. Physical scan reliability is a mandatory UAT gate.

## 10. Non-effects

QR issuance, rotation, revocation, batch generation, preview, PDF creation, download, print, and reprint must not:

- change Asset condition/lifecycle/home Laboratory/version;
- mutate Device lifecycle/home Laboratory/technical profile;
- create or release Loan/Maintenance/Work Order custody;
- consume Inventory;
- create or resolve Incident;
- create Laboratory closure/availability blockers;
- modify TESSELA schedule or Operational Calendar.

## 11. Persistence invariants

Database enforcement must guarantee:

- same-School Asset↔QR identity binding;
- globally unique public identifier;
- unique token version per Asset;
- at most one active identity per Asset;
- exact active→revoked state evidence;
- immutable batch configuration;
- exact batch-item Asset↔QR snapshot binding at insertion;
- immutable batch items;
- immutable generation/reprint events;
- actor snapshot retention if live User/Membership rows are later removed.

SQLite portable tests and PostgreSQL validation both remain required.

## 12. Delivery slices

- **S5.6.1:** persistence, permissions, identity lifecycle API, safe public resolution, tests, OpenAPI.
- **S5.6.2:** label batch API, filters, generation/reprint evidence, frontend preview.
- **S5.6.3:** A4 PDF rendering, 40×25 / 50×30 / 70×40 templates, BP logo QR composition, download/print UX.
- **S5.6.4:** browser UAT + physical phone scan UAT + security/privacy verification + post-merge regression.

S6 monitoring telemetry remains deferred until S5.6 closes.
