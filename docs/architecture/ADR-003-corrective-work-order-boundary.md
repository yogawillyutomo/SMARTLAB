# ADR-003 — Corrective Work Order Boundary

**Status:** Accepted — S5.1 authority lock merged in PR #85; S5.2+ runtime must preserve this boundary  
**Date:** 2026-09-07  
**Decision scope:** SMARTLAB Corrective Work Order authority and its boundaries with Incident, Asset, Device, Inventory, Loan, Preventive Maintenance, and Laboratory availability.

## Context

S4 closed the canonical Asset, Inventory, Loan, and Preventive Maintenance domains. Incident is already canonical and explicitly excludes repair execution, spare-part waiting, repair cost, and Work Order lifecycle.

The browser-local Work Order prototype has useful UX signals — assignment, diagnosis, repair action, waiting for parts, spare-part usage, completion, and verification — but it also contains authority violations that must not be promoted:

- free-text Asset identity;
- local Work Order and stock IDs;
- direct browser stock decrement;
- mutable browser cost;
- automatic Asset condition/lifecycle reset;
- automatic Device Online mutation;
- a single Incident -> Work Order relationship;
- browser-local status/timeline authority.

S5 therefore begins with an explicit authority lock.

## Decision

### Work Order owns corrective execution

A Work Order is the canonical aggregate for **corrective** repair work. It owns:

- Work Order identity and number;
- one exact canonical Asset target;
- optional link to one canonical Incident;
- Laboratory handling context;
- repair priority and schedule intent;
- technician assignment snapshots;
- diagnosis, action, test/result evidence;
- corrective lifecycle and custody;
- immutable part-usage evidence;
- append-oriented Work Order history;
- optimistic-concurrency version.

It does **not** own Incident lifecycle, Inventory balance, Asset lifecycle, Device lifecycle/telemetry, Preventive Maintenance, or whole-Laboratory availability.

### One Work Order = one exact Asset

S5 v1 requires one exact School-scoped Asset per Work Order.

It never targets a free-text Asset code, ambiguous quantity, whole Laboratory, or unbound Device as its sole repair subject.

If a linked Incident references a Device, the selected Work Order Asset must be canonically linked to that same Device. If no canonical Asset exists, the server must not infer identity.

One Incident may have **zero to many** Work Orders. A Work Order may exist without an Incident.

### Corrective custody is separate

Corrective custody starts at `in_progress` and remains active through `on_hold`, `waiting_part`, and `completed`.

It releases only on successful `verified` or valid cancellation.

While corrective custody is active, the exact Asset is unavailable for:

- Loan checkout;
- Preventive Maintenance start;
- another Work Order start;
- Asset retire/dispose;
- unsafe Device unlink.

Corrective custody does not mutate Asset/Device home Laboratory, Layout, Asset lifecycle, or Device lifecycle.

### Asset condition remains Asset authority

Work Order start snapshots Asset condition/version.

Technician completion records proposed `conditionAfter` evidence but does not mutate Asset.

Managerial verification applies the verified condition **through Asset authority**, appends Asset audit evidence referencing the Work Order, releases corrective custody, and commits atomically.

### Device state is never inferred

Verification does not set Device online, alter Device lifecycle, move Device, or fabricate telemetry.

### Spare parts remain Inventory authority

Part consumption uses immutable `InventoryTransaction` issue movements with:

- `sourceType = work_order`;
- `sourceId = WorkOrder.id`.

Work Order stores immutable usage evidence linked to that InventoryTransaction. Waiting for a part does not reserve or decrement stock.

A new product-local `work-orders.consume-stock` permission lets technicians consume repair parts without broad `stock.transact` authority.

### Incident remains independent

Work Order transitions never automatically resolve, verify, close, or rewrite Incident.

Incident staff explicitly review repair evidence and perform Incident lifecycle actions.

### Laboratory-wide unavailability remains availability authority

A Work Order is exact-Asset corrective work. It never implicitly closes a Laboratory.

If repair requires Lab shutdown, an explicit Operational Calendar / Unified Availability blocker is required.

## Consequences

S5 must extend the derived Asset operational state with `in_repair`, integrate Work Order custody into Loan/Maintenance/Asset guards, and add real PostgreSQL contention proofs.

The browser-local Work Order prototype cannot remain business authority after cutover.

## Deferred

S5.1 intentionally defers:

- repair accounting/finance;
- labor billing;
- vendor procurement;
- warranty claims;
- multi-Asset Work Orders;
- whole-Laboratory repair campaigns;
- automatic Incident closure;
- automatic Device telemetry/lifecycle mutation.

## Related contracts

- [S5 Corrective Work Order Domain Contract](work-order-domain-contract.md)
- [Incident Domain Contract](incident-domain-contract.md)
- [S4 Asset, Inventory, Loan, and Preventive Maintenance Contract](asset-inventory-loan-maintenance-contract.md)
- [ADR-002](ADR-002-asset-inventory-loan-maintenance-boundary.md)
- [Unified Laboratory Availability Contract](unified-laboratory-availability-contract.md)
