# S5 Corrective Work Order Domain Contract

**Status:** Accepted / locked — merged in PR #85; S5.2 implementation must conform and S5.3/S5.4 remain separately gated  
**Date:** 2026-09-07  
**Authority:** governed by [ADR-003](ADR-003-corrective-work-order-boundary.md)

## 1. Purpose

This contract defines canonical SMARTLAB Corrective Work Order semantics before migrations, API implementation, or frontend cutover.

Corrective Work Order is separate from Incident, Preventive Maintenance, Inventory balance, Asset identity/lifecycle, Device state, and Laboratory-wide availability.

## 2. Prototype disposition

Keep as product intent:

- Work Order number;
- exact repair subject;
- priority and schedule intent;
- technician assignment;
- diagnosis and action;
- on-hold / waiting-part states;
- spare-part usage;
- completion and verification;
- timeline.

Reject as canonical architecture:

- free-text `assetCode` identity;
- one `incident.workOrderId`;
- display-name technician identity;
- direct browser stock decrement;
- fabricated local stock transactions;
- mutable browser `cost` as finance authority;
- automatic Asset condition/lifecycle reset;
- automatic Device Online mutation;
- browser-local status/timeline authority;
- hard delete.

## 3. Aggregate model

### WorkOrder

```text
WorkOrder
  id
  schoolId
  workOrderNumber

  incidentId?
  incidentTicketSnapshot?

  assetId
  assetCodeSnapshot
  assetNameSnapshot

  laboratoryId
  laboratoryCodeSnapshot
  laboratoryNameSnapshot

  problemSummary
  priority
  scheduledFor?

  status

  assigneeMembershipId?
  assigneeUserIdSnapshot?
  assigneeMembershipIdSnapshot?
  assigneeNameSnapshot?

  diagnosis?
  actionTaken?
  testResult?

  conditionBefore?
  conditionAfter?
  assetVersionAtStart?

  custodyActive

  startedAt?
  completedAt?
  verifiedAt?
  cancelledAt?

  version
  createdAt
  updatedAt
```

### WorkOrderPartUsage

```text
WorkOrderPartUsage
  id
  schoolId
  workOrderId
  inventoryTransactionId
  inventoryItemId
  clientMutationId
  itemCodeSnapshot
  itemNameSnapshot
  unitSnapshot
  quantity
  actorUserIdSnapshot
  actorMembershipIdSnapshot
  actorNameSnapshot
  usedAt
  createdAt
```

Rules:

- `inventoryTransactionId` is unique;
- usage rows are immutable;
- InventoryTransaction remains quantity/balance authority.

### WorkOrderEvent

Meaningful commits append one typed event.

Candidate types:

- `work_order.created`
- `work_order.updated`
- `work_order.assigned`
- `work_order.reassigned`
- `work_order.started`
- `work_order.held`
- `work_order.waiting_part`
- `work_order.resumed`
- `work_order.part_issued`
- `work_order.completed`
- `work_order.rework_requested`
- `work_order.verified`
- `work_order.cancelled`

## 4. Tenant and identity rules

Every Work Order:

- belongs to exactly one School;
- targets exactly one canonical same-School Asset;
- has one active same-School Laboratory handling context at creation;
- may link to zero or one same-School Incident;
- never accepts caller-owned School authority.

Unknown, cross-School, or invisible Work Order IDs return the same not-found contract.

Platform Super Admin has no implicit SMARTLAB row access. Active SMARTLAB SchoolMembership and product-local permissions remain mandatory.

### Row visibility

`work-orders.view` grants visibility to Work Orders in the actor's active School. S5 v1 does not introduce a second `work-orders.view-all` concept because Work Orders are an internal operational board rather than reporter-owned records.

Every list/detail/history query still starts with exact `school_id = currentSchoolId`; no action permission expands tenant scope.

## 5. Exact Asset subject

The Asset must exist in current School, be active at create, and be selected by canonical ULID.

Create requires `work-orders.create` plus `assets.view` for exact Asset discovery. The selected handling Laboratory requires `laboratories.view`. If `incidentId` is provided, `incidents.view` and normal Incident row visibility are additionally required.

