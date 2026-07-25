# SmartLab Agent Instructions

## Product goal
Build a production-ready school laboratory management platform with desktop administration, mobile-first teacher/technician workflows, offline-capable journals, QR-based asset operations, and safe PC monitoring.

## Repository boundaries
- `apps/web`: React, TypeScript, Vite, Tailwind. Do not introduce a second frontend framework.
- `apps/api`: Laravel REST API. Keep business rules in domain/application services, not controllers.
- `services/pc-agent`: Go Windows service. It sends approved health telemetry only; no keylogging, screenshots, personal-file collection, or invasive surveillance.
- `packages/contracts`: source of truth for HTTP and realtime contracts.
- `infrastructure`: Docker, reverse proxy, deployment, and observability configuration.
- `docs`: architecture decisions, workflows, reviews, and product requirements.

## Mandatory workflow
1. Read the relevant PRD, architecture notes, and backlog item before editing.
2. Inspect existing implementation before proposing replacement architecture.
3. Make the smallest coherent change that solves the task.
4. Do not silently remove working UI or routes.
5. Add or update tests for business logic and regressions.
6. Run the relevant validation commands before finishing.
7. Report changed files, decisions, tests, and unresolved risks.

## Frontend validation
Run from `apps/web`:

```bash
npm ci
npm run lint
npm run typecheck
npm run build
```

## Frontend rules
- Preserve the current dark SmartLab design and icon-based PC monitoring identity.
- Mobile operational flows must be intentionally designed, not merely desktop layouts shrunk to phone width.
- Use route parameters for detail pages and support browser deep links.
- Enforce permissions at menu, page, and action levels.
- Use repository/service abstractions; components must not access localStorage directly.
- Prefer React Hook Form + Zod for non-trivial forms.
- Avoid `any`, global mutable state, dead buttons, mock success messages without state changes, and random data on initial render.
- Do not add Supabase/Firebase as the application database. The planned backend is Laravel + PostgreSQL.

## Backend rules
- Laravel Sanctum for first-party web/mobile authentication.
- PostgreSQL is the primary database; Redis is for queue/cache/realtime coordination.
- Use policies/permissions for authorization; frontend guards are not a security boundary.
- Use UUID/ULID internal identifiers and separate human-readable document numbers.
- Audit material state changes.
- Validate inventory quantities transactionally and never allow negative stock.

## PC agent rules
- Authenticate each installation with revocable device credentials.
- Buffer telemetry locally during network loss and retry with bounded backoff.
- Default telemetry: device identity, heartbeat, CPU, RAM, disk, network, uptime, OS/hardware inventory.
- Never collect keystrokes, screenshots, browser history, documents, or user content.

## Pull request quality bar
A PR is not complete unless:
- relevant checks pass;
- the requested acceptance criteria are demonstrated;
- no unrelated refactor is bundled in;
- migrations/contracts are documented when applicable;
- security/privacy implications are stated;
- screenshots are included for significant UI changes.
