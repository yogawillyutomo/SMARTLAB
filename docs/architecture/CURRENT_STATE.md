# SmartLab Current Architecture State

**Snapshot date:** 2026-09-10  
**Baseline:** `main@276326946bd4d4b9c6cf7073058886a893279e52`. S5 is closed: PR #88 squash-merged as `3d455868ebe61e910655897fd7803cc1ca25ffcc`, PR #89 squash-merged as `276326946bd4d4b9c6cf7073058886a893279e52`, and post-merge GitHub Actions CI #341 plus Vercel are green. S5.6 Asset QR Identity & Label Batch is the active development tranche before S6 telemetry.

This document is the concise operational snapshot for contributors. It complements the longer product specification and source-of-truth migration roadmap.

## Canonical

These areas are backed by Laravel/PostgreSQL or the server authorization/session boundary and should not fall back to browser seed data as operational truth.

| Area | Current authority |
| --- | --- |
| Authentication / active membership | Laravel session + Sanctum |
| Laboratories | Laboratory API |
| Managed devices | Device API |
| Fixed Assets | tenant-scoped Asset API with immutable School-scoped asset code, separated condition/lifecycle, exact optional 1:1 Device linkage, ETag concurrency, and append-oriented change events; linked Asset terminal lifecycle remains fail-closed until a coordinated Device terminal-lifecycle workflow exists |
| Inventory / stock | **S4.3 merged / canonical:** tenant-scoped InventoryItem metadata plus immutable InventoryTransaction movements, 3-decimal quantity precision, serialized row-lock balance updates, non-negative DB/application guards, stable clientMutationId replay semantics, and server-authoritative `/stock`; merged as PR #80 / `1a34dc23` with exact merged-head CI green |
| Loan / custody | **S4.4 merged / canonical:** one LoanItem references one exact School-scoped Asset; lifecycle is versioned and action-specific; checkout revalidates and locks Assets, active custody has a DB uniqueness guard, condition evidence is protected, overdue is derived, return does not mutate Asset/Device authority or auto-create Incident, and `/loans` is server-authoritative; merged as PR #81 / `f85f2edf` with exact merged-head CI green |
| Preventive Maintenance | **S4.5 merged / canonical:** MaintenancePlan and MaintenanceExecution bind one exact School-scoped Asset; plan/execution versions use ETag preconditions; `in_progress` owns Maintenance custody; Loan and Maintenance block each other under Asset locks; completion records checklist/condition evidence, updates Asset condition through Asset audit authority, consumes spare parts only through immutable Inventory `issue` transactions, advances next due date atomically, and `/maintenance` is server-authoritative; merged as PR #82 / `e3da257c` with exact merged-head CI green |
| Asset operational state | **S4.6 merged / canonical:** read-only `GET /assets/{assetId}/operational-state` derives `available`, `on_loan`, `in_maintenance`, `retired`, `disposed`, `blocked_condition`, or fail-closed `unknown` from canonical Asset/Loan/Maintenance/Device evidence with provenance; no writable availability field is introduced; merged as PR #83 / `3757e986` with browser UAT recorded and exact merged-head CI green |
| Device transfers | Device Transfer API |
| Laboratory layouts | Layout API |
| Incidents | Incident API and event/history workflow |
| Users / school memberships | Identity Administration API |
| Role/permission catalog | Server catalog; UI currently read-only for catalog editing |
| Academic master | Academic Master API with stable IDs |
| Published timetable backend | TimetablePublication/TimetableEntry/ScheduleOccurrence persistence, validation, hash replay protection, audit, activation/supersession API |
| Schedule current-plan read model | `GET /schedule-occurrences` + canonical `/schedules` frontend preserving TESSELA planned fields and applying active dated operational overlays |
| Operational Calendar / Closure | server-authoritative school/laboratory calendar events with explicit availability effect, versioning, audit, and cancellation |
| Unified Laboratory Availability | explainable read model combining Laboratory status, active TESSELA ScheduleOccurrences, dated exceptions, schedule coverage, Operational Calendar blockers, submitted/approved reservations, approved Priority Events, and actual in-progress Laboratory Sessions |
| Laboratory Reservations | PostgreSQL reservation lifecycle with serialized availability checks, approval re-check, ETag versioning, audit timeline, and canonical `/bookings` frontend |
| Dated Schedule Exceptions | immutable occurrence overlay for one-date cancel/relocate, availability integration, safe restoration, versioning, and audit |
| Priority Events | canonical submitted/approved/rejected/cancelled workflow; submission may expose conflicts but approval is fail-closed until explicit reconciliation; canonical `/priority-events` frontend |
| Timetable publication reconciliation | future-only schedule diff + operational impact preview; activation recalculates impact transactionally and refuses unresolved Reservation, Priority Event, Schedule Exception, prepared/in-progress source Session, Calendar, or Laboratory status drift |
| LaboratorySession backend | PostgreSQL source-bound Session lifecycle over current ScheduleOccurrence / approved Reservation / approved Priority Event; source fingerprint revalidation, duplicate protection, actual occupancy, source-mutation guards, ETag versioning, and audit |
| ActivityReport backend | PostgreSQL 1:1 normal Session report with atomic end→draft creation, report-type content validation, aggregate attendance evidence, draft/submitted/revision_required/verified lifecycle, controlled manual backfill, ETag versioning, and audit |
| Pelaksanaan Lab frontend | canonical `/sessions` workspace over server-scoped execution-source discovery, LaboratorySession, and ActivityReport APIs; `/journals` is compatibility/deep-link only |
| Session issue observations | immutable execution evidence scoped to canonical Sessions; Device references are same-Laboratory canonical IDs; Incident creation is an explicit idempotent promotion, never an automatic side effect |
| ActivityReport attachments | immutable private-file metadata with SHA-256, draft-only upload, ActivityReport version/audit integration, authorized download, and no exposed storage key |
| ActivityReport offline draft sync | account-scoped seven-day browser working copy + server receipt ledger with stable client mutation IDs, canonical payload hashes, explicit stale-version conflicts, idempotent replay, and three-way rebase UX; server remains authoritative |
| Corrective Work Order backend | **S5.1–S5.3 merged / canonical:** exact-Asset WorkOrder + append-oriented history, corrective custody, Loan/Preventive-Maintenance/WorkOrder exclusion, sourced immutable Inventory part usage, Asset-authority verification, `in_repair` projection, and OpenAPI 0.32; latest merge PR #87 / `5835b10a` with post-merge CI #332 green |
| Dashboard supported metrics | **S5 merged / canonical:** Laboratory, Device, Incident, and active Work Order APIs with a global Laboratory context; no fabricated realtime telemetry |
| Monitoring Device inventory | **S5 merged / canonical:** canonical Device API inventory, lifecycle, and technical profile; heartbeat/CPU/RAM/disk/network telemetry remains deferred to S6 |
| Global Laboratory context | **S5 merged / canonical:** topbar context supports all Laboratories or one exact Laboratory and propagates through Dashboard, Monitoring, Device, Asset, Incident, Work Order, Maintenance/Campaign, Schedule, Reservation, Session/ActivityReport, Operational Calendar, and Loan presentation/query boundaries; school-scoped Calendar events remain visible in Laboratory context |

