# ADR-002: Asset, Inventory, Loan, and Preventive Maintenance Boundary

**Status:** Accepted — S4.1 authority lock  
**Date:** 2026-09-06  
**Decision owner:** Bakaran Project / SMARTLAB  
**Applies before:** S4 runtime implementation

## Context

SMARTLAB already has canonical Laravel/PostgreSQL authority for SchoolMembership-scoped identity, Laboratory, Device, Device Transfer, Layout, Incident, Scheduling/Availability, LaboratorySession, and ActivityReport. The frontend still contains useful browser-local prototypes for fixed assets, stock/spare parts, loans, preventive maintenance, and corrective Work Orders.

Those prototypes are evidence about desired workflows, but they are not canonical production authority. They also intentionally contain shortcuts that must not be copied directly into the server model:

- Asset state mixes physical condition, custody, maintenance, damage, loss, and disposal;
- Device and Asset duplicate code, brand, model, serial, Laboratory, and acquisition fields;
- Stock quantity is directly mutable in browser state;
- stock transactions can be represented without durable idempotency or database serialization;
- Loan stores free-text item name and quantity instead of stable per-unit custody;
- Maintenance can target free-text Asset code and can directly mutate related local state;
- Work Order consumes stock in browser memory and is a separate future S5 corrective-maintenance authority;
- local AppDB IDs are not Laravel identities and must not be treated as migration keys.

S4 needs one explicit bounded-context decision before implementation so that Asset, Device, Inventory, Loan, Maintenance, Incident, and Work Order do not become overlapping authorities.

## Decision summary

1. **SMARTLAB owns laboratory operational fixed-asset records.** Asset records cover operational inventory, procurement/warranty snapshots, physical condition, lifecycle/disposition, and Laboratory responsibility. They are not a general accounting ledger, depreciation engine, or school finance authority.
2. **Device and Asset remain separate identities.** Device is managed equipment identity and operational hardware identity. Asset is administrative/physical inventory identity. An Asset may optionally link to one Device and one Device may be linked to at most one Asset.
3. **Canonical Asset↔Device linkage is explicit and one-to-one.** No display-name, serial-number, or Asset-code-only runtime join is authoritative.
4. **Inventory/stock is not Asset.** Consumables and spare parts use InventoryItem plus immutable quantity transactions. Direct quantity mutation is not an accepted business operation.
5. **Inventory balance never becomes negative.** Every stock mutation is serialized transactionally and either commits the immutable transaction plus new balance atomically or commits nothing.
6. **Loan owns temporary custody.** Loan does not rewrite Asset home Laboratory, Device home Laboratory, Device lifecycle, Asset lifecycle, Layout placement, or TESSELA/availability data.
7. **Loaned durable items are identified by stable Asset identity.** Free-text `itemName + quantity` is not canonical custody evidence. A loan item references one Asset; bulk quantity means multiple LoanItem rows, not one ambiguous quantity over unnamed units.
8. **Preventive Maintenance is separate from Incident and Work Order.** Preventive plans/executions own scheduled preventive work. Incident owns reported operational problems. S5 Work Order owns corrective repair assignment/lifecycle.
9. **Preventive Maintenance may consume Inventory only through immutable InventoryTransaction records.** It must not decrement stock directly.
10. **Maintenance or Loan findings never auto-create an Incident or Work Order.** Any future promotion/link is explicit, permission-checked, idempotent, and preserves source evidence.
11. **Custody/current-location is derived.** Active Loan or active Maintenance custody may temporarily supersede home placement in a read projection, but never rewrites home identity fields.
12. **Browser-local S4 data is migration input, not authority.** Import must be explicit, validated, tenant-scoped, previewable, and fail closed on ambiguous identity mapping.
13. **Platform RBAC does not grant SMARTLAB tenant authority.** All S4 authorization remains based on an active SMARTLAB SchoolMembership plus SMARTLAB product permissions. Platform Admin/Superadmin status alone gives no implicit S4 row access.
14. **S4 does not implement S5 corrective Work Orders.** Existing `work-orders.*` permissions and browser prototype remain transitional until S5.

