# CI Foundation

SmartLab uses one GitHub Actions workflow named `CI`. It runs for pull requests targeting `main`, pushes to `main`, and manual dispatches. Both jobs run for every workflow invocation without path filters so they can later be configured as required main-branch status checks.

## Stable checks

- `web-ci` uses Node.js 20 and runs `npm ci`, lint, TypeScript checking, the Vitest suite, and the production Vite build in `apps/web`.
- `api-ci` uses PHP 8.3 and installs Composer dependencies before validating metadata, migrations, seeders, and the Laravel test suite in `apps/api`.

The API job provides an ephemeral PostgreSQL 16 service. `migrate:fresh --seed --force` runs only against its `smartlab_test` database to smoke-test PostgreSQL schema syntax, ULIDs, foreign keys, Sanctum token morphs, and deterministic RBAC seeders.

PHPUnit remains a portable SQLite in-memory test suite for now. PostgreSQL migration/seed smoke validation and SQLite application tests are intentionally separate CI gates within `api-ci`.

This foundation performs quality validation only. It does not deploy SmartLab, upload artifacts, or require repository secrets.
