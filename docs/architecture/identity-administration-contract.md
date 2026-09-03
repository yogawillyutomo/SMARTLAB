# Identity Administration Contract

**Status:** Locked for S1A implementation  
**Scope:** current-school user membership administration and server-authoritative role visibility  
**Out of scope:** multi-active-school selector, invitation flow, password reset, tenant-custom role definitions, tenant-custom permission matrices, teacher/student academic master records

## 1. Domain boundary

The school-facing administrative resource is `SchoolMembership`, not a global `User` row.

- `User` is the login account and may conceptually be referenced by more than one school over time.
- `SchoolMembership` is the tenant-scoped relationship between a User and a School.
- Roles are attached to `SchoolMembership` through `membership_roles`.
- Effective permissions are derived from the membership's assigned roles.
- Every API read/mutation in this slice is scoped to the current active School resolved by `CurrentMembershipContext`.
- A membership from another school is indistinguishable from a missing membership and returns 404.

The current authentication foundation still requires exactly one active School context. S1A does not add school selection.

## 2. Permissions

New canonical permissions:

| Permission | Meaning |
| --- | --- |
| `users.view` | List/read memberships in the current School |
| `users.create` | Create a new login account plus membership in the current School |
| `users.update` | Update allowed account fields, membership status, or assigned roles in the current School |
| `roles.view` | Read the canonical server role/permission catalog and current-school membership counts |

Role grant baseline for S1A:

- `super-admin`: all canonical permissions through the existing all-permissions rule.
- `admin-lab`: `users.view`, `users.create`, `users.update`, `roles.view`.
- `kepala-lab`: `users.view`, `roles.view`.
- `pimpinan`: `users.view`, `roles.view`.
- other roles receive none of these permissions unless a later contract explicitly grants them.

The frontend is not a security boundary.

## 3. Endpoints

### GET `/api/v1/identity/memberships`

Requires `users.view`.

Accepted query parameters only:

- `search`: trimmed string, 1-100 characters; matches user name or email case-insensitively according to database semantics.
- `status`: `active|inactive`.
- `roleKey`: one canonical role key.
- `page`: integer >= 1, default 1.
- `perPage`: integer 1-100, default 25.

Ordering: user name ASC, user email ASC, membership id ASC.

Response envelope:

```json
{
  "data": [MembershipProjection],
  "meta": { "page": 1, "perPage": 25, "total": 1, "lastPage": 1 }
}
```

### POST `/api/v1/identity/memberships`

Requires `users.create`.

Exact body fields:

- `name`: required, trimmed, 1-255.
- `email`: required, normalized lowercase/trimmed email, max 255, globally unique for this v1 creation flow.
- `password`: required, minimum 12, maximum 255. Never returned or logged.
- `nip`: optional nullable trimmed string max 64.
- `nis`: optional nullable trimmed string max 64.
- `phone`: optional nullable trimmed string max 32.
- `roleKeys`: required array, 1-8 unique canonical role keys.

Effects, one transaction:

1. create active `User`;
2. create active `SchoolMembership` for current School;
3. attach the exact role set;
4. return 201 `MembershipProjection`.

No invitation/link-existing-user behavior exists in S1A. Existing email is validation failure; S1B/future identity work may add an explicit linking contract.

### GET `/api/v1/identity/memberships/{membershipId}`

Requires `users.view`. Current-school scope only. Non-visible/missing => 404 `IDENTITY_MEMBERSHIP_NOT_FOUND`.

### PATCH `/api/v1/identity/memberships/{membershipId}`

Requires `users.update`.

Exact optional body fields:

- `name`: trimmed 1-255.
- `email`: normalized lowercase/trimmed valid email max 255, unique excluding target user.
- `nip`: nullable trimmed max 64.
- `nis`: nullable trimmed max 64.
- `phone`: nullable trimmed max 32.
- `userStatus`: `active|inactive`.
- `membershipStatus`: `active|inactive`.
- `roleKeys`: array 1-8 unique canonical role keys.

At least one field is required.

A successful effective change returns the fresh `MembershipProjection`. No hard delete exists.

Safety invariant: a mutation must not leave the School without at least one active membership whose User is active and whose roles include `super-admin`. Attempts return 409 `IDENTITY_LAST_SUPER_ADMIN_REQUIRED` with no partial changes.

This invariant applies when a target active Super Admin would lose the `super-admin` role, its membership would become inactive, or its User would become inactive.

### GET `/api/v1/identity/roles`

Requires `roles.view`.

Returns canonical global role definitions plus current-school membership counts. It is read-only in S1A.

```json
{
  "data": [
    {
      "key": "admin-lab",
      "name": "Admin Lab",
      "permissions": ["..."],
      "membershipCount": 2,
      "activeMembershipCount": 2
    }
  ]
}
```

Ordering: role name ASC, role key ASC. Permission keys are unique and sorted ASC.

## 4. Membership projection

Exact participant/admin-safe shape:

```json
{
  "id": "<membership ULID>",
  "status": "active",
  "user": {
    "id": "<user ULID>",
    "name": "...",
    "email": "...",
    "nip": null,
    "nis": null,
    "phone": null,
    "status": "active",
    "lastLoginAt": null
  },
  "roles": [
    { "key": "admin-lab", "name": "Admin Lab" }
  ],
  "createdAt": "ISO-8601",
  "updatedAt": "ISO-8601"
}
```

No password hash, remember token, session identifier, permission pivot data, or other tenant membership is exposed.

## 5. Validation and disclosure ordering

- Authentication first.
- Permission middleware before controller/domain reads.
- Structural request validation before target lookup for mutation requests.
- Tenant-scoped target lookup before any target-state disclosure.
- Unknown body/query fields are rejected with 422.
- Cross-school membership IDs return the same 404 as nonexistent IDs.

## 6. Role matrix policy

S1A intentionally does **not** allow editing `role_permissions`.

The current table is global. Allowing `/roles` to mutate it would change authorization for every tenant, contradicting the multi-tenant product direction. The existing browser-local editable matrix is therefore retired from production routing and replaced with a server-authoritative read-only catalog until a future contract defines tenant-scoped permission policy/overrides.

## 7. Frontend migration gate

After S1A:

- `/users` uses only Identity Administration API data and server permissions.
- `/roles` uses only Identity Administration API role data and server permissions.
- neither page imports `useAppData`, browser repositories, local permission stores for business authority, nor seeded users.
- fake/demo reset-password action is removed.
- navigation/page guards use `users.view` / `roles.view` server permission keys.
- UI may export the currently fetched server projection client-side; export does not create an alternate source of truth.

## 8. Required tests

Backend:

- auth/permission precedence;
- exact query/body field rejection;
- tenant isolation and 404 non-disclosure;
- deterministic pagination/filtering;
- create transaction and exact projection;
- canonical role validation;
- global email uniqueness behavior;
- update behavior and no hard-delete route;
- last-active-Super-Admin invariant and rollback;
- role catalog permissions/counts/order;
- seeder idempotency and intended role grants;
- exact route middleware.

Frontend:

- API contract parsers reject malformed envelopes/records;
- `/users` and `/roles` contain no AppDB/repository/local permission authority imports;
- route/nav guards use server permissions;
- loading/error/retry/empty states;
- create/update actions refresh canonical server data;
- role page is explicitly read-only.

## 9. Security notes

- Password is accepted only on account creation, is handled by Laravel's hashed cast, and is never returned.
- There is no default/demo password reset.
- Membership/role mutation is tenant-scoped and permission-gated.
- Last-active-Super-Admin protection prevents accidental administrative lockout.
- The server role catalog remains authoritative; browser permission matrices cannot elevate access.
