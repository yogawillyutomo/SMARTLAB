# SmartLab

SmartLab is a smart laboratory management platform for schools. This repository is organized as a monorepo so the web application, Laravel API, PC monitoring agent, shared contracts, infrastructure, and product documentation can evolve together without mixing responsibilities.

## Repository map

```text
smartlab/
├── apps/
│   ├── web/                  # React + TypeScript frontend (Bolt baseline)
│   └── api/                  # Laravel REST API (to be scaffolded)
├── services/
│   └── pc-agent/             # Go Windows service for PC telemetry
├── packages/
│   ├── contracts/            # OpenAPI and event contracts
│   └── design-tokens/        # Shared visual tokens
├── infrastructure/
│   ├── docker/
│   ├── nginx/
│   └── deployment/
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

## Current status

- `apps/web`: imported from the latest Bolt prototype and kept functionally unchanged during repository restructuring.
- `apps/api`: reserved for Laravel.
- `services/pc-agent`: reserved for the Go-based Windows monitoring agent.
- `packages/contracts`: initial API contract scaffold.

## Run the frontend

```bash
cd apps/web
npm ci
npm run dev
```

## Validate the frontend

```bash
cd apps/web
npm run lint
npm run typecheck
npm run build
```

On Windows PowerShell, repository-wide checks can later be run with:

```powershell
./scripts/check-all.ps1
```

## Working agreement

1. Use one issue or task per branch.
2. Keep frontend, backend, agent, and infrastructure changes separated unless a contract change requires coordinated edits.
3. Update `packages/contracts/openapi.yaml` before or alongside API-breaking work.
4. Every pull request must include validation evidence.
5. Do not merge when required CI checks fail.
