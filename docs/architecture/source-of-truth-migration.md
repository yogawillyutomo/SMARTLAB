# SmartLab Full Source-of-Truth Migration

**Status:** active staged migration

**Baseline:** `main@82f2b0bc0c6530aeabedb781c38cc12d1b53894a`

## Goal

Remove mixed local/API application state from production-facing SmartLab flows. PostgreSQL-backed Laravel APIs become the canonical source of truth for persisted SmartLab business data and authorization. Browser-local repositories remain only as an explicitly temporary prototype implementation until the corresponding server domain is delivered; they must not be presented as canonical operational data.

This roadmap follows the approved operational workflow specification and the repository rule that backend adoption happens through focused vertical slices rather than one unreviewable mega-change.

## Current canonical server domains

| Domain | Server authority | Frontend integration | Status |
| --- | --- | --- | --- |
| Authentication / current membership | Laravel session + Sanctum | `authApi.ts`, `authStore.ts` | canonical |
| Laboratories | PostgreSQL / Laboratory API | Laboratory API pages | canonical |
| Devices | PostgreSQL / Device API | Device API pages | canonical |
| Device transfers | PostgreSQL / Device Transfer API | device detail workflow | canonical |
| Laboratory layouts | PostgreSQL / Layout API | canonical layout editor | canonical |
| Incidents | PostgreSQL / Incident API E1-E13 | incident list/detail/workflow | canonical |
| Identity administration | PostgreSQL / users + school memberships | `identityAdminGateway`, `UsersPage.tsx` | canonical |
| Role / permission catalog | Laravel authorization catalog | `identityAdminGateway`, `RolesPage.tsx` | canonical read-only catalog |
| Academic master | PostgreSQL / academic master API | `academicMasterGateway`, `MasterDataPage.tsx` | canonical |
| Dashboard lab/device/incident metrics | canonical domain APIs | `DashboardPage.tsx` | canonical for supported metrics |

The role catalog is server-authoritative but tenant-specific permission overrides remain deferred until their contract is locked.

## Remaining browser-local or incomplete domains

The following production routes still depend wholly or materially on `AppDataProvider`, `useAppData`, browser repositories/seed state, or do not yet have a complete canonical server domain.

| Route / surface | Domain | Required canonical backend before cutover |
| --- | --- | --- |
| `/schedules` | regular schedules | schedule domain + academic integration |
| `/bookings` | laboratory reservations | availability + reservation domain |
| `/sessions` | laboratory execution | occurrence/session domain |
| `/journals` | execution report/journal | session/report domain |
| `/monitoring` | device telemetry | device telemetry ingestion/read model |
| `/assets` | fixed assets | asset domain |
| `/stock` | stock/spare parts | inventory + immutable transaction domain |
| `/work-orders` | corrective work orders | work-order domain linked to Incident |
| `/maintenance` | preventive maintenance | maintenance plan/execution domain |
| `/loans` | item loans | custody/loan domain |
| `/calendar` | academic calendar/closures | calendar/closure domain |
| `/reports` | reporting | validated aggregate/reporting queries |
| `/notifications` | user notifications | notification domain |
| `/audit-logs` | audit evidence | canonical append-oriented audit query API |
| `/settings` | tenant/product settings | tenant settings domain |
| global search/topbar/unsupported dashboard metrics | cross-domain summaries | server-backed query/read model |

## Non-negotiable rules

1. A screen must not combine local prototype records with canonical records and present them as one authoritative dataset.
2. Server permissions are authoritative for every migrated route and action. Compatibility role/module permissions may remain only on routes not yet migrated.
3. Canonical IDs are ULID/UUID identifiers from the server; local string IDs and display numbers are not server identity.
4. Human-readable numbers are server allocated where relevant.
5. No backendless API emulation layer may be introduced merely to hide local persistence.
6. Domain mutations are transactionally validated server-side and audited where material.
7. Each migration slice includes contract, backend, frontend, tests, authorization, and rollback/failure behavior.
8. Local seed data must never appear as real production data after a route is migrated.
9. Dashboard/reporting consumers may only show canonical metrics for canonical domains. Unsupported metrics must be explicitly unavailable until their source domain is migrated.
10. `AppDataProvider` and browser repositories are deleted from the production application only after their last domain consumer is migrated.

## Cross-product authority boundary

The boundary is locked by [ADR-001: Master Data, TESSELA, and SmartLab Scheduling Boundary](./ADR-001-master-data-tessela-smartlab-scheduling-boundary.md).

Target ownership:

