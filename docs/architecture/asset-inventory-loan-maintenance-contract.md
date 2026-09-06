# S4 Asset, Inventory, Loan, and Preventive Maintenance Contract

**Status:** Accepted — S4.1 semantic contract  
**Scope:** semantic contract and implementation sequencing; S4.2–S4.4 are merged implementations and S4.5 is the PR #82 implementation candidate  
**Authority:** governed by [ADR-002](ADR-002-asset-inventory-loan-maintenance-boundary.md)

## 1. Contract goals

S4 turns four browser-local operational areas into tenant-scoped server-authoritative domains without creating duplicate authority:

- fixed Assets;
- stock/spare-part Inventory;
- Loans / temporary custody;
- Preventive Maintenance.

The implementation must preserve existing SMARTLAB invariants:

- active SchoolMembership is the tenant boundary;
- server authorization is authoritative;
- canonical IDs are server generated;
- PostgreSQL constraints defend important invariants;
- optimistic concurrency prevents silent overwrite;
- material history is append-oriented;
- retryable commands are idempotent where duplication would be harmful;
- browser-local prototype state stops being authority after route cutover;
- Device, Incident, Work Order, Layout, TESSELA, and BP Master Data keep their existing boundaries.

## 2. Existing prototype audit

| Prototype | Useful intent | Unsafe behavior that must not become canonical |
| --- | --- | --- |
| `AssetsPage` | fixed-asset CRUD, condition, procurement data, transfer UX | direct browser mutation; mixed Asset status; local IDs; Asset-only transfer can conflict with linked Device |
| `StockPage` | item catalog, low-stock threshold, stock history | direct mutable quantity; adjustment semantics are weak; browser-only non-negative guard |
| `LoansPage` | request/approval/handover/return/inspection | free-text item identity; quantity over unnamed units; return can create Incident locally |
| `MaintenancePage` | preventive plans, checklist, execution history | free-text Asset code target; execution can mutate local state without canonical concurrency |
| `WorkOrdersPage` | corrective lifecycle and spare-part usage | S5 authority; direct browser stock decrement; must not be promoted in S4 |
| managed-device prototype | explicit Device/Asset separation and one-to-one-link intent | local IDs and duplicated fields are not backend identity |

## 3. Common persistence conventions

All S4 canonical entities use:

- ULID primary key unless an existing repository convention requires equivalent opaque server identity;
- required `school_id` derived from current SMARTLAB membership;
- database foreign keys with restrictive historical behavior;
- integer `version >= 1` for mutable aggregate roots;
- `created_at` / `updated_at` server timestamps;
- exact School-scoped queries;
- camelCase API properties;
- stable error codes;
- `If-Match: "<version>"` on material updates/actions where stale state matters.

Client payloads must reject:

- `schoolId`;
- entity IDs on create;
- actor IDs/names that are server-derived;
- version/timestamps controlled by the server;
- unknown fields.

## 4. Asset contract

### 4.1 Purpose

Asset is the operational fixed-asset/admin record. It is not Device, stock, telemetry, a Loan, a Layout element, or an accounting ledger.

### 4.2 Candidate fields

Conceptual API model:

```text
Asset
  id
  assetCode
  name
  category
  brand?
  model?
  serialNumber?
  homeLaboratoryId?
  condition
  lifecycleStatus
  acquisitionDate?
  acquisitionYear?
  fundingSource?
  purchasePrice?
  supplierName?
  warrantyUntil?
  notes?
  linkedDeviceId?
  version
  createdAt
  updatedAt
```

Rules:

- `assetCode` required, normalized, unique within School, and immutable through ordinary PATCH;
- display name is not identity;
- `homeLaboratoryId` is nullable and means normal administrative responsibility, not current live location;
- `purchasePrice`, funding, supplier, and warranty are operational snapshots only;
- serial number is searchable but not required globally unique;
- linked Device is optional and one-to-one;
- no hard delete for a historically referenced Asset.

### 4.3 Condition

Candidate closed values:

- `good`
- `minor_damage`
- `moderate_damage`
- `major_damage`
- `unknown`

Condition changes are material, versioned, and audited.

### 4.4 Lifecycle

Baseline lifecycle:

```text
active -> retired -> disposed
```

No ordinary PATCH may jump directly to terminal disposition. Retirement/disposal are action-specific workflows with reason and audit. If `lost` is required, implementation must model it explicitly as a disposition state/action rather than overloading condition or Loan state.

`loaned`, `maintenance`, and `damaged` are not Asset lifecycle values.

### 4.5 Asset↔Device link