## Responsibility matrix

| Capability / data | Authority | Notes |
| --- | --- | --- |
| School / Person / PhysicalSpace shared identity | BP Master Data target | SMARTLAB consumes/mapps shared identity where applicable; no implicit local role grant |
| Laboratory operational resource | SMARTLAB | Existing canonical authority |
| Device managed-equipment identity | SMARTLAB Device domain | Existing canonical authority |
| Fixed Asset operational inventory | SMARTLAB Asset domain | S4 authority |
| School accounting / depreciation / general ledger | Outside this S4 contract | Asset price/funding/supplier fields are operational snapshots, not accounting authority |
| Stock/spare-part catalog + on-hand balance | SMARTLAB Inventory domain | S4 authority |
| Immutable stock movement history | SMARTLAB InventoryTransaction | S4 authority |
| Temporary custody / checkout / return | SMARTLAB Loan domain | S4 authority |
| Preventive maintenance plan/execution | SMARTLAB Preventive Maintenance domain | S4 authority |
| Incident/problem report | SMARTLAB Incident domain | Existing canonical authority |
| Corrective repair assignment / Work Order | SMARTLAB Work Order domain | **S5**, not S4 |
| Telemetry/heartbeat/metrics | SMARTLAB telemetry subsystem | S6, not Asset/Maintenance persistence |
| Physical placement geometry | SMARTLAB Layout domain | Existing canonical authority |
| Current physical-location projection | SMARTLAB cross-domain read model | Derived from Loan/Maintenance/Layout/home Laboratory, never a second writable field |

## Asset and Device boundary

A Device answers:

> What managed piece of equipment is this, what is its durable hardware identity, and how does SMARTLAB operate it?

An Asset answers:

> What fixed physical asset does the School/Laboratory administer, what is its inventory/procurement evidence, what condition/lifecycle is recorded, and what managed Device (if any) represents it operationally?

Rules:

- Asset and Device have different primary keys.
- Canonical linkage is by server foreign key, not by matching display values.
- One Asset may have zero or one Device link.
- One Device may have zero or one Asset link.
- Linking requires same School ownership.
- If both records have a home Laboratory, linkage requires them to agree.
- Link/unlink is an explicit audited operation; ordinary PATCH cannot silently change linkage.
- A linked Device transfer must not be simulated by editing Asset Laboratory state independently.
- A linked Asset must not overwrite Device technical profile, Device lifecycle, QR identity, telemetry, or Layout placement.
- Device must not become the procurement/warranty/price source of truth.
- Asset must not become the Device telemetry/technical-profile source of truth.

The existing browser-only `Device.assetId` relationship is migration evidence only. The canonical physical schema may place the foreign key on the Asset side or use a dedicated link table, as long as the one-to-one constraints and semantics above are enforced. The implementation PR must choose one schema and expose only one canonical relation.

## Asset state separation

The browser prototype currently has one `Asset.status` enum containing values such as Active, Loaned, Maintenance, Damaged, Lost, and Disposed. Canonical S4 rejects that mixed state model.

Persisted dimensions are separated:

- **condition** — physical condition evidence;
- **lifecycle/disposition** — durable administrative lifecycle;
- **custody** — derived from active Loan/Maintenance;
- **home Laboratory** — normal responsibility, not live location;
- **current location** — derived projection;
- **Device operational health** — separate Device/Telemetry concern.

Canonical Asset lifecycle candidate:

`active -> retired -> disposed`

with `lost` represented as an explicit exceptional disposition state/action if implementation policy requires it. `disposed` is terminal. Exact lifecycle action endpoints are finalized in S4.2, but no hard-delete API is accepted for historically referenced Assets.

Canonical condition candidate:

`good | minor_damage | moderate_damage | major_damage | unknown`

A Loan, Maintenance execution, Incident, or Work Order may provide evidence that leads an authorized Asset-condition update, but none of those domains silently owns Asset lifecycle.

