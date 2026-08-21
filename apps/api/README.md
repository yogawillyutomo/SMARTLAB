# SmartLab API

Laravel 13 REST API for SmartLab's school laboratory management platform.

## Runtime and database

- PHP 8.3 or newer
- Laravel 13 with Laravel Sanctum
- PostgreSQL is the canonical development and production database
- SQLite `:memory:` is used only by the portable automated test suite

PostgreSQL integration validation is pending until a dedicated safe SmartLab development or test database is available.

## Local setup

```powershell
composer install
Copy-Item .env.example .env
php artisan key:generate
```

Configure the ignored `.env` with dedicated PostgreSQL credentials before running migrations. Never run destructive migration commands against an unknown or shared database.

## Validation

```powershell
composer validate --strict
php artisan about
php artisan route:list
php artisan test
```

The PHPUnit configuration forces SQLite in-memory storage for tests. Reference RBAC data can be checked safely in that isolated environment with:

```powershell
$env:APP_ENV = 'testing'
$env:DB_CONNECTION = 'sqlite'
$env:DB_DATABASE = ':memory:'
php artisan migrate:fresh --seed --force
```

## API v1 foundation

- `GET /api/v1/health` — public safe health response
- `GET /api/v1/me` — Sanctum-authenticated current user and active school context

The source of truth for implemented HTTP contracts is [`packages/contracts/openapi.yaml`](../../packages/contracts/openapi.yaml).
