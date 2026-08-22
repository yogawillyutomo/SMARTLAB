# Laboratory Domain API (Stage 4D.2A)

## Ownership and canonical record

A Laboratory belongs to exactly one School, which is the API tenant boundary. Its canonical persisted fields are a ULID identifier, `school_id`, tenant-scoped code, name, location, positive capacity, `active` or `inactive` status, and timestamps. Laboratory code is unique within a School, not globally. Capacity positivity is enforced by create/update validation; Laravel's unsigned integer declaration is not treated as a PostgreSQL positivity constraint.

The active `SchoolMembership` resolved by `ResolveCurrentMembershipContext` is the only source of tenant authority. Create derives `school_id` from that context. List, show, and update begin with the same school scope; an identifier owned by another School returns the same not-found response as a missing identifier.

## Deliberate separation from inventory and layout

`pcCount` is not stored on Laboratory because it will be derived from canonical Device records. Layout rows and columns belong to `LaboratoryLayout`, not Laboratory. Head and technician names are also excluded: personnel relationships must not be denormalized as free text on the room record.

Laboratories have no soft-delete or HTTP DELETE workflow in this stage. Operational deactivation is represented by `status=inactive`, and the database restricts hard deletion of a School while Laboratory records still reference it.

## Authorization and HTTP surface

All Laboratory routes require Sanctum authentication, one valid active membership context, and one endpoint permission:

- `GET /api/v1/laboratories` — `laboratories.view`
- `POST /api/v1/laboratories` — `laboratories.create`
- `GET /api/v1/laboratories/{laboratoryId}` — `laboratories.view`
- `PATCH /api/v1/laboratories/{laboratoryId}` — `laboratories.update`

The reusable permission middleware resolves membership context once, returns stable JSON for context or permission failures, and places the resolved context on the server-side request attributes for validation and controller queries. Mutation validation prohibits client control of identifiers, school ownership, and timestamps. Code uniqueness validation is scoped to the resolved School.

## Stage boundary

Stage 4D.2A implements only the canonical Laboratory CRUD subset above. It excludes hard deletion, export/manage actions, Assets, Devices, technical profiles, LaboratoryLayout and LayoutElement APIs, Device/Layout binding, unplaced-device workflows, QR routes, telemetry, replacement, transfer, incidents, work orders, frontend API adapters, and frontend persistence migration.