- shared BP Master Data is the cross-product authority for school-wide academic references;
- TESSELA is the sole timetable-generation and constraint-solving authority;
- SmartLab remains authoritative for Laboratory resources and laboratory operations;
- TESSELA may assign a planned SmartLab Laboratory reference in a published timetable;
- SmartLab owns dated availability, reservations, closures, maintenance unavailability, priority events, operational schedule exceptions, sessions, and journals;
- a one-date SmartLab exception never destructively rewrites the recurring TESSELA timetable;
- the current SmartLab Academic Master implementation is preserved and evolves into a projection/adapter when shared Master Data is introduced.

Published timetable versions are immutable integration artifacts. SmartLab validates and atomically activates them; SmartLab does not silently optimize or repair them.

## Migration order

### Phase S0 - Source-of-truth foundation — substantially complete

Delivered:

- source-of-truth matrix;
- canonical Dashboard Laboratory/Device/Incident summaries;
- explicit unavailable state for unsupported metrics;
- server-backed authentication/current membership;
- regression coverage around canonical domain boundaries.

### Phase S1 - Tenant administration and master references — partially complete

Delivered:

- users / school memberships;
- server role/permission catalog and role assignment support used by identity administration;
- academic/reference Master Data with stable IDs.

Still pending or intentionally deferred:

- tenant settings;
- tenant-specific permission override editor/contract;
- canonical audit query UI/API completion.

### Phase S2 - Scheduling and availability — active

**S2.1 contract locked:** [Published Timetable and Schedule Occurrence Contract](./published-timetable-contract.md).

Locked foundations:

- complete School + Semester TESSELA publication snapshots;
- immutable source publication identity/version;
- SHA-256 replay/integrity semantics;
- normalized immutable TimetableEntry rows;
- stable academic references rather than display text;
- nullable planned SmartLab Laboratory assignment;
- deterministic weekly/single-date recurrence;
- materialized immutable ScheduleOccurrence rows;
- full validation before activation;
- exactly one active publication per School + Semester;
- structural source conflicts are rejected, never solved by SmartLab.

Next implementation slices:

- S2.2 published timetable persistence, validation, occurrence materialization, activation, audit, and OpenAPI;
- S2.3 canonical schedule read model + frontend cutover;
- S2.4 academic calendar / closures;
- S2.5 unified Laboratory availability;
- S2.6 reservations and approval;
- S2.7 dated schedule exceptions;
- S2.8 priority event override/integration UAT.

No recurring schedule is destructively rewritten for a one-date exception.

Excel/file schedule ingestion, if later required, must be an adapter into the same canonical publication contract and must not create an alternate schedule authority.

**Entry gate satisfied:** ownership is locked by ADR-001 and S2.1 semantics are locked by the published timetable contract.

### Phase S3 - Laboratory execution and reporting

Build canonical domains for:

- laboratory execution/session;
- required completion report/journal;
- verification workflow;
- offline-safe draft/sync contract if implemented for PWA/mobile.

### Phase S4 - Asset and inventory operations

Build canonical domains for:

- fixed assets;
- stock/spare parts and immutable quantity transactions;
- loans/custody;
- preventive maintenance plans/executions.

Inventory must reject negative stock transactionally.

### Phase S5 - Corrective maintenance

Build canonical Work Orders linked optionally to Incidents. Waiting for spare parts belongs to Work Order, not Incident status. Integrate spare-parts consumption through the inventory domain.

### Phase S6 - Monitoring telemetry

Build authenticated device-agent enrollment and approved telemetry ingestion/read models. Monitoring must never depend on fabricated browser telemetry once cut over.

### Phase S7 - Notifications, reporting, and final Dashboard

Build canonical notifications with valid deep links, reporting/analytics queries based on validated canonical domains, complete Dashboard aggregation/read models, and global search against canonical entities.

### Phase S8 - Local prototype retirement

Acceptance gate:

- no production route imports or consumes `useAppData` / browser repositories for business data;
- no production metric comes from `src/data/seed.ts`;
- route/menu/action authorization for all migrated modules uses server permissions;
- `AppDataProvider`, obsolete local repositories, legacy seed/business DTOs, and compatibility-only data migrations are removed if no longer needed;
- full web/API CI and PostgreSQL integration tests pass;
- browser UAT confirms refresh/deep-link persistence because data lives on the server.

## Historical UAT finding

The 2026-09-03 local UAT exposed a real mixed-source defect: Dashboard displayed three seeded laboratories while the canonical Laboratory API correctly returned zero rows from a new `smartlab_dev` database. This was classified as a source-of-truth correctness defect, not a cosmetic discrepancy.

The Dashboard has since been cut over to canonical Laboratory/Device/Incident clients. The same class of defect must still be assumed possible for every remaining local domain until its migration slice is complete.

## Definition of done for the full program

The program is complete only when all user-facing business data shown as operational truth is server-authoritative, authorization is server-backed, local seed data is absent from production flows, cross-domain summaries agree with their detail pages, and the application remains fully functional after browser storage is cleared.
