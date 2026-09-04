# SmartLab Current Architecture State

**Snapshot date:** 2026-09-05  
**Baseline:** `main@82f2b0bc0c6530aeabedb781c38cc12d1b53894a`

This document is the concise operational snapshot for contributors. It complements the longer product specification and source-of-truth migration roadmap.

## Canonical

These areas are backed by Laravel/PostgreSQL or the server authorization/session boundary and should not fall back to browser seed data as operational truth.

| Area | Current authority |
| --- | --- |
| Authentication / active membership | Laravel session + Sanctum |
| Laboratories | Laboratory API |
| Managed devices | Device API |
| Device transfers | Device Transfer API |
| Laboratory layouts | Layout API |
| Incidents | Incident API and event/history workflow |
| Users / school memberships | Identity Administration API |
| Role/permission catalog | Server catalog; UI currently read-only for catalog editing |
| Academic master | Academic Master API with stable IDs |
| Dashboard supported metrics | Laboratory, Device, and Incident APIs |

## Transitional

These routes/domains still rely wholly or materially on browser-local repositories, seed data, compatibility state, or incomplete server slices.

- regular schedules;
- laboratory reservations;
- laboratory sessions/execution;
- journals;
- monitoring telemetry;
- fixed assets;
- stock/spare parts;
- work orders;
- preventive maintenance;
- loans/custody;
- academic calendar/closures;
- notifications;
- reports/analytics;
- audit-log query UI;
- tenant settings;
- some global search/topbar/cross-domain summaries.

`AppDataProvider` remains a transitional application-lifecycle dependency while these domains exist. Its presence must not be interpreted as authority for already-canonical data.

## Planned next

The Master Data ↔ TESSELA ↔ SmartLab scheduling boundary is now locked by [ADR-001](./ADR-001-master-data-tessela-smartlab-scheduling-boundary.md).

1. Phase S2: Scheduling & Availability.
2. Phase S3: Laboratory Session + Journal.
3. Phase S4: Assets, Inventory, Loans, Preventive Maintenance.
4. Phase S5: Corrective Work Orders.
5. Phase S6: PC monitoring telemetry.
6. Phase S7: Notifications, Reporting, final Dashboard/global search.
7. Phase S8: remove browser-local business persistence and compatibility layers.

## Reserved / placeholder

### PC Agent

`services/pc-agent` currently contains documentation only. No Go module/service has been implemented.

Approved future telemetry is limited to device identity, heartbeat, CPU, RAM, disk, network, uptime, OS/hardware inventory. Keylogging, screenshots, browser history, documents, and user-content collection are prohibited.

### Infrastructure

`infrastructure/docker`, `infrastructure/nginx`, and `infrastructure/deployment` are placeholders. Production container topology, reverse proxy, queue/Redis operations, backup/restore, rollback, observability, and deployment hardening remain future work.

## Locked scheduling ownership boundary

[ADR-001](./ADR-001-master-data-tessela-smartlab-scheduling-boundary.md) is accepted.

The locked target boundary is:

- BP Master Data: cross-product academic reference authority;
- TESSELA: sole timetable-generation / constraint-solving authority;
- SmartLab: Laboratory authority plus operational availability, reservations, dated exceptions, sessions, and journals;
- SmartLab does not implement a TESSELA-equivalent solver;
- TESSELA may publish a planned Laboratory reference, while SmartLab owns date-specific operational relocation/closure;
- the existing SmartLab Academic Master implementation is preserved and may become a synchronized projection/adapter when shared BP Master Data is introduced;
- published timetable versions are immutable and activated atomically after validation.

## Validation contract

Frontend validation:

```bash
cd apps/web
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

API validation is defined by GitHub CI and includes Composer validation, PostgreSQL migration/seeder validation, and the portable Laravel test suite.

Repository-wide helper scripts must not omit frontend tests.