Link action invariants:

1. both rows belong to current School;
2. Asset has no linked Device;
3. Device has no linked Asset;
4. Device lifecycle permits administrative linking;
5. if both home Laboratory values are non-null, they match;
6. `If-Match` protects Asset version;
7. link is written atomically and audited;
8. retry does not create duplicate relation.

Unlink is separate, reasoned, and fails closed when an active Loan/Maintenance/other future dependency would make detachment unsafe.

Ordinary Asset PATCH cannot change the link.

## 5. Inventory contract

### 5.1 Purpose

InventoryItem represents a quantity-tracked consumable/spare-part catalog item. InventoryTransaction is immutable movement evidence.

### 5.2 InventoryItem candidate fields

```text
InventoryItem
  id
  itemCode
  name
  category
  unit
  minimumStock
  storageLocation?
  supplierName?
  unitPriceSnapshot?
  onHandQuantity
  version
  createdAt
  updatedAt
```

Rules:

- `itemCode` unique per School;
- metadata PATCH never directly changes `onHandQuantity`;
- `minimumStock >= 0`;
- quantity precision uses a PostgreSQL numeric type chosen to support expected School units; implementation must not assume all stock is integer-only if unit policy permits fractional quantities;
- inactive/archive behavior must preserve transaction history.

### 5.3 InventoryTransaction candidate fields

```text
InventoryTransaction
  id
  inventoryItemId
  clientMutationId
  kind
  quantity
  signedDelta
  balanceBefore
  balanceAfter
  reason
  sourceType?
  sourceId?
  actor snapshot
  occurredAt
  createdAt
```

Candidate kinds:

- `opening`
- `receipt`
- `issue`
- `adjustment_in`
- `adjustment_out`

Rules:

- immutable after commit;
- positive `quantity > 0`;
- signed delta is server-derived from kind;
- `balanceAfter >= 0`;
- item row is locked `FOR UPDATE` during movement;
- movement + balance update + audit commit atomically;
- failure commits neither transaction nor balance;
- correction is a new compensating transaction;
- direct transaction delete/update endpoints do not exist.

### 5.4 Retry/idempotency

Every inventory movement carries a client-generated cryptographically random stable `clientMutationId`.

Server stores canonical request fingerprint.

- same mutation ID + same canonical payload => replay existing result;
- same mutation ID + different payload => integrity conflict;
- network retry never creates duplicate stock movement.

The exact implementation may reuse the proven S3.6 receipt pattern or use a unique transaction row if equivalent semantics are guaranteed.

## 6. Loan / custody contract

### 6.1 Purpose

Loan represents temporary custody of individually tracked durable Assets.

Inventory consumables are issued through InventoryTransaction, not Loan.

### 6.2 Aggregate

```text
Loan
  id
  loanNumber
  borrowerReference?
  borrowerNameSnapshot
  borrowerUnitSnapshot?
  purpose
  requestedReturnAt
  approvedAt?
  handedOverAt?
  returnedAt?
  inspectedAt?
  status
  requester/approver/handover/return/inspection snapshots
  version
  createdAt
  updatedAt

LoanItem
  id
  loanId
  assetId
  conditionOut
  conditionReturn?
  returnNotes?
```

One Loan may contain multiple LoanItem rows. Each row references exactly one Asset. There is no `quantity > 1` over one ambiguous item identity.

### 6.3 Borrower identity

Until BP Master Data Person integration is available, S4 stores deliberate historical borrower snapshots and may optionally store a stable external/person reference when available.

Rules:

- borrower display text is evidence, not cross-product master authority;
- SMARTLAB must not fabricate a Person ID;
- changing a Person name later does not rewrite an already handed-over Loan snapshot.

### 6.4 Lifecycle

Baseline lifecycle:

```text
submitted
  -> approved
  -> rejected
  -> cancelled

approved
  -> checked_out
  -> cancelled

checked_out
  -> returned

returned
  -> closed
```

`overdue` is derived from `checked_out` plus requested return time; it is not a required persisted lifecycle value.

Rejected/cancelled/closed are terminal for the original Loan.

### 6.5 Custody invariants

Approval/handover revalidates all LoanItem Assets.

At checkout:

- Asset belongs to current School;
- Asset lifecycle/condition permits loan;
- Asset is not already under active Loan custody;
- Asset is not under incompatible active Maintenance custody;
- linked Device lifecycle does not prohibit allocation;
- rows are locked so concurrent checkout cannot double-allocate.

Checkout does not mutate:

- Asset home Laboratory;
- Device home Laboratory;
- Layout;
- Asset lifecycle;
- Device lifecycle.