Asset target is immutable after create. Wrong-subject recovery is cancel + create a correct Work Order.

If `incidentId` is supplied:

- caller needs `incidents.view` plus normal Incident row visibility;
- Incident must be same-School and not rejected/closed;
- Incident ticket is snapshotted;
- if Incident references a Device, Work Order Asset must be linked to that Device.

Incident Laboratory is historical reporting context and does not assert Asset location.

## 6. Lifecycle

Statuses:

```text
draft
assigned
in_progress
on_hold
waiting_part
completed
verified
cancelled
```

`verified` and `cancelled` are terminal.

| From | To | Permission | Rule |
| --- | --- | --- | --- |
| create | draft | `work-orders.create` | exact Asset + active Lab |
| draft | assigned | `work-orders.assign` | eligible assignee |
| draft | cancelled | assign or approve | reason |
| assigned | in_progress | `work-orders.update` | assignee or assign override |
| assigned | cancelled | assign or approve | reason |
| in_progress | on_hold | `work-orders.update` | assignee/override + reason |
| in_progress | waiting_part | `work-orders.update` | assignee/override + reason |
| in_progress | completed | `work-orders.update` | completion evidence |
| on_hold | in_progress | `work-orders.update` | assignee/override |
| on_hold | waiting_part | `work-orders.update` | assignee/override + reason |
| on_hold | cancelled | assign or approve | reason |
| waiting_part | in_progress | `work-orders.update` | assignee/override |
| waiting_part | cancelled | assign or approve | reason |
| completed | verified | `work-orders.approve` | Asset apply + custody release |
| completed | in_progress | `work-orders.approve` | rework reason |

No other edge exists.

### Completion

`in_progress -> completed` requires:

- diagnosis;
- actionTaken;
- conditionAfter;
- optional testResult.

Completion does not release custody, mutate Asset, mutate Device, or mutate Incident.

### Verification

Verification:

1. locks/revalidates Work Order and Asset;
2. fails closed on incompatible Asset state/version drift;
3. applies `conditionAfter` through Asset authority;
4. appends `asset.work_order_condition_updated`;
5. releases corrective custody;
6. appends `work_order.verified`;
7. commits atomically.

No partial mutation is allowed.

### Rework

`completed -> in_progress` requires `work-orders.approve` and an explicit reason.

Rework:

- keeps corrective custody active;
- does not mutate Asset or Incident;
- clears the current root `completedAt`, `conditionAfter`, and `testResult` completion-finalization fields;
- may retain diagnosis/action text as editable working context;
- preserves the prior completed evidence permanently in `WorkOrderEvent`.

A later completion produces a new completion event and fresh proposed condition evidence.

### Cancellation

Cancellation always requires a reason and never erases prior repair/part evidence.

If cancellation occurs while corrective custody is active, custody is released atomically. Any previously issued InventoryTransaction remains immutable; cancellation does not automatically return, delete, or compensate used parts. A stock correction, if genuinely required, must be an explicit compensating Inventory operation with its own reason/evidence.

Cancellation never mutates Incident, Device state, or Asset condition.

## 7. Assignment

Assignment targets one active same-School membership whose active User has effective `work-orders.update`.

Current assignment keeps nullable live FKs plus immutable assignee snapshots.

Technician progress requires `work-orders.update` and current-assignee ownership, unless the actor also has `work-orders.assign`.

If the live assignee membership/User becomes inactive or loses effective `work-orders.update`, assignee-owned progress fails closed until an authorized actor reassigns the Work Order. Snapshot identity remains historical evidence.

Reassignment requires `work-orders.assign`; prior assignment evidence remains immutable.

## 8. Corrective custody

`custodyActive = true` exactly for:

- `in_progress`;
- `on_hold`;
- `waiting_part`;
- `completed`.

Draft/assigned do not reserve Asset.

Start fails closed when Asset:

- is not active;
- has active Loan custody;
- has active Preventive Maintenance custody;
- has another active Work Order custody;
- has incompatible linked Device evidence.

Start snapshots condition/version and relevant linked Device evidence.