## Current development — S5.6 Asset QR Identity & Label Batch

S5.6 starts from post-merge-green `main@276326946bd4d4b9c6cf7073058886a893279e52` on branch `feat/s5-6-asset-qr-labels`.

Locked direction:

- QR identity belongs to the canonical Asset, never to Loan and never by reusing Device QR identity;
- QR payload contains only a random non-enumerable public identifier; internal ULIDs, serial number, purchase price, funding source, supplier, borrower identity, audit internals, and technical profile are not encoded;
- anonymous scan response uses a dedicated safe-minimal projection, never `AssetResource`;
- authenticated expansion remains permission-gated and resolves live canonical Asset/linked Device/custody state rather than copying mutable data into the QR;
- token rotation/revocation preserves history and does not increment or bypass Asset version authority;
- label batches are immutable snapshots with append-only generation/reprint evidence and no Asset/Device/Inventory/custody mutation;
- initial label templates are 40×25 mm, 50×30 mm (default), and 70×40 mm; PDF/rendering follows after persistence/API authority is proven.

## Transitional

These routes/domains still rely wholly or materially on browser-local repositories, compatibility state, or incomplete server slices.

- monitoring **telemetry** only; Device inventory itself is canonical on the candidate stack;
- notifications;
- reports/analytics;
- audit-log query UI;
- tenant settings;
- some global search/cross-domain summaries.

`AppDataProvider` remains a transitional application-lifecycle dependency while these domains exist. Its presence must not be interpreted as authority for already-canonical data.

## Planned next

The Master Data ↔ TESSELA ↔ SmartLab boundary is locked by [ADR-001](./ADR-001-master-data-tessela-smartlab-scheduling-boundary.md), and the S2.1 semantic model is locked by [Published Timetable and Schedule Occurrence Contract](./published-timetable-contract.md).

