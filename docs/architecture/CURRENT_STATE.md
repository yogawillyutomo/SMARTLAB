# SmartLab Current Architecture State

**Snapshot date:** 2026-09-05  
**Baseline:** repository state including S2.7 Dated Schedule Exceptions

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
| Published timetable backend | TimetablePublication/TimetableEntry/ScheduleOccurrence persistence, validation, hash replay protection, audit, activation/supersession API |
| Schedule current-plan read model | `GET /schedule-occurrences` + canonical `/schedules` frontend preserving TESSELA planned fields and applying active dated operational overlays |
| Operational Calendar / Closure | server-authoritative school/laboratory calendar events with explicit availability effect, versioning, audit, and cancellation |
| Unified Laboratory Availability | explainable read model combining Laboratory status, active TESSELA ScheduleOccurrences, schedule coverage, Operational Calendar blockers, and submitted/approved reservations |
| Laboratory Reservations | PostgreSQL reservation lifecycle with serialized availability checks, approval re-check, ETag versioning, audit timeline, and canonical `/bookings` frontend |
| Dated Schedule Exceptions | immutable occurrence overlay for one-date cancel/relocate, availability integration, safe restoration, versioning, and audit |
| Dashboard supported metrics | Laboratory, Device, and Incident APIs |

## Transitional

These routes/domains still rely wholly or materially on browser-local repositories, seed data, compatibility state, or incomplete server slices.

- laboratory sessions/execution;
- journals;
- monitoring telemetry;
- fixed assets;
- stock/spare parts;
- work orders;
- preventive maintenance;
- loans/custody;
- notifications;
- reports/analytics;
- audit-log query UI;
- tenant settings;
- some global search/topbar/cross-domain summaries.

`AppDataProvider` remains a transitional application-lifecycle dependency while these domains exist. Its presence must not be interpreted as authority for already-canonical data.

## Planned next

The Master Data ↔ TESSELA ↔ SmartLab boundary is locked by [ADR-001](./ADR-001-master-data-tessela-smartlab-scheduling-boundary.md), and the S2.1 semantic model is locked by [Published Timetable and Schedule Occurrence Contract](./published-timetable-contract.md).

1. S2.8: priority events, timetable-publication impact/reconciliation, and integration UAT.
3. Phase S3: Laboratory Session + Journal.
4. Phase S4: Assets, Inventory, Loans, Preventive Maintenance.
5. Phase S5: Corrective Work Orders.
6. Phase S6: PC monitoring telemetry.
7. Phase S7: Notifications, Reporting, final Dashboard/global search.
8. Phase S8: remove browser-local business persistence and compatibility layers.

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
- S2.1 further locks full School+Semester snapshot semantics, immutable TimetableEntry rows, materialized ScheduleOccurrence IDs, hash-based idempotency, and one active publication per School+Semester.
- S2.2 implements that contract in Laravel/PostgreSQL with server permissions, tenant isolation, append-oriented audit, validation/rejection, occurrence materialization, replay protection, and atomic activation/supersession.
- S2.3 exposes bounded current-plan occurrence queries and cuts `/schedules` over to server authority; structural CRUD actions are removed from the SmartLab schedule UI.
- S2.4 makes Operational Calendar/Closure canonical: school/laboratory scope, informational/blocked effect, all-day or single-day partial closures, ETag updates, append-oriented audit, and cancel-without-delete semantics.
- S2.5 adds fail-closed Unified Laboratory Availability: exact-window half-open overlap, explainable blockers/notices, and schedule coverage that never treats missing TESSELA data as free capacity.
- S2.6 makes Laboratory Reservations canonical: submitted/approved reservations block availability, Laboratory-row locking serializes competing mutations, approval re-checks current availability, requester identity is session-derived, and `/bookings` no longer reads browser-local state.
- S2.7 makes dated Schedule Exceptions canonical: only one-date cancel/relocate is supported; source occurrences remain immutable; relocation uses the same availability engine; exception cancellation fails closed if restoring the source plan would conflict.

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
