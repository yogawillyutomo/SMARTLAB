# Repository Structure

## Why a monorepo
SmartLab has three tightly related runtime products: a React client, a Laravel API, and a Go PC agent. A monorepo lets a single pull request update an API contract and all consumers while preserving strict folder ownership.

## Applications

### `apps/web`
Primary browser client and future PWA/Capacitor Android shell. It serves desktop administrators and mobile operational users.

### `apps/api`
Laravel modular monolith. It owns authentication, authorization, laboratory operations, inventory, scheduling, journals, incidents, maintenance, loans, notifications, audit, reports, and device ingestion.

## Services

### `services/pc-agent`
A lightweight Go Windows service installed on laboratory PCs. It sends approved machine-health telemetry to the API and receives only explicitly supported device-management instructions.

## Shared packages

### `packages/contracts`
OpenAPI schemas, websocket event payloads, status enums, and compatibility notes. This is the integration source of truth.

### `packages/design-tokens`
Shared names and values for colors, spacing, typography, status semantics, and responsive behavior.

## Infrastructure

- `docker`: local/dev service composition.
- `nginx`: reverse proxy configuration.
- `deployment`: environment and deployment notes/scripts.

## Documentation

- `product`: PRD and product artifacts.
- `architecture`: system design and architectural decisions.
- `development`: coding and agent workflows.
- `backlog`: scoped implementation tasks.
- `reviews`: review reports and validation evidence.
