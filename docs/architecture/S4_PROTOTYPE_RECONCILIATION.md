# S4 Prototype Reconciliation Audit

**Audit date:** 2026-09-06  
**Baseline:** `main@f00a492f1d5ce4293e2483b33004901ea7c3cb17`  
**Scope:** browser-local Asset / Stock / Loan / Preventive Maintenance / Work Order prototypes versus S4 target authority

## Evidence inspected

- `apps/web/src/pages/AssetsPage.tsx`
- `apps/web/src/pages/StockPage.tsx`
- `apps/web/src/pages/LoansPage.tsx`
- `apps/web/src/pages/MaintenancePage.tsx`
- `apps/web/src/pages/WorkOrdersPage.tsx`
- `apps/web/src/types/index.ts`
- `docs/architecture/MANAGED_DEVICE_INVENTORY_FOUNDATION.md`
- `docs/architecture/device-domain-contract.md`
- server Permission/Role seeders
- current source-of-truth migration docs

## Reconciliation matrix

| Prototype concept | Current local behavior | Canonical S4 decision | Migration treatment |
| --- | --- | --- | --- |
| Asset ID | browser/local string | server ULID | never trust local ID as server identity |
| Asset code | editable for unlinked local Asset | School-scoped normalized human code; ordinary canonical edit does not silently rewrite identity | map only with controlled uniqueness checks |
| Asset Laboratory | mutable and may imply location | home/responsibility only; live custody/location derived | reconcile against canonical Laboratory; no name-only match |
| Asset status | mixes active, loan, maintenance, damage, lost, disposed | split lifecycle, condition, custody, derived availability | transform explicitly; never copy enum blindly |
| Asset condition | useful physical evidence | canonical condition dimension | map via controlled value table |
| Device.assetId local | optional one-to-one intent | explicit canonical Asset↔Device relation | no local ID carry-over; reconcile exact server Device |
| Stock quantity | direct mutable field | server-maintained balance derived/maintained through immutable transactions | imported quantity becomes explicit opening transaction |
| Stock adjustment | browser `adjust` semantics weak | explicit adjustment-in/out with reason | convert with signed evidence |
| Stock negative guard | frontend check + Math.max | server transaction + row lock + DB-safe non-negative invariant | frontend check remains UX only |
| Stock retry | can duplicate browser action | stable mutation ID/idempotent server receipt | new canonical mutation identity |
| Loan item | free-text name + quantity | one LoanItem per canonical Asset | unmatched historical text remains unresolved evidence, not fabricated link |
| Loan overdue | stored status possible | derived from checked-out + due date | recalculate |
| Loan return damage | can directly create local Incident | explicit later Incident creation/link only | preserve return finding; no auto-create |
| Maintenance target | free-text assetCode/category | exact canonical Asset at execution time | reconcile or mark unresolved |
| Maintenance checklist | mutable plan array | execution snapshots checklist | preserve historical snapshot |
| Maintenance spare parts | local list/direct mutations possible | canonical InventoryTransaction source=maintenance_execution | import as evidence only unless reconciled |
| Work Order | browser-local corrective workflow | S5 authority | do not migrate/cut over in S4 |
| Work Order stock use | direct local decrement | future S5 uses S4 Inventory transaction service | no direct stock write |
| Device health after repair | local Work Order can set Online | S6 telemetry/Device subsystem decides health | never copy this side effect into S4 |
| Platform Superadmin | not a row-scope source | no implicit SMARTLAB tenant access | active SMARTLAB membership required |

## Permission drift

Server catalog already has:

- `assets.*`
- `work-orders.*`

Server catalog does **not** yet contain canonical:

- `stock.*`
- `loans.*`
- `maintenance.*`

Frontend compatibility permission matrices include those modules locally. Therefore route cutover must not reuse frontend role matrices as server authority. S4 implementation must add exact server permissions and role grants with tests.

## Existing boundary worth preserving

The managed-device foundation already established useful rules:

- Device ≠ Asset ≠ LayoutElement;
- one-to-one Device/Asset relation intent;
- linked Asset identity/location changes must not drift away from Device;
- Device technical profile is not Asset procurement data;
- QR belongs to Device identity, not Asset identity;
- local migration fails closed on ambiguous Asset linking.

S4 canonicalization should preserve those semantics while replacing browser IDs/storage with Laravel/PostgreSQL authority.

## High-risk prototype behaviors

### 1. Direct stock mutation

The local stock page checks quantity before decrementing, but two browser/server requests could race in a real multi-user system. Canonical S4 must serialize on the InventoryItem row and reject a transaction that would result in negative stock.

### 2. Loan free-text identity

`itemName + quantity` is not enough to prove custody of a particular durable unit. Canonical LoanItem must reference stable Asset identity.

### 3. Mixed Asset status

`Dipinjam` and `Maintenance` are temporary custody states, while `Rusak` is condition and `Dihapuskan` is disposition. Persisting all of them in one enum would create contradictory states and duplicate Loan/Maintenance authority.

### 4. Work Order side effects

The local Work Order page can consume stock and update Asset/Device state. Those effects are prototype UX only. S5 must call canonical S4 services and must not mutate S4 tables through browser state.

### 5. Automatic Incident creation

Loan return currently offers local Incident creation. Canonical behavior must be explicit, permission-checked, tenant-scoped, and idempotent. Damage evidence can be recorded without forcing an Incident.

## Contract conclusion

The prototype is valuable as UX/workflow evidence but cannot be lifted into Laravel as-is.

S4 runtime work is safe to begin only after:

1. ADR-002 is accepted;
2. the S4 domain contract is accepted;
3. implementation starts with Asset rather than attempting all four domains in one PR;
4. Work Order remains S5;
5. every route cutover removes local authority for that route instead of combining local and server datasets.