While custody is active:

- Loan checkout fails;
- Preventive Maintenance start fails;
- another Work Order start fails;
- Asset retire/dispose fails;
- unsafe Device unlink fails.

## 9. Asset operational state

S5 extends the derived projection with:

```text
in_repair
```

Provenance adds active Work Order custody.

Contradictions remain `unknown`, including multiple repair custodies or repair custody combined with Loan/Maintenance/terminal lifecycle.

No writable availability field is added.

## 10. Spare parts

Part issue is allowed only while `in_progress`.

Required authority:

- `work-orders.update`;
- assignee/assign-override rule;
- `work-orders.consume-stock`;
- `stock.view` for normal discovery.

The command:

1. locks/revalidates Work Order;
2. validates `If-Match`;
3. validates corrective custody;
4. issues immutable InventoryTransaction with stable `clientMutationId`;
5. binds `sourceType=work_order`, `sourceId=workOrderId`;
6. creates immutable WorkOrderPartUsage;
7. increments Work Order version once;
8. appends `work_order.part_issued`;
9. commits atomically.

Insufficient stock rolls everything back. Exact replay must not double-decrement or duplicate usage.

### Waiting Part

`waiting_part`:

- keeps corrective custody;
- records reason/evidence;
- does not reserve stock;
- does not decrement stock;
- does not mutate Incident.

Resume to `in_progress` before using the arrived part.

Cancellation after one or more part issues does not reverse those immutable issues automatically.

## 11. Asset and Device authority

Work Order may store condition evidence but never becomes Asset authority.

```text
start
  -> snapshot condition/version

completed
  -> proposed conditionAfter only

verified
  -> Asset authority applies conditionAfter
  -> AssetChangeEvent
  -> custody release
```

Verification never changes:

- Asset lifecycle;
- Asset home Laboratory;
- Device lifecycle;
- Device home Laboratory;
- Layout;
- Device Online/offline state.

## 12. Incident integration

Incident owns report, triage, assignment, verification, and closure.

Work Order owns corrective execution.

Work Order creation from Incident is explicit. No Work Order action automatically changes Incident status.

One Incident can have zero to many Work Orders.

## 13. Laboratory availability

Work Order handling Laboratory is contextual evidence, not occupancy or blocker authority.

Whole-Lab shutdown must use Operational Calendar / Unified Availability explicitly.

## 14. Permissions

Existing:

- `work-orders.view`
- `work-orders.create`
- `work-orders.update`
- `work-orders.approve`
- `work-orders.assign`
- `work-orders.export`

New S5 permission:

- `work-orders.consume-stock`

Candidate role intent:

- Admin Lab: view/create/update/assign/consume-stock/export;
- Kepala Lab: view/approve/export;
- Teknisi: view/update/consume-stock;
- Super Admin: explicit grants only and still requires active SMARTLAB SchoolMembership.

`work-orders.approve` authorizes the Work Order-specific verified-condition application through internal Asset authority; callers do not also need broad `assets.update` merely to verify a repair. This mirrors the rule that domain-specific actions may invoke another aggregate's guarded internal service without granting arbitrary mutation permission.

No role-name checks or wildcard fallback.

## 15. Candidate API

Contract only; not implemented in S5.1.

```text
GET   /api/v1/work-orders
POST  /api/v1/work-orders
GET   /api/v1/work-orders/{workOrder}
PATCH /api/v1/work-orders/{workOrder}
GET   /api/v1/work-orders/{workOrder}/history

POST  /api/v1/work-orders/{workOrder}/assign
POST  /api/v1/work-orders/{workOrder}/start
POST  /api/v1/work-orders/{workOrder}/hold
POST  /api/v1/work-orders/{workOrder}/waiting-part
POST  /api/v1/work-orders/{workOrder}/resume
POST  /api/v1/work-orders/{workOrder}/parts
POST  /api/v1/work-orders/{workOrder}/complete
POST  /api/v1/work-orders/{workOrder}/verify
POST  /api/v1/work-orders/{workOrder}/rework
POST  /api/v1/work-orders/{workOrder}/cancel
```