## Inventory boundary

Inventory represents fungible or quantity-tracked supplies such as spare parts and consumables.

It is not:

- a fixed Asset register;
- a Loan custody ledger for individually tracked durable units;
- a Work Order;
- an accounting general ledger.

Canonical inventory mutation rule:

```text
InventoryItem metadata
+ immutable InventoryTransaction ledger
+ transactionally maintained on-hand balance
= canonical stock state
```

No endpoint may directly set current quantity as a normal edit. Opening stock, receipt, issue, and correction all produce immutable transactions.

A correction never edits or deletes an old movement. It creates a compensating movement with reason and actor evidence.

## Loan / custody boundary

A Loan owns temporary possession of durable Assets.

It does not:

- change Asset home Laboratory;
- change Device home Laboratory;
- move Layout geometry;
- change Device lifecycle;
- decrement Inventory;
- create an Incident automatically;
- reserve a Laboratory;
- modify a TESSELA timetable.

An active Loan contributes to a derived current-custody/current-location answer. On return, the Loan records return evidence and condition snapshot. If damage is found, an authorized actor may later create/link an Incident explicitly.

Overdue is derived from dates and active status; it is not required to be a separately persisted lifecycle state.

## Preventive Maintenance boundary

Preventive Maintenance owns planned recurring or dated preventive work and execution evidence.

It is not:

- Incident triage;
- corrective repair assignment;
- a Work Order status;
- Device telemetry;
- a Laboratory Calendar event by default.

A maintenance execution always targets stable canonical physical identity, not only free-text Asset code. The baseline S4 target is an Asset; a linked Device may be included as read-only context.

Preventive maintenance may make an Asset temporarily unavailable through derived custody. It does **not** automatically block an entire Laboratory. If the whole Laboratory must be unavailable, the operation must create/use an explicit canonical Laboratory blocker through the established operational-availability mechanism rather than teaching Maintenance a second Laboratory-availability algorithm.

Inventory consumption during maintenance uses the Inventory service in the same server transaction or a safely coordinated application transaction. The resulting immutable InventoryTransaction references the MaintenanceExecution source.

## Corrective Work Order boundary

S5 remains the sole owner of corrective repair work.

S4 may prepare the integration seam:

- InventoryTransaction may reserve a future source type for Work Order consumption;
- Asset/Device/Incident IDs remain available for future S5 references;
- current browser Work Order behavior is not promoted to server authority in S4.

S4 must not:

- add Work Order database tables;
- migrate `/work-orders` to server authority;
- use PreventiveMaintenanceExecution as a hidden corrective Work Order;
- move `Waiting Part` or repair assignment state into Incident.

## Availability and custody

S4 introduces resource custody/availability for Assets, not a parallel Laboratory availability engine.

Asset allocatability is derived from at least:

- lifecycle;
- current condition policy;
- active Loan custody;
- active Preventive Maintenance custody;
- optionally linked Device lifecycle.

Laboratory availability remains owned by the existing Unified Laboratory Availability service. A future explicit maintenance-related Laboratory blocker must enter that existing engine as canonical evidence; absence of such integration must not be approximated in frontend code.

## Security and tenant boundary

Every canonical S4 row belongs to exactly one School.

Rules:

- `school_id` is server-derived from active membership and prohibited in client payloads;
- every related Asset, Device, Laboratory, InventoryItem, Loan, and Maintenance record must resolve inside the same School;
- cross-School IDs are indistinguishable from unknown IDs;
- list/detail/action queries scope by School before identifier;
- frontend permission guards are UX only;
- Laravel permission middleware/application services remain authoritative;
- Platform Admin/Superadmin status is not a substitute for SMARTLAB SchoolMembership;
- local SMARTLAB Super Admin only has authority when that role exists inside the active SMARTLAB membership.

## Historical integrity

S4 history is append-oriented.

