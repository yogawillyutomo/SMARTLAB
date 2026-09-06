# SmartLab

SmartLab is a school laboratory management platform for planning laboratory use, operating sessions, managing devices and incidents, and progressively moving prototype workflows onto a Laravel + PostgreSQL source of truth.

The repository is a monorepo so the web application, API, PC monitoring agent, shared contracts, infrastructure, and product documentation can evolve with explicit boundaries.

Canonical human documentation entry point: [SMARTLAB Documentation](docs/README.md).

## Repository map

```text
smartlab/
├── apps/
│   ├── web/                  # React + TypeScript + Vite frontend
│   └── api/                  # Laravel REST API
├── services/
│   └── pc-agent/             # Reserved Go Windows telemetry service
├── packages/
│   ├── contracts/            # OpenAPI / HTTP contracts
│   └── design-tokens/        # Shared visual-token documentation
├── infrastructure/
│   ├── docker/               # Planned containerization
│   ├── nginx/                # Planned reverse-proxy configuration
│   └── deployment/           # Planned deployment / backup / rollback docs
├── docs/
│   ├── README.md             # Canonical human documentation index
│   ├── product/
│   ├── architecture/
│   ├── development/
│   ├── backlog/
│   └── references/
├── scripts/
├── .github/
├── AGENTS.md
└── README.md
```

## Current architecture status

The application is in a staged source-of-truth migration.

### Server-authoritative today

- authentication and current school membership;
- laboratories;
- managed devices and device transfers;
- laboratory layouts;
- incidents and their operational history/workflow;
- identity administration for users and school memberships;
- server role/permission catalog;
- academic master data with stable IDs;
- published timetable ingestion/validation/activation and materialized schedule occurrences;
- canonical `/schedules` current-plan read model backed by active Schedule Occurrences plus non-destructive dated operational overlays;
- canonical Operational Calendar with school/laboratory blockers and non-destructive cancellation;
- canonical Unified Laboratory Availability read model combining schedule coverage, ScheduleOccurrence occupancy, dated Schedule Exceptions, Laboratory status, Calendar blockers, active reservations, approved Priority Events, and actual in-progress Laboratory Sessions;
- canonical Laboratory Reservations with transactional availability checks, approval re-check, versioning, and audit history;
- canonical dated Schedule Exceptions for one-date occurrence cancellation or Laboratory relocation without rewriting TESSELA;
- canonical Priority Events with explicit reconciliation before approval and a server-authoritative `/priority-events` workflow;
- fail-closed TESSELA publication impact preview/reconciliation gate before activation, including operational drift, prepared/in-progress schedule Session commitments, and deterministic impact fingerprints;
- canonical LaboratorySession backend with source-bound prepare/start/end/cancel lifecycle, source fingerprint revalidation, actual occupancy, server permissions, ETag versioning, and audit history;
- canonical ActivityReport backend with atomic Session-end draft creation, report-type validation, aggregate attendance evidence, draft/submission/revision/verification lifecycle, controlled manual backfill, ETag versioning, and audit history;
- canonical `/sessions` Pelaksanaan Lab frontend with server-scoped eligible source discovery, prepare/start/end/cancel actions, ActivityReport editing/submission/verification, and server-backed history; `/journals` is a compatibility redirect into the same canonical workflow;
- canonical S3.5 execution evidence: immutable Session issue observations, explicit idempotent Observation→Incident promotion, and draft-only private ActivityReport attachments with SHA-256 metadata and authorized download;
- canonical S3.6 controlled offline ActivityReport draft working copies with account-scoped seven-day cache, stable client mutation IDs, idempotent server receipts, fail-closed stale-version conflicts, and explicit three-way rebase UX;
- canonical S4.2 fixed Assets with School-scoped identity, separated condition/lifecycle, exact optional 1:1 Device linkage, ETag concurrency, append-oriented change events, and server-authoritative `/assets` UI;
- canonical S4.3 Inventory on merged `main@1a34dc23`: quantity-tracked InventoryItems plus immutable idempotent InventoryTransactions, serialized non-negative balance enforcement, OpenAPI 0.26, and server-authoritative `/stock`;
- canonical S4.4 Loan custody on merged `main@f85f2edf`: exact-Asset Loan/LoanItem custody, ETag lifecycle actions, symmetric-ready double-checkout exclusion, immutable condition evidence, OpenAPI 0.27, and server-authoritative `/loans`;
- canonical S4.5 Preventive Maintenance on merged `main@e3da257c`: exact-Asset MaintenancePlan/Execution, active Maintenance custody, symmetric Loan↔Maintenance exclusion, audited Asset condition completion, atomic Inventory issue consumption, OpenAPI 0.28, and server-authoritative `/maintenance`;
- S4.6 reconciliation candidate in PR #83: read-only Asset operational-state projection with provenance, active-custody lifecycle/unlink reconciliation, real PostgreSQL contention tests, S4 source-of-truth closure scans, documentation-link CI, and storage-cleared browser UAT contract; manual browser execution remains a required S4 exit gate;
- Dashboard metrics for laboratories, devices, and incidents.

### Transitional browser-local domains

Pelaksanaan Lab is server-authoritative through S3.6, and all four S4 routes (`/assets`, `/stock`, `/loans`, `/maintenance`) are canonical on merged `main` through S4.5. Remaining transitional work includes telemetry monitoring, work orders, notifications, reports, tenant settings, audit-log query UI, and several cross-domain summaries. PR #83 is the S4.6 proof/reconciliation tranche; it must not add S5 Work Order authority. Automated S4.6 evidence can run in CI, but S4 is not declared complete until the checked-in storage-cleared browser UAT matrix is actually executed and recorded.

See [Full Source-of-Truth Migration](docs/architecture/source-of-truth-migration.md) and [Current Architecture State](docs/architecture/CURRENT_STATE.md).

### Reserved / not implemented yet

- `services/pc-agent`: contract/direction exists, but the Go service has not been implemented.
- `infrastructure`: Docker, Nginx, deployment, backup, restore, rollback, and observability are still placeholders.

## Run the frontend

```bash
cd apps/web
npm ci
npm run dev
```

## Validate the frontend

```bash
cd apps/web
npm ci
npm run lint
npm run typecheck
npm run test
npm run build
```

## Run the API

Create the Laravel environment from `apps/api/.env.example`, configure PostgreSQL, then use the normal Laravel workflow.

Typical validation:

```bash
cd apps/api
composer install --no-interaction
php artisan test
```

GitHub CI additionally validates PostgreSQL migrations/seeders, the dedicated S4 PostgreSQL contention suite, relative Markdown links, and Composer metadata.

## Repository-wide validation

Linux/macOS:

```bash
./scripts/check-all.sh
```

Windows PowerShell:

```powershell
./scripts/check-all.ps1
```

The scripts run frontend install/lint/typecheck/test/build, API install/tests when Laravel is present, and Go checks when a PC Agent module exists.

## Working agreement

1. Use one issue or task per branch.
2. Keep frontend, backend, agent, and infrastructure changes separated unless a contract change requires coordinated edits.
3. Update `packages/contracts/openapi.yaml` before or alongside API-breaking work.
4. Every pull request must include validation evidence.
5. Do not merge when required CI checks fail.
6. Do not present browser-local prototype data as canonical operational truth after a domain has moved to the API.
