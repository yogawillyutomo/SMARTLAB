# SmartLab

SmartLab is a school laboratory management platform for planning laboratory use, operating sessions, managing devices and incidents, and progressively moving prototype workflows onto a Laravel + PostgreSQL source of truth.

The repository is a monorepo so the web application, API, PC monitoring agent, shared contracts, infrastructure, and product documentation can evolve with explicit boundaries.

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
│   ├── product/
│   ├── architecture/
│   ├── development/
│   ├── backlog/
│   └── reviews/
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
- Dashboard metrics for laboratories, devices, and incidents.

### Transitional browser-local domains

The `/sessions` and `/journals` frontend workflows remain browser-local/transitional even though the S3.2 LaboratorySession backend is now canonical. ActivityReport/journal persistence, unified Session frontend cutover, telemetry monitoring, fixed assets, inventory/stock, work orders, maintenance, loans, notifications, reports, tenant settings, audit-log query UI, and several cross-domain summaries remain pending. The execution/report semantics are locked in [Laboratory Session and Activity Report Contract](docs/architecture/laboratory-session-activity-report-contract.md); the next backend slice is S3.3 ActivityReport.

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

GitHub CI additionally validates PostgreSQL migrations/seeders and Composer metadata.

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
