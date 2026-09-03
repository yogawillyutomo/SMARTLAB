# SmartLab Full Source-of-Truth Migration

**Status:** migration foundation / implementation roadmap

**Baseline:** `main@b71ef1a5781eeb6998c3fd24a586c5975caba539`

## Goal

Remove mixed local/API application state from production-facing SmartLab flows. PostgreSQL-backed Laravel APIs become the canonical source of truth for persisted business data and authorization. Browser-local repositories remain only as an explicitly temporary prototype implementation until the corresponding server domain is delivered; they must not be presented as canonical operational data.

This roadmap follows the approved operational workflow specification and the repository rule that backend adoption happens through focused vertical slices rather than one unreviewable mega-change.

## Current canonical server domains

| Domain | Server authority | Frontend integration | Status |
| --- | --- | --- | --- |
| Authentication / current membership | Laravel session + Sanctum | `authApi.ts`, `authStore.ts` | canonical |
| Laboratories | PostgreSQL / Laboratory API | `LaboratoryApiPages.tsx` | canonical |
| Devices | PostgreSQL / Device API | `DeviceApiPages.tsx` | canonical |
| Device transfers | PostgreSQL / Device Transfer API | device detail workflow | canonical |
| Laboratory layouts | PostgreSQL / Layout API | `LaboratoryLayoutApiPage.tsx` | canonical |
| Incidents | PostgreSQL / Incident API E1-E13 | Incident list/detail/workflow | canonical |

## Remaining browser-local domains

The following production routes still depend wholly or materially on `AppDataProvider`, `useAppData`, `repositories.ts`, seed data, or compatibility permission state. They are not yet server-authoritative.

| Route / surface | Domain | Required canonical backend before cutover |
| --- | --- | --- |
| `/dashboard` | dashboard aggregation | cross-domain read model / server-backed domain clients |
| `/schedules` | regular schedules | academic master + schedule domain |
| `/bookings` | laboratory reservations | availability + reservation domain |
| `/sessions` | laboratory execution | occurrence/session domain |
| `/journals` | execution report/journal | session/report domain |
| `/monitoring` | device telemetry | device telemetry ingestion/read model |
| `/assets` | fixed assets | asset domain |
| `/stock` | stock/spare parts | inventory + transaction domain |
| `/work-orders` | corrective work orders | work-order domain linked to Incident |
| `/maintenance` | preventive maintenance | maintenance plan/execution domain |
| `/loans` | item loans | custody/loan domain |
| `/calendar` | academic calendar/closures | calendar/closure domain |
| `/reports` | reporting | validated aggregate/reporting queries |
| `/notifications` | user notifications | notification domain |
| `/users` | tenant users/memberships | identity administration API |
| `/roles` | roles/permissions | RBAC administration API |
| `/master-data` | academic/reference masters | tenant master-data domain |
| `/audit-logs` | audit evidence | canonical append-oriented audit query API |
| `/settings` | tenant/product settings | tenant settings domain |
| global search/topbar/dashboard badges | cross-domain summaries | server-backed query/read model |

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
10. `AppDataProvider` and `repositories.ts` are deleted from the production application only after their last domain consumer is migrated.

## Migration order

### Phase S0 - Source-of-truth foundation

- document this matrix;
- fix local Sanctum development origin baseline;
- migrate Dashboard Laboratory/Device/Incident summaries to canonical clients;
- add explicit provenance/availability handling for metrics whose domains are still local;
- add regression tests preventing canonical Dashboard metrics from reading `db.labs`, `db.devices`, or `db.incidents`.

### Phase S1 - Tenant administration and master references

Build canonical APIs for:

- users / school memberships;
- roles and role assignments;
- permissions / role permissions according to locked policy;
- tenant settings;
- academic/reference Master Data with stable IDs;
- audit query foundation.

Reason: schedules, reservations, execution, imports, notifications, and reporting need stable tenant/academic identities.

### Phase S2 - Scheduling and availability

Build canonical domains for:

- academic calendar / closures;
- regular schedules;
- schedule occurrences/exceptions;
- unified availability;
- laboratory reservations and approval;
- priority event overrides.

No recurring schedule is destructively rewritten for a one-date exception.

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

Build:

- canonical notifications with valid deep links;
- reporting/analytics queries based on validated canonical domains;
- complete Dashboard aggregation/read model;
- global search against canonical entities.

### Phase S8 - Local prototype retirement

Acceptance gate:

- no production route imports or consumes `useAppData` / browser repositories for business data;
- no production metric comes from `src/data/seed.ts`;
- route/menu/action authorization for all migrated modules uses server permissions;
- `AppDataProvider`, obsolete local repositories, legacy seed/business DTOs, and compatibility-only data migrations are removed if no longer needed;
- full web/API CI and PostgreSQL integration tests pass;
- browser UAT confirms refresh/deep-link persistence because data lives on the server.

## Immediate UAT finding

The 2026-09-03 local UAT exposed a real mixed-source defect: Dashboard displayed three seeded laboratories (`LAB RPL 1`, `LAB RPL 2`, `LAB RPL 3`) while the canonical Laboratory API correctly returned zero rows from a new `smartlab_dev` database. This is classified as a source-of-truth correctness defect, not a cosmetic discrepancy.

The same class of defect must be assumed possible for every still-local domain until its migration slice is complete.

## Definition of done for the full program

The program is complete only when all user-facing business data shown as operational truth is server-authoritative, authorization is server-backed, local seed data is absent from production flows, cross-domain summaries agree with their detail pages, and the application remains fully functional after browser storage is cleared.