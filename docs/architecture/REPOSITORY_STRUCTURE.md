# Repository Structure

## Why a monorepo
SmartLab has a React client, a Laravel API, a reserved Go PC-agent service area, shared contracts, infrastructure placeholders, and product documentation. A monorepo lets a single pull request update a contract and its consumers while preserving explicit folder ownership.

This document distinguishes **current repository reality** from **target responsibility**. A reserved directory is not evidence that its runtime capability is implemented.

## Applications

### `apps/web`
Primary browser client for desktop administration and mobile-first operational workflows. PWA/Capacitor packaging remains a future delivery concern unless source and release evidence prove otherwise.

### `apps/api`
Laravel modular monolith and current server authority for migrated SMARTLAB domains. It currently owns server authentication/authorization plus canonical Laboratory, Device, Layout, Transfer, Incident, academic/master projections, scheduling/availability, LaboratorySession, ActivityReport, and related audit/history behavior.

Asset, inventory, loans, maintenance, notifications, reporting, and other future domains belong here only when their canonical vertical slices are implemented; their planned ownership must not be read as proof of current implementation.

## Services

### `services/pc-agent`
Reserved for the future Go Windows telemetry service.

At the current verified architecture state this area is documentation/reservation only; no implemented Go service should be inferred from the directory name. Future telemetry is limited to approved machine-health information and must use revocable machine credentials.

## Shared packages

### `packages/contracts`
OpenAPI/HTTP contracts and compatibility notes. This is the machine-readable integration contract source of truth and remains outside `docs/`.

### `packages/design-tokens`
Shared visual-token documentation for colors, spacing, typography, status semantics, and responsive behavior.

## Infrastructure

`infrastructure/` is the runtime/infrastructure configuration location, but the current subdirectories are still placeholders:

- `docker`: reserved for production/development container topology;
- `nginx`: reserved for reverse-proxy/static-asset configuration;
- `deployment`: reserved for environment, deployment, backup, restore, rollback, and operational documentation.

Do not cite these directories as evidence of production readiness until executable configuration/runbooks and verification exist.

## Documentation

The canonical human documentation entry point is [`docs/README.md`](../README.md).

Current directories on the verified baseline include:

- `product`: PRD and product/workflow artifacts;
- `architecture`: current-state documents, ADRs, domain contracts, and migration design;
- `development`: coding and agent workflows;
- `backlog`: scoped implementation/history tasks;
- `references`: external/reference artifacts.

`docs/reviews/` is the intended location for review reports and validation evidence **when such artifacts exist**. It was not present on `main@a15d39128126f42591b4b5e1236e8d3e4711fd53`; open PR #74 proposes the first S3.6 review artifact there.

Long-term taxonomy may introduce `domains/`, `adr/`, `security/`, `testing/`, and `operations/`, but existing files should not be mass-moved merely for cosmetic symmetry. See [Documentation Convergence Audit](./DOCUMENTATION_CONVERGENCE.md).
