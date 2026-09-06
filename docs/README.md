# SMARTLAB Documentation

This directory is the canonical human entry point for SMARTLAB documentation.

Repository source, committed contracts, migrations, tests, Git history, pull requests, and exact-head CI remain higher-order evidence when a narrative document disagrees with implementation reality. This index must summarize that evidence; it must not create a second authority.

## Convergence audit baseline

The documentation-convergence audit was performed on **2026-09-06** against `main@a15d39128126f42591b4b5e1236e8d3e4711fd53`, immediately before the convergence PR was merged. This section is intentionally **historical audit evidence**, not a live repository-status field.

At that audit baseline:

- latest merged functional PR was **#73 — S3.5 execution observations, Incident linkage, and report attachments**;
- functional PR **#74 — S3.6 offline ActivityReport draft sync and operational UAT** was open at head `0dc1556554835d5da3c363976a6ab49adb41d44d`;
- baseline `main` exact-head GitHub Actions `api-ci` and `web-ci` passed;
- baseline `main` also had a failing Vercel commit status caused by the Vercel build-rate-limit;
- PR #74 exact-head `api-ci` and `web-ci` passed, while operator-required browser UAT remained a rollout gate.

For **current** branch, HEAD, PR, and CI status, verify remote GitHub directly. This index intentionally does not embed a mutable “current main SHA”: merging documentation would invalidate such a field immediately and create self-induced documentation drift.

The detailed evidence record is preserved in [Documentation Convergence Audit](architecture/DOCUMENTATION_CONVERGENCE.md).

## Documentation map

### Product

- [SMARTLAB Operational Workflow Specification](product/SMARTLAB_OPERATIONAL_WORKFLOW_SPEC.md)
- [Product requirements document](product/PRD_SmartLab_PPLG_v1.0.docx)

### Current Architecture State

- [Current Architecture State](architecture/CURRENT_STATE.md)
- [Source-of-Truth Migration](architecture/source-of-truth-migration.md)
- [Repository Structure](architecture/REPOSITORY_STRUCTURE.md)

### Architecture

- [Backend Foundation](architecture/backend-foundation.md)
- [CI Foundation](architecture/ci-foundation.md)
- [SPA Session Authentication](architecture/spa-session-authentication.md)
- [Frontend SPA Auth Integration](architecture/frontend-spa-auth-integration.md)
- [Frontend Laboratory API Integration](architecture/frontend-laboratory-api-integration.md)

### Domain Contracts

- [Academic Master Data](architecture/academic-master-data-contract.md)
- [Identity Administration](architecture/identity-administration-contract.md)
- [Laboratory](architecture/laboratory-domain-api.md)
- [Device](architecture/device-domain-contract.md)
- [Layout](architecture/layout-domain-contract.md)
- [Transfer](architecture/transfer-domain-contract.md)
- [Incident](architecture/incident-domain-contract.md)
- [Operational Calendar / Closure](architecture/operational-calendar-closure-contract.md)
- [Unified Laboratory Availability](architecture/unified-laboratory-availability-contract.md)
- [Laboratory Reservation](architecture/laboratory-reservation-contract.md)
- [Dated Schedule Exception](architecture/dated-schedule-exception-contract.md)
- [Priority Event](architecture/priority-event-contract.md)
- [Laboratory Session + Activity Report](architecture/laboratory-session-activity-report-contract.md)
- [S4 Asset, Inventory, Loan, and Preventive Maintenance](architecture/asset-inventory-loan-maintenance-contract.md)
- [S4 Prototype Reconciliation Audit](architecture/S4_PROTOTYPE_RECONCILIATION.md)

### ADR

- [ADR-001 — Master Data, TESSELA, and SMARTLAB Scheduling Boundary](architecture/ADR-001-master-data-tessela-smartlab-scheduling-boundary.md)
- [ADR-002 — Asset, Inventory, Loan, and Preventive Maintenance Boundary](architecture/ADR-002-asset-inventory-loan-maintenance-boundary.md)

ADRs currently live under `docs/architecture/`. A future `docs/adr/` directory is a taxonomy target only; existing ADRs are not moved merely for symmetry.

### API / Integration Contracts

Machine-readable API contracts remain outside `docs/`:

- [Contract package](../packages/contracts/README.md)
- [Root OpenAPI contract](../packages/contracts/openapi.yaml)