- Asset identifiers and disposed records remain resolvable.
- InventoryTransaction is immutable.
- Loan handover/return/inspection evidence is not rewritten by later Asset master changes.
- MaintenanceExecution stores snapshots required to understand what was performed at the time.
- Shared Master Data or display-name changes do not silently rewrite historical borrower/technician/reason snapshots.
- Correction uses new events/transactions, never destructive history editing.

## Browser-local migration policy

The current `AppDataProvider` records are not server identities.

Migration must not:

- copy browser IDs as trusted canonical IDs;
- auto-link Assets to server Devices by name alone;
- auto-link by Asset code or serial when duplicates/ambiguity exist;
- import direct stock quantity without corresponding opening/correction evidence;
- fabricate borrower Person identity;
- fabricate Maintenance/Incident/Work Order links.

A future import/adoption tranche must provide:

1. explicit source/version;
2. preview;
3. School scope;
4. deterministic stable matching rules;
5. ambiguous/unmatched report;
6. no partial commit;
7. rollback/retry semantics;
8. post-import reconciliation.

## Permission namespace direction

Existing canonical keys retained:

- `assets.view`
- `assets.create`
- `assets.update`
- `assets.export`

Existing `assets.delete` is a compatibility key and must **not** imply a future hard-delete endpoint for historical Assets.

S4 implementation should introduce exact permissions rather than overloading generic keys:

- `assets.link-device`
- `assets.retire`
- `assets.dispose`
- `stock.view`
- `stock.create`
- `stock.update`
- `stock.transact`
- `stock.export`
- `loans.view`
- `loans.view-all`
- `loans.create`
- `loans.approve`
- `loans.handover`
- `loans.return`
- `loans.inspect`
- `loans.cancel`
- `loans.export`
- `maintenance.view`
- `maintenance.view-all`
- `maintenance.create`
- `maintenance.update`
- `maintenance.execute`
- `maintenance.cancel`
- `maintenance.export`

Exact role grants are finalized with implementation tests. Permission presence never bypasses tenant scope or entity-state validation.

## Non-goals

ADR-002 does not approve:

- accounting/depreciation/general-ledger features;
- hard deletion of historically referenced Assets;
- direct stock quantity edits;
- negative stock;
- auto-generated Incidents/Work Orders from Loan or Maintenance findings;
- S5 Work Order implementation;
- S6 telemetry implementation;
- full Laboratory maintenance blocking without the canonical availability engine;
- browser-local data becoming production authority;
- Platform Superadmin cross-tenant data access;
- a second PhysicalSpace/Laboratory authority.

## Consequences

Positive:

- Device, Asset, Inventory, Loan, Maintenance, Incident, and Work Order have non-overlapping ownership;
- inventory can enforce non-negative stock transactionally;
- temporary custody no longer corrupts home location;
- S5 can consume S4 inventory without owning stock;
- historical evidence remains reconstructable;
- future BP Master Data/Finance integration has an explicit boundary.

Cost:

- migration from the prototype requires reconciliation rather than a blind copy;
- some current UI statuses become derived projections instead of persisted fields;
- Asset↔Device linkage requires a coordinated action;
- Inventory and Maintenance cross-domain consumption needs transaction discipline.

## S4 entry gate

S4 runtime implementation may begin only after this ADR and the companion [S4 Asset, Inventory, Loan, and Preventive Maintenance Contract](asset-inventory-loan-maintenance-contract.md) are accepted on `main`.

Recommended implementation sequence:

1. S4.1 — contract/authority lock;
2. S4.2 — Asset backend + Asset↔Device linkage + `/assets` cutover;
3. S4.3 — InventoryItem/InventoryTransaction backend + `/stock` cutover;
4. S4.4 — Loan/custody backend + `/loans` cutover;
5. S4.5 — Preventive Maintenance backend + inventory consumption + `/maintenance` cutover;
6. S4.6 — cross-domain custody/availability reconciliation, migration/UAT, and S4 closure.

S5 Work Orders begins only after S4 inventory/custody invariants are stable.