PATCH is limited to draft non-identity metadata: problem summary, priority, schedule intent, notes. It cannot change Asset, Incident, status, assignment, custody, completion evidence, or version.

## 16. Optimistic concurrency and contention

Every Work Order has positive integer `version`.

Every post-create mutation requires strong:

```http
If-Match: "<version>"
```

Required PostgreSQL race proofs:

1. Work Order start vs Loan checkout -> exactly one custody;
2. Work Order start vs Preventive Maintenance start -> exactly one custody;
3. two Work Orders start -> at most one corrective custody;
4. part issue contention never drives stock negative;
5. verify vs conflicting Asset mutation fails without partial commit.

## 17. Database invariants

Candidate constraints:

- School-scoped unique Work Order number;
- exact Asset/Incident/Laboratory FKs;
- valid status;
- positive version;
- immutable exact Asset target;
- at most one active corrective-custody Work Order per Asset inside Work Order table;
- immutable WorkOrderPartUsage;
- unique linked InventoryTransaction per usage;
- append-only WorkOrderEvent evidence;
- no hard delete.

Cross-table custody exclusion remains transactional under deterministic locks because a single index cannot span Loan, Maintenance, and Work Order tables.

## 18. Numbering

Candidate human number:

```text
WO-YYYY-000001
```

Generated server-side, School-scoped, yearly, transaction-safe, immutable, and never based on row count.

ULID remains canonical internal identity.

## 19. Error candidates

- `WORK_ORDER_NOT_FOUND`
- `WORK_ORDER_VERSION_CONFLICT`
- `WORK_ORDER_INVALID_TRANSITION`
- `WORK_ORDER_ASSET_INELIGIBLE`
- `WORK_ORDER_ACTIVE_CUSTODY_CONFLICT`
- `WORK_ORDER_INCIDENT_INELIGIBLE`
- `WORK_ORDER_INCIDENT_SUBJECT_MISMATCH`
- `WORK_ORDER_ASSIGNEE_INELIGIBLE`
- `WORK_ORDER_COMPLETION_EVIDENCE_REQUIRED`
- `WORK_ORDER_ASSET_VERSION_DRIFT`

Inventory errors remain Inventory authority.

## 20. Cost/finance

The prototype mutable `cost` is not promoted as canonical accounting.

S5.1 defers labor billing, vendor invoices, warranty finance, and repair accounting. Part quantity/evidence remains auditable through Inventory linkage.

## 21. Frontend cutover

Until S5 runtime exists, `/work-orders` remains transitional/browser-local and must not be presented as canonical server evidence.

Cutover requires backend authority, permission updates, custody integrations, OpenAPI parity, source-of-truth tests, and storage-cleared browser UAT.

## 22. Delivery slices

### S5.1 — Contract lock
ADR-003 + this contract + roadmap reconciliation. No runtime authority.

### S5.2 — Core + corrective custody
Migrations/models/events, numbering, ETag lifecycle, assignment, exact Asset, custody exclusion, `in_repair`, concurrency tests, OpenAPI.

### S5.3 — Inventory + verification integration
`work-orders.consume-stock`, WorkOrderPartUsage, sourced Inventory issue, Asset condition application, Incident-link evidence, atomic verification.

### S5.4 — Frontend cutover + UAT
Canonical `/work-orders`, remove browser mutations, server permissions, storage-cleared UAT, exact-head/merged-head verification.

## 23. Acceptance invariants

S5 cannot close unless tests prove:

- tenant isolation and active SchoolMembership;
- no Platform Super Admin implicit row access;
- exact Asset only;
- one Incident -> 0..N Work Orders;
- Work Order never rewrites Incident;
- corrective custody excludes Loan/PM/other corrective custody;
- active corrective custody blocks unsafe Asset terminal/unlink actions;
- `waiting_part` keeps custody but does not mutate stock;
- part use goes only through immutable InventoryTransaction;
- stock never negative;
- verification uses Asset authority;
- no automatic Device mutation;
- no whole-Lab blocking side effect;
- no browser-local Work Order authority after cutover;
- no hard delete/history rewrite.