Return records condition evidence. Damage does not auto-create Incident. A future explicit action may create/link an Incident with source correlation.

## 7. Preventive Maintenance contract

### 7.1 Purpose

Preventive Maintenance manages scheduled preventive work and execution evidence. Corrective repair remains S5 Work Order.

### 7.2 MaintenancePlan candidate fields

Baseline plan targets one canonical Asset to keep v1 execution identity exact.

```text
MaintenancePlan
  id
  planCode
  assetId
  name
  frequencyKind
  intervalDays?
  checklistTemplate[]
  assignedTechnicianReference?
  assignedTechnicianNameSnapshot?
  nextDueDate
  status
  version
  createdAt
  updatedAt
```

Candidate plan status:

- `active`
- `inactive`

Candidate frequency kinds:

- `weekly`
- `monthly`
- `quarterly`
- `semester`
- `yearly`
- `custom_interval`

A future policy/template abstraction for category-wide plans may be added later, but S4 v1 executions must resolve to exact Asset identity before work starts.

### 7.3 MaintenanceExecution candidate fields

```text
MaintenanceExecution
  id
  maintenancePlanId?
  assetId
  scheduledFor
  startedAt?
  completedAt?
  cancelledAt?
  status
  checklistSnapshot[]
  findings
  actionTaken
  conditionBefore
  conditionAfter?
  technician snapshot
  version
  createdAt
  updatedAt
```

Lifecycle:

```text
scheduled -> in_progress -> completed
scheduled -> cancelled
in_progress -> cancelled   (reason required, if policy permits)
```

Execution creation snapshots checklist content so later plan edits do not rewrite history.

### 7.4 Maintenance custody

During `in_progress`, the Asset is under Maintenance custody and unavailable for new Loan checkout.

Maintenance custody:

- does not change home Laboratory;
- does not move Layout;
- does not rewrite Device lifecycle;
- does not imply Laboratory-wide closure.

### 7.5 Spare-part consumption

Maintenance consumption uses canonical InventoryTransaction.

An execution may request one or more issue movements. Each stock issue:

- validates permission;
- locks the InventoryItem;
- rejects negative result;
- records sourceType = `maintenance_execution`;
- records sourceId = execution ID;
- commits atomically with the application action or fails closed.

MaintenanceExecution does not maintain a second mutable spare-part balance.

## 8. Cross-domain availability projection

S4 may expose derived Asset availability:

```text
available
on_loan
in_maintenance
retired
disposed
blocked_condition
unknown
```

This is a read-model decision, not a writable Asset field.

S4.6 implements the projection as:

```http
GET /api/v1/assets/{assetId}/operational-state
```

The endpoint requires `assets.view`, is exact-School scoped, and returns provenance from Asset lifecycle/condition, active Loan custody, active Maintenance custody, and the same-School linked Device when present.

Deterministic precedence is:

1. integrity contradictions (multiple active custody rows, simultaneous Loan + Maintenance custody, lifecycle + active custody, or linked-Device School mismatch) => `unknown` with an integrity code;
2. `disposed`;
3. `retired`;
4. `on_loan`;
5. `in_maintenance`;
6. non-loanable condition => `blocked_condition`;
7. incompatible linked Device lifecycle => `unknown` with provenance;
8. otherwise => `available`.

A linked Device may add lifecycle-based blocking but telemetry health remains S6 and must not be fabricated.

## 9. Permission contract

### 9.1 Existing Asset keys

Retain current server catalog keys for compatibility:

- `assets.view`
- `assets.create`
- `assets.update`
- `assets.export`

`assets.delete` remains a legacy compatibility permission during migration but does not authorize canonical hard deletion.

New action-specific Asset permissions:

- `assets.link-device`
- `assets.retire`
- `assets.dispose`

### 9.2 Stock

- `stock.view`
- `stock.create`
- `stock.update`
- `stock.transact`
- `stock.export`

### 9.3 Loan

- `loans.view`
- `loans.view-all`
- `loans.create`
- `loans.approve`
- `loans.handover`
- `loans.return`
- `loans.inspect`
- `loans.cancel`
- `loans.export`

### 9.4 Preventive Maintenance

S4.5 refines the accepted capability groups into action-specific server permissions:

- `maintenance.view`
- `maintenance.create-plan`
- `maintenance.update-plan`
- `maintenance.schedule`
- `maintenance.start`
- `maintenance.complete`
- `maintenance.cancel`
- `maintenance.consume-stock`
- `maintenance.export`