`packages/contracts/` is the machine-readable integration contract source of truth and must not be moved into `docs/` merely to make the directory tree look symmetrical.

### Source-of-Truth Migration

- [Full Source-of-Truth Migration](architecture/source-of-truth-migration.md)
- [Current Architecture State](architecture/CURRENT_STATE.md)
- [Documentation Convergence Audit](architecture/DOCUMENTATION_CONVERGENCE.md)

### Development

- [Agent / contributor rules](../AGENTS.md)
- [Codex Review Loop](development/CODEX_REVIEW_LOOP.md)

### Backlog / Roadmap

The milestone table below is the canonical human roadmap summary. Detailed historical backlog context remains in:

- [P0 Frontend Stabilization](backlog/P0_FRONTEND_STABILIZATION.md)

### Security

There is not yet a dedicated `docs/security/` corpus. Until that is created, security boundaries are distributed across:

- [AGENTS.md](../AGENTS.md);
- [Current Architecture State](architecture/CURRENT_STATE.md);
- domain contracts and server authorization tests;
- [ADR-001](architecture/ADR-001-master-data-tessela-smartlab-scheduling-boundary.md).

A production security-hardening guide remains required before production.

### Testing / Verification

- [CI Foundation](architecture/ci-foundation.md)
- [TESSELA Revision UAT](architecture/tessela-revision-uat.md)
- GitHub Actions and repository tests are execution evidence.

`docs/reviews/` now contains the S3.6 implementation-validation and rollout-UAT matrix at [S3.6 Offline ActivityReport Draft UAT](reviews/s3.6-offline-draft-uat.md). The matrix explicitly separates automated implementation evidence from operator/browser checks required in the target rollout environment.

### Operations / Deployment

Runtime configuration remains under `infrastructure/`, not `docs/`:

- [Docker placeholder](../infrastructure/docker/README.md)
- [Nginx placeholder](../infrastructure/nginx/README.md)
- [Deployment placeholder](../infrastructure/deployment/README.md)

These are placeholders, not proof of production readiness.

### Bakaran Platform Integration

SMARTLAB must consume shared canonical identity/reference data without surrendering product-local laboratory authority.

Bakaran Platform reference contracts:

- [SMARTLAB Adoption Plan](https://github.com/yogawillyutomo/bakaran-platform/blob/main/docs/09-migration/06-smartlab-adoption.md)
- [Historical Data Policy](https://github.com/yogawillyutomo/bakaran-platform/blob/main/docs/09-migration/08-historical-data-policy.md)

## Authority map

| Authority | Owns | SMARTLAB rule |
| --- | --- | --- |
| **BP Master Data / School Core target** | shared School, Person, PhysicalSpace, and academic reference identity | SMARTLAB may map/project canonical references. Canonical Person identity does **not** grant SMARTLAB membership or role. |
| **TESSELA** | timetable generation, constraint solving, publication/version history | SMARTLAB consumes immutable published timetable evidence; it does not solve or silently rewrite recurring timetables. |
| **SMARTLAB** | Laboratory operational aggregate; Device; Layout; Transfer; Incident; Availability; Reservation; dated Schedule Exception; Priority Event; LaboratorySession; ActivityReport; future Asset/Inventory/Maintenance/Telemetry | Operational mutations remain tenant-scoped, server-authorized, audited, concurrency-safe, and fail closed. |
| **SMARTLAB SchoolMembership / product-local RBAC** | SMARTLAB tenant membership and product permissions | Platform Admin/Superadmin status and canonical Person mapping do not implicitly grant SMARTLAB tenant row authority. |

Laboratory may later map to canonical `PhysicalSpace`, but Device, Layout, Transfer, Incident, maintenance, telemetry, and other laboratory operational lifecycles remain SMARTLAB-owned. Historical product evidence is not silently rewritten when canonical identity changes.

## Canonical milestone roadmap

Status reflects **merged `main`** unless the row explicitly says an open PR is in progress.

| Milestone | Status | Delivered evidence | Remaining scope | Dependency | Canonical docs | Current/latest PR or commit | Next gate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| S0 — Source-of-Truth Foundation | Substantially complete | canonical auth/current membership foundation, source-of-truth matrix, canonical Laboratory/Device/Incident dashboard reads, regression boundaries | final retirement occurs only in S8 | none | `CURRENT_STATE.md`, `source-of-truth-migration.md` | `a9707763` foundation; later slices extend it | keep regression/fail-closed boundaries intact |
| S1 — Tenant Administration / Master | Partial | Identity Administration, SchoolMembership-aware server authorization, role/permission catalog, academic master stable IDs | tenant settings; tenant-specific permission overrides; canonical audit-log query API/UI; shared BP Master Data adoption | S0 | identity + academic master contracts | `82f2b0bc` reconciliation after `5ffa9806` / `9245583a` | lock remaining tenant/admin contracts without weakening product-local RBAC |
| S2.1 — Timetable contract | Complete / locked | immutable full School+Semester publication semantics and occurrence contract | none inside S2.1 | ADR-001, stable academic refs | published timetable contract | `908afbee` | preserve contract |
| S2.2 — Published timetable backend | Complete | PostgreSQL publication/entry/occurrence persistence, validation, replay protection, activation, audit | none inside S2.2 | S2.1 | published timetable contract | `9c61f340` | preserve activation integrity |
| S2.3 — Current-plan read + frontend cutover | Complete | canonical occurrence queries and `/schedules` cutover | none inside S2.3 | S2.2 | current state + migration doc | `5163f19f` | preserve TESSELA authority |
| S2.4 — Operational Calendar / Closure | Complete | canonical blockers/informational events, optimistic concurrency, audit | none inside S2.4 | S2.3 | calendar contract | `7dee3c1e` | preserve non-destructive cancellation |
| S2.5 — Unified Availability | Complete | explainable availability, fail-closed unknown, schedule coverage, blockers/notices | future S4 maintenance/assets add new evidence without bypassing engine | S2.4 | availability contract | `10f1e081` | preserve fail-closed semantics |
| S2.6 — Reservations | Complete | canonical lifecycle, serialized checks, approval re-check, ETag, audit | none inside S2.6 | S2.5 | reservation contract | `7f30be37` | preserve mutation serialization |
| S2.7 — Dated Schedule Exceptions | Complete | one-date cancel/relocate overlays, safe restore, audit, versioning | no general time/date reschedule solver | S2.5–S2.6 | exception contract | `63392a49` | preserve immutable TESSELA source |
| S2.8 — Priority Events + revision reconciliation | Complete | canonical Priority Events, deterministic publication impact, shared School-scoped operational write mutex, activation fail-closed | none inside S2.8 | S2.5–S2.7 | priority event + reconciliation docs | PR #68 / `28d6db8e` | preserve impact fingerprint/revalidation |
| S3.1 — Execution/report contract | Complete / locked | source-bound Session/ActivityReport semantics, explicit Incident linkage, offline authority rules | none inside S3.1 | S2 complete | Session + ActivityReport contract | PR #69 / `acf3d0b2` | preserve contract |
| S3.2 — LaboratorySession backend | Complete | source provenance, lifecycle, ETag, fingerprint revalidation, actual occupancy, source mutation guards | none inside S3.2 | S3.1 | Session + ActivityReport contract | PR #70 / `f2eb41a7` | preserve source revalidation |
| S3.3 — ActivityReport backend | Complete | 1:1 report, atomic end→draft, lifecycle, aggregate attendance boundary, manual backfill | none inside S3.3 | S3.2 | Session + ActivityReport contract | PR #71 / `d54fa17f` | preserve version/audit semantics |
| S3.4 — Pelaksanaan Lab frontend cutover | Complete | canonical `/sessions`, server source discovery/actions, report workflow, `/journals` compatibility redirect | browser-local retirement only after all remaining consumers migrate | S3.2–S3.3 | current state + migration doc | PR #72 / `723744b4` | do not restore local Session/Journal authority |
| S3.5 — Execution evidence | Complete | immutable observations, explicit idempotent Observation→Incident promotion, private report attachments | no attachment delete path in S3.5 by design | S3.4 | Session + ActivityReport contract | PR #73 / `a15d3912` | preserve immutable evidence/private storage boundary |
| S3.6 — Offline Report Draft Sync + Operational UAT | **Implementation complete; production-rollout UAT pending** | controlled offline draft working copies, idempotent server sync ledger, conflict/rebase UX, OpenAPI 0.24, automated contract/UAT coverage, and checked-in operator matrix | execute authenticated-browser/DevTools network-toggle scenarios in the target rollout environment and record deployment/UAT evidence | S3.5 | Session/Report contract + `docs/reviews/s3.6-offline-draft-uat.md` | PR #74 / S3.6 implementation | keep server/version authority fail-closed; proceed to S4 implementation planning while rollout UAT remains a production gate |
| S4.1 — Asset / Inventory / Loan / Preventive Maintenance contract | **Candidate on this branch; not authority until merged** | ADR-002, S4 semantic contract, prototype reconciliation audit | merge/accept contract before runtime work | S3 complete | ADR-002 + S4 contract | current S4.1 branch | exact-head CI, review, explicit merge decision |
| S4.2–S4.6 — S4 implementation | Planned | none canonical yet | Asset + Device link; immutable stock ledger; Loan custody; Preventive Maintenance; cross-domain UAT | S4.1 accepted | S4 contract | none | start S4.2 only after S4.1 merges |
| S5 — Corrective Work Orders | Planned | Incident already canonical as upstream evidence | Work Orders, assignment/repair lifecycle, spare-part consumption, Incident linkage | S4 inventory | future contract | none | keep waiting-for-parts in Work Order, not Incident status |
| S6 — PC Monitoring Telemetry | Planned | privacy direction documented only | agent enrollment/revocation, telemetry ingestion/read models, buffering/update policy | device authority + production security | AGENTS/current state; future telemetry contract | none | implement revocable machine auth and approved telemetry only |
| S7 — Notifications / Reporting / Final Reads | Planned | partial canonical source domains exist | notifications, analytics/reporting, final dashboard/global search, audit reads | S4–S6 source maturity | future reporting/read-model docs | none | no metrics from browser seed/local prototype |
| S8 — Browser-local Removal | Planned | migrated routes already prohibit local authority | remove remaining AppData/browser business persistence, legacy seed/business DTOs and compatibility layers after final consumers move | S4–S7 | source-of-truth migration | none | full regression + browser UAT with storage cleared |

## Cross-cutting deferred work

These items remain explicit debt and must **not** be artificially forced into S3.6:

- tenant settings;
- tenant-specific permission override contract/editor;
- audit-log query API/UI;
- Excel import foundation;
- Master Data import/adoption;
- production deployment topology;
- Docker build/runtime;
- reverse proxy;
- environment/secrets policy;
- Redis/queue/scheduler operations;
- backup and restore;
- restore rehearsal;
- rollback;
- health/readiness;
- structured logging;
- metrics and alerting;
- observability;
- incident response;
- security hardening;
- data retention;
- PC Agent deployment/update/revocation;
- disaster recovery;
- exact release evidence and production runbook.

## Documentation taxonomy target

Long-term convergence should target:

```text
docs/
├── README.md
├── product/
├── architecture/
├── domains/
├── adr/
├── security/
├── testing/
├── operations/
├── development/
├── backlog/
├── reviews/
└── references/
```

This is a **target taxonomy**, not a mandate to move current files immediately.

Current links/history take precedence over cosmetic symmetry. Existing domain contracts and ADRs may stay under `docs/architecture/` until a move has a concrete benefit and a controlled link-migration plan. `packages/contracts/` remains outside `docs/`, and `infrastructure/` remains the runtime/infrastructure configuration location.

## Production documentation gate

SMARTLAB is not production-documentation complete while the infrastructure directories are placeholders.

Before production, documentation and executable configuration must cover at least:

1. production topology and network/trust boundaries;
2. Docker image/build/runtime topology;
3. Nginx/reverse proxy and TLS policy;
4. environment and secrets lifecycle;
5. Redis, queue worker, scheduler, retry/dead-letter operations;
6. migrations and release sequencing;
7. backup policy and restore rehearsal evidence;
8. rollback procedure and compatibility constraints;
9. health/readiness probes;
10. structured logging and correlation;
11. metrics, alerting, dashboards, and observability ownership;
12. incident-response runbook;
13. security hardening and access review;
14. data retention/deletion policy;
15. PC Agent enrollment, deployment, update, credential rotation/revocation and recovery;
16. disaster recovery objectives and rehearsal;
17. exact release evidence: commit, artifacts, migrations, configuration, CI, UAT, approvals, deploy/rollback record.

See [Documentation Convergence Audit](architecture/DOCUMENTATION_CONVERGENCE.md) for the evidence matrix behind this index.