1. S4 is closed on merged PR #83 / `3757e986`; preserve the exact-Asset, immutable-ledger, custody, tenant, and source-of-truth boundaries proven by its automated and browser evidence.
2. S5.1 is locked on merged PR #85 / `8c7f84ee`; preserve [ADR-003](./ADR-003-corrective-work-order-boundary.md) and the [Work Order contract](./work-order-domain-contract.md).
3. S5.2 is complete on merged PR #86 / `main@91000032`: preserve canonical WorkOrder core, corrective custody, cross-domain exclusion, `in_repair`, and OpenAPI 0.31 semantics.
4. S5.3 is complete on merged PR #87 / `main@5835b10a`: preserve least-privilege `work-orders.consume-stock`, immutable sourced WorkOrderPartUsage, idempotent issue, Asset-authority verification, drift guards, atomic custody release, contention proofs, and OpenAPI 0.32.
5. S5 is closed on `main@276326946bd4d4b9c6cf7073058886a893279e52`; post-merge CI #341 and Vercel are green. Preserve Work Order exact-Asset custody, Maintenance Campaign orchestration-only semantics, PostgreSQL UTC, Activity Report object-map serialization, and Global Laboratory Context.
6. S5.6 is active: implement Asset-owned QR identity, safe public scan projection, authenticated RBAC expansion, immutable label batch evidence, and printable labels without introducing a new availability/custody authority.
7. S5.6 must complete persistence/API tests and browser/physical-scan UAT before S6 telemetry.
8. 10. Phase S6: PC monitoring telemetry.
11. Phase S7: Notifications, Reporting, final cross-domain search/summary hardening.
12. Phase S8: remove remaining browser-local compatibility layers after all consumers migrate.

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
- S2.8 makes Priority Events canonical and closes timetable-revision safety: priority submission may record conflicts, approval requires a clear Unified Availability result, approved events become blockers, new TESSELA publications expose deterministic impact previews, active exceptions never migrate silently, operational writes share a School-scoped write mutex with activation, and activation fails closed until impact is clear.
- S3.1 locks the execution/report boundary in [Laboratory Session and Activity Report Contract](./laboratory-session-activity-report-contract.md): normal Sessions originate only from current operational ScheduleOccurrence/approved Reservation/approved Priority Event; source evidence is revalidated before start; in-progress Sessions become operational occupancy; normal ended Sessions own exactly one ActivityReport draft; individual attendance stays outside SmartLab authority; Incident creation from execution observations is explicit; offline report drafts retain server/version authority.
- S3.2 implements the LaboratorySession backend: PostgreSQL persistence/events, exact source provenance, Teacher.membership_id ownership for Guru schedule execution, School-local start gate, source fingerprint revalidation, actual in-progress availability blockers, source mutation/deactivation guards, timetable `active_session_conflict`, permissions, OpenAPI 0.20, and integration coverage.
- S3.3 implements the ActivityReport backend: normal Session end atomically creates exactly one draft; report variants are server-validated; aggregate attendance remains non-authoritative for individual students; manual backfill is elevated and never creates a fake Session; report lifecycle/version/audit are canonical under OpenAPI 0.21.
- S3.4 cuts Pelaksanaan Lab to server authority: ownership-safe `GET /laboratory-session-sources` supplies eligible current sources without display-name inference; `/sessions` provides Today/In Progress/Awaiting Report/History views and canonical Session/report mutations; `/journals` only redirects/deep-links into canonical report history; route/action guards use server permissions; OpenAPI advances to 0.22.
- S3.5 makes execution evidence explicit: immutable SessionIssueObservation rows may be recorded only during actual execution or while the ended Session report remains draft; Device observations require an eligible same-Laboratory canonical Device; Asset reference IDs are intentionally refused until S4; Incident promotion requires explicit permissions and uses a server-stored idempotency correlation so one observation cannot create duplicate tickets. ActivityReport attachments use configurable private Laravel storage, server MIME/size policy, SHA-256 metadata, draft-only versioned upload, audit events, authorized no-store/nosniff download, and no deletion path in S3.5. OpenAPI advances to 0.23.
- S3.6 completes the execution/report phase with controlled offline ActivityReport working copies: cache scope is School+membership+user+report with seven-day expiry; stable client mutation IDs and a server receipt ledger make retries idempotent; stale base versions fail closed without overwrite; conflict UX uses explicit base/local/server comparison and three-way rebase; Session lifecycle, Incident/Observation, report lifecycle mutations, backfill, and attachments remain online-only. OpenAPI advances to 0.24 and the operational UAT matrix records automated versus operator-browser evidence.

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