Creating a plan also requires `assets.view` because exact Asset selection must not bypass Asset read authority.

No S4 permission grants S5 Work Order authority.

Role grants must be explicit in `RolePermissionSeeder` and covered by tests. SMARTLAB local Super Admin may receive the complete local catalog, but only inside its active SMARTLAB SchoolMembership.

## 10. Candidate API surface

These paths are architectural candidates for implementation slicing. They must **not** be added to the published OpenAPI bundle until the corresponding runtime endpoints exist.

### Asset

```http
GET    /api/v1/assets
POST   /api/v1/assets
GET    /api/v1/assets/{asset}
GET    /api/v1/assets/{asset}/operational-state
PATCH  /api/v1/assets/{asset}
POST   /api/v1/assets/{asset}/device-link
DELETE /api/v1/assets/{asset}/device-link
POST   /api/v1/assets/{asset}/retire
POST   /api/v1/assets/{asset}/dispose
```

### Inventory

```http
GET  /api/v1/stock-items
POST /api/v1/stock-items
GET  /api/v1/stock-items/{item}
PATCH /api/v1/stock-items/{item}
GET  /api/v1/stock-transactions
POST /api/v1/stock-transactions
```

### Loan

```http
GET  /api/v1/loans
POST /api/v1/loans
GET  /api/v1/loans/{loan}
POST /api/v1/loans/{loan}/approve
POST /api/v1/loans/{loan}/reject
POST /api/v1/loans/{loan}/handover
POST /api/v1/loans/{loan}/return
POST /api/v1/loans/{loan}/inspect
POST /api/v1/loans/{loan}/cancel
```

### Preventive Maintenance

```http
GET   /api/v1/maintenance-plans
POST  /api/v1/maintenance-plans
GET   /api/v1/maintenance-plans/{plan}
PATCH /api/v1/maintenance-plans/{plan}
POST  /api/v1/maintenance-plans/{plan}/activate
POST  /api/v1/maintenance-plans/{plan}/deactivate
POST  /api/v1/maintenance-plans/{plan}/executions
GET   /api/v1/maintenance-executions
GET   /api/v1/maintenance-executions/{execution}
POST  /api/v1/maintenance-executions/{execution}/start
POST  /api/v1/maintenance-executions/{execution}/complete
POST  /api/v1/maintenance-executions/{execution}/cancel
```

S4.5 schedules an execution through its exact plan route so the server can snapshot plan/Asset/checklist identity under the current plan version.

The implementation PR may refine transport details without violating semantic invariants. Breaking changes to identity, lifecycle, custody, stock ledger, or authority require explicit contract revision.

## 11. Concurrency and locking

### Asset

- mutable actions require current version;
- link/unlink locks Asset and Device rows in deterministic order;
- disposal/retirement revalidates active custody/dependencies.

### Inventory

- transaction locks InventoryItem row;
- resulting balance checked inside transaction;
- transaction receipt/idempotency unique constraint prevents duplicate retry.

### Loan

- lifecycle action locks Loan;
- approval/handover locks referenced Assets in deterministic ID order;
- checkout revalidates no conflicting custody;
- return/inspection use current Loan version.

### Maintenance

- start locks execution and Asset;
- conflicting active Loan/Maintenance fails closed;
- inventory consumption locks stock items in deterministic ID order;
- completion and condition update occur atomically where coupled.

Deadlock-avoidance ordering must be documented in implementation tests when multiple rows/domains are locked.

## 12. PostgreSQL invariant requirements

Minimum database defenses:

- required School FKs;
- School-scoped unique normalized Asset code;
- School-scoped unique stock item code;
- unique nullable Asset↔Device link;
- positive inventory movement quantity;
- non-negative canonical balance;
- closed lifecycle/status checks where practical;
- version >= 1 checks;
- immutable transaction/event rows protected from normal update/delete service paths;
- same-School relational validation in application services plus FKs where schema permits;
- historical foreign keys use restrict/no destructive cascade.

Application validation alone is not sufficient for invariants that PostgreSQL can safely enforce.

## 13. Audit and event evidence

Material actions require append-oriented evidence.

Asset:

- created;
- metadata/condition changed;
- Device linked/unlinked;
- retired/disposed.

Inventory:

- item created/metadata changed;
- every stock movement is itself immutable business evidence;
- transaction actor/reason/source retained.

Loan:

- submitted;
- approved/rejected;
- handed over;
- returned;
- inspected/closed;
- cancelled.

Maintenance:

- plan created/changed/disabled;
- execution scheduled/started/completed/cancelled;
- condition evidence;
- linked inventory consumption.

