$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot

if (Test-Path "$Root/apps/web/package.json") {
    Push-Location "$Root/apps/web"
    npm ci
    npm run lint
    npm run typecheck
    npm run test
    npm run build
    Pop-Location
}

if (Test-Path "$Root/apps/api/artisan") {
    Push-Location "$Root/apps/api"
    composer install --no-interaction
    php artisan test
    Pop-Location
}

if (Test-Path "$Root/services/pc-agent/go.mod") {
    Push-Location "$Root/services/pc-agent"
    go test ./...
    go vet ./...
    Pop-Location
}
