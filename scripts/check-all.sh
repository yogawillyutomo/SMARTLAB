#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ -f "$ROOT/apps/web/package.json" ]]; then
  cd "$ROOT/apps/web"
  npm ci
  npm run lint
  npm run typecheck
  npm run test
  npm run build
fi

if [[ -f "$ROOT/apps/api/artisan" ]]; then
  cd "$ROOT/apps/api"
  composer install --no-interaction
  php artisan test
fi

if [[ -f "$ROOT/services/pc-agent/go.mod" ]]; then
  cd "$ROOT/services/pc-agent"
  go test ./...
  go vet ./...
fi