Audit snapshots should preserve human-readable context without using display strings as foreign identity.

## 14. Stable error-code direction

Implementation should use domain-specific stable codes, for example:

- `ASSET_NOT_FOUND`
- `ASSET_VERSION_CONFLICT`
- `ASSET_DEVICE_LINK_CONFLICT`
- `ASSET_ACTIVE_CUSTODY_CONFLICT`
- `STOCK_ITEM_NOT_FOUND`
- `STOCK_INSUFFICIENT`
- `STOCK_MUTATION_REUSED`
- `LOAN_NOT_FOUND`
- `LOAN_INVALID_TRANSITION`
- `LOAN_ASSET_UNAVAILABLE`
- `MAINTENANCE_PLAN_NOT_FOUND`
- `MAINTENANCE_EXECUTION_NOT_FOUND`
- `MAINTENANCE_CUSTODY_CONFLICT`

Unknown and cross-tenant IDs must not disclose existence differences.

## 15. Frontend cutover rule

Each route migrates as a complete vertical slice.

After a route is cut over:

- it reads canonical API data only;
- its mutations call canonical endpoints only;
- local AppDB records cannot be merged into the displayed authoritative list;
- local seed IDs are not accepted as backend IDs;
- permission decisions use server permission keys;
- unsupported legacy actions are removed/disabled explicitly rather than emulated locally.

Expected route sequence:

1. `/assets`
2. `/stock`
3. `/loans`
4. `/maintenance`

`/work-orders` remains browser-local/transitional until S5.

## 16. Migration/reconciliation

No automatic S4 browser migration is approved in S4.1.

The future migration tool must classify each record:

- exact safe match;
- unmatched;
- ambiguous;
- invalid;
- blocked by dependency.

Asset→Device matching may use controlled evidence such as canonical codes/serials plus School/Laboratory context, but no single display field is sufficient when duplicates exist.

Stock opening balance must become explicit opening transactions, not a hidden quantity assignment.

Loan historical imports must preserve borrower/item snapshots and must not fabricate canonical Asset identity when the item cannot be reconciled.

Maintenance historical imports must preserve execution evidence and must not fabricate Work Orders/Incidents.

## 17. S4 implementation slicing

### S4.1 — Contract & authority lock

- ADR-002;
- this contract;
- prototype reconciliation;
- no runtime endpoint claim.

### S4.2 — Asset canonicalization

- migrations/models/services/controllers/requests/resources;
- permission catalog changes;
- Asset↔Device link;
- ETag/version/audit;
- `/assets` cutover;
- tests and OpenAPI for implemented endpoints.

### S4.3 — Inventory ledger

- InventoryItem + immutable InventoryTransaction;
- row-lock serialization;
- non-negative database/application invariants;
- retry idempotency;
- `/stock` cutover;
- tests/OpenAPI.

### S4.4 — Loan custody

- Loan/LoanItem;
- exact Asset identity;
- concurrency-safe checkout;
- condition snapshots;
- `/loans` cutover;
- tests/OpenAPI.

### S4.5 — Preventive Maintenance

- plans/executions;
- exact Asset target;
- maintenance custody;
- inventory consumption;
- `/maintenance` cutover;
- tests/OpenAPI.

### S4.6 — S4 reconciliation/UAT

- cross-domain custody projection;
- migration/import policy classification only unless an explicit import approval exists;
- negative-stock race tests on PostgreSQL with independent concurrent workers;
- double-loan race tests;
- maintenance/loan exclusion tests;
- browser UAT with storage-cleared route cutovers and recorded operator evidence;
- aggregate source-of-truth regression for all four S4 routes;
- relative documentation-link CI validation;
- source-of-truth docs update;
- exact merged-head regression.

## 18. S4 exit criteria

S4 is complete only when:

- `/assets`, `/stock`, `/loans`, and `/maintenance` are server-authoritative;
- no S4 business mutation writes AppDataProvider;
- stock cannot become negative under concurrent requests;
- immutable stock history is reconstructable;
- one Asset cannot be checked out twice concurrently;
- Maintenance and Loan custody conflicts fail closed;
- Asset↔Device linkage is exact and one-to-one;
- S5 Work Orders have not been smuggled into S4;
- permissions and tenant isolation are tested server-side;
- historical evidence is append-oriented;
- OpenAPI describes only implemented endpoints;
- full API/web regression is green;
- dedicated PostgreSQL S4 contention proof is green;
- storage-cleared browser UAT for `/assets`, `/stock`, `/loans`, and `/maintenance` has been executed and recorded.
