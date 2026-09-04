# Academic Master Data Contract

**Status:** LOCKED FOR S1B IMPLEMENTATION

**Branch:** `feat/academic-master-stable-ids`

**Baseline:** `main@5ffa9806680a940c4bcd02afa508c5309af78210`

**Scope:** S1B — stable academic identifiers required before schedule import and unified availability.

## 1. Purpose

This contract turns the academic reference data used by SmartLab from browser-local name/code rows into tenant-owned, server-authoritative entities with stable identifiers.

The product workflow already locks the following prerequisites:

- schedule import must wait until teacher, class, subject, lesson-period, academic-year, and semester references have stable identifiers/codes;
- names are display data, not reliable foreign keys;
- Laravel/server authorization is authoritative;
- material mutations are auditable;
- Excel import is a later slice and must resolve stable codes rather than free text.

S1B does **not** implement schedule import, unified availability, Excel parsing, a complete SIS, student enrollment, curriculum planning, attendance, or grading.

## 2. Source-of-truth boundary

After the S1B frontend cutover, the six legacy browser-local academic categories must no longer masquerade as production data:

- teacher;
- class;
- subject;
- lesson-hour;
- academic-year;
- semester.

Academic Master Data is owned by Laravel + PostgreSQL. The frontend is only a workflow/presentation client.

The simple reference categories used by Asset/Stock/other unfinished domains are outside this slice and remain quarantined until their own server vertical slices. S1B must not copy browser seed data into PostgreSQL merely to make counts look populated.

## 3. Naming and domain boundaries

### 3.1 Teacher is not User

`Teacher` is a School-owned academic person reference. `User` is a global authentication account.

A Teacher:

- may exist without an account;
- may optionally link to exactly one `SchoolMembership` in the same School;
- never derives academic identity from User name/email;
- never mutates global User fields through Academic Master Data.

An Admin, Technician, Student, or other User may exist without a Teacher record.

### 3.2 Class means class group / rombel

The canonical server entity is called `AcademicClass` rather than relying on SQL/runtime identifiers named only `class`.

It represents a rombel/class group used by schedules and Lab execution, not the complete student roster.

### 3.3 Academic Unit is deliberately generic

SmartLab must not hard-code an SMK-only hierarchy such as `Program Keahlian -> Konsentrasi Keahlian` into every tenant.

A minimal optional `AcademicUnit` hierarchy provides stable references for program/unit classification while remaining usable by different school structures.

Canonical unit types for v1:

- `department`
- `program`
- `concentration`
- `other`

Schools that do not need academic units may leave the relationship null.

### 3.4 Lesson Period belongs to a Bell Schedule Set

The previous product document left open whether Jam Pelajaran should be global or year-specific. S1B resolves this as follows:

> A Lesson Period is never a single mutable global clock slot. It belongs to a stable `LessonPeriodSet` owned by an Academic Year.

Examples:

- `NORMAL` — regular Monday–Thursday clock grid;
- `FRIDAY` — Friday clock grid;
- `RAMADAN` — temporary clock grid for the same Academic Year.

This avoids rewriting historical JP times when school hours change and gives S2 scheduling an explicit stable time-grid reference.

## 4. Canonical entities

Every root entity uses a server-generated ULID primary key, is School-owned, has timestamps, and has an optimistic concurrency `version` beginning at `1`.

### 4.1 AcademicUnit

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School ULID |
| `code` | required immutable stable business code |
| `name` | required display name |
| `type` | `department`, `program`, `concentration`, `other` |
| `parentId` | nullable same-School AcademicUnit ULID |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- `code` unique inside School after canonical normalization;
- parent must belong to the same School;
- parent cannot equal self;
- hierarchy cannot contain a cycle;
- maximum hierarchy depth is 4 in S1B to bound traversal and accidental taxonomy abuse;
- deactivation never cascades into Teacher/Class/Subject rows.

### 4.2 Teacher

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `code` | required immutable stable teacher code |
| `personnelNumber` | nullable code/NIP/NIY-style identifier |
| `name` | required |
| `email` | nullable contact email |
| `phone` | nullable contact phone |
| `academicUnitId` | nullable same-School AcademicUnit |
| `membershipId` | nullable same-School SchoolMembership |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- `code` unique inside School;
- non-null `personnelNumber` unique inside School after normalization;
- a linked membership must belong to the same School;
- one SchoolMembership may link to at most one Teacher in that School;
- Teacher mutation never changes User or SchoolMembership data;
- deactivating a Teacher preserves all schedule/history references.

Schedule-import resolver policy for a Teacher is intentionally bounded:

1. resolve canonical Teacher `code` first;
2. if no code match exists, a nonblank `personnelNumber` may resolve only when it has exactly one same-School match;
3. Teacher `name` is never an import identity key.

### 4.3 AcademicClass

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `code` | required immutable stable class/rombel code |
| `name` | required display name |
| `gradeLevel` | integer `1..20` |
| `academicUnitId` | nullable same-School AcademicUnit |
| `homeroomTeacherId` | nullable same-School Teacher |
| `studentCount` | integer `>= 0` |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Rationale for numeric `gradeLevel`: database identity must not be tied to UI labels `X`, `XI`, `XII`, or a specific Indonesian school level. UI may render a local label, while the stable value remains numeric.

Invariants:

- `code` unique inside School;
- assigned AcademicUnit and Teacher must be same-School;
- assigning a new homeroom Teacher to an active class requires the Teacher to be active;
- later Teacher deactivation does not erase or silently rewrite the class reference;
- no student membership/enrollment rows are introduced in S1B.

### 4.4 Subject

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `code` | required immutable stable subject code |
| `name` | required display name |
| `groupName` | nullable descriptive curriculum group |
| `academicUnitId` | nullable primary/home same-School AcademicUnit |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

`academicUnitId = null` means the Subject is not restricted/classified to one unit by this master record. S1B does not implement a curriculum assignment matrix or many-to-many program curriculum model.

### 4.5 AcademicYear

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `code` | required immutable stable code such as `2026/2027` |
| `name` | required display name |
| `startsOn` | required local calendar date |
| `endsOn` | required local calendar date |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- `code` unique inside School;
- `startsOn <= endsOn`;
- two **active** Academic Years in the same School may not overlap by date;
- `current` is derived from School-local date and the date range; it is not persisted as another source of truth;
- deactivation does not delete Semesters, LessonPeriodSets, schedules, or history.

### 4.6 Semester

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `academicYearId` | immutable parent AcademicYear |
| `code` | required stable code within Academic Year, e.g. `GASAL` |
| `name` | required display name |
| `startsOn` | required date |
| `endsOn` | required date |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- parent Academic Year belongs to same School;
- `(academicYearId, code)` unique;
- Semester dates must be entirely inside the Academic Year range;
- active Semesters under the same Academic Year may not overlap;
- Semester code is resolved together with Academic Year code during future schedule import.

### 4.7 LessonPeriodSet

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `academicYearId` | immutable parent AcademicYear |
| `code` | required stable code inside Academic Year |
| `name` | required display name |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- `(academicYearId, code)` unique;
- parent Academic Year is same-School;
- the set is a versioned/reference time grid, not a weekday schedule itself;
- multiple sets may be active in one Academic Year because S2 may choose them by weekday/date policy.

### 4.8 LessonPeriod

| Field | Contract |
| --- | --- |
| `id` | immutable ULID |
| `schoolId` | immutable owning School |
| `lessonPeriodSetId` | immutable parent LessonPeriodSet |
| `code` | required stable code in the set, e.g. `JP01` |
| `sequence` | positive integer ordering value |
| `startsAt` | local wall-clock time |
| `endsAt` | local wall-clock time |
| `kind` | `instruction` / `break` |
| `status` | `active` / `inactive` |
| `version` | positive integer |
| timestamps | server-owned |

Invariants:

- `(lessonPeriodSetId, code)` unique;
- `(lessonPeriodSetId, sequence)` unique;
- `startsAt < endsAt`;
- time ranges inside one set may touch but may not overlap;
- a break is a first-class period and is never inferred from missing sequence numbers;
- future schedule allocation may reference instruction periods only unless its domain contract explicitly allows another kind.

## 5. Stable code contract

All academic business codes:

- are required except `Teacher.personnelNumber`;
- are trimmed and normalized to uppercase before validation/storage;
- use a bounded portable character set suitable for Excel matching: letters, digits, `.`, `_`, `/`, and `-`;
- are never resolved by display name;
- are not mutable through generic PATCH in S1B.

Suggested canonical pattern:

`^[A-Z0-9][A-Z0-9._/-]{0,63}$`

Internal ULID remains the canonical relational identifier. Business code is the stable human/import key.

If a future product requirement needs code renaming after downstream references/import history exist, it must use an explicit audited rename/alias design. S1B must not silently mutate a code and break import replay.

## 6. Normalization

Before validation:

- codes: trim, uppercase;
- names/group labels: trim + Unicode NFC;
- email: trim + lowercase;
- nullable text: trim, blank -> null;
- dates: strict `YYYY-MM-DD` API representation;
- times: strict `HH:MM:SS` API representation;
- ULIDs: canonical lowercase/string validation according to repository convention.

Normalization happens before no-op comparison.

## 7. Lifecycle and deletion policy

S1B exposes no hard-delete endpoint for Academic Master Data.

`active -> inactive` is a normal audited update. `inactive -> active` is allowed only when all current invariants are valid again.

Deactivation:

- never cascades;
- never deletes historical references;
- prevents the entity from becoming a **new** operational assignment candidate where future domain rules require active references;
- does not make old schedules/reports unreadable.

Frontend actions must say **Nonaktifkan/Aktifkan**, not pretend a row was deleted.

## 8. Tenant isolation

Every query begins inside the active `CurrentMembershipContext.school_id`.

Rules:

- School is never client-selectable in request bodies;
- cross-School IDs never pass relationship validation;
- GET/PATCH for an entity outside the active School returns the same safe 404 as an unknown identifier;
- nested/foreign relationship failures must not disclose another School's data;
- all uniqueness rules are School-scoped unless explicitly parent-scoped above.

## 9. Authorization

S1B introduces server permissions:

- `master-data.view`
- `master-data.create`
- `master-data.update`

There is deliberately no `master-data.delete` server capability in S1B.

Initial role direction:

| Role | view | create | update |
| --- | --- | --- | --- |
| Super Admin | yes | yes | yes |
| Admin Lab | yes | yes | yes |
| Kepala Lab | yes | no | no |
| Others | no administration-page authority by default | no | no |

Future operational candidate endpoints (schedule teacher/class/subject selectors) must use their own operational permission boundary and must not force ordinary schedule users to possess `master-data.view` merely to select an eligible reference.

## 10. Optimistic concurrency

Every root Academic Master row has `version >= 1`.

PATCH requires exactly one strong `If-Match: "<version>"` value.

- missing/malformed precondition -> 428 `PRECONDITION_REQUIRED`;
- syntactically valid stale version -> 412 domain version conflict;
- meaningful update -> version increments exactly once;
- canonical no-op -> version, `updatedAt`, ETag, and event history remain unchanged.

GET detail/create/update responses expose a strong ETag equal to the entity version.

List responses include `version` in each DTO but do not require ETags per row.

## 11. Audit contract

Material Academic Master mutations write immutable `academic_master_events` in the same transaction.

Minimum event fields:

- `id` ULID;
- `school_id`;
- `entity_type`;
- `entity_id_snapshot`;
- `entity_code_snapshot`;
- `actor_user_id_snapshot`;
- `actor_membership_id_snapshot`;
- `actor_name_snapshot`;
- `event_type`;
- typed JSON payload;
- `entity_version_before`;
- `entity_version_after`;
- `created_at`.

Initial event types:

- `academic_master.created`
- `academic_master.updated`
- `academic_master.deactivated`
- `academic_master.reactivated`

The payload validator must reject event/entity combinations outside the locked schema.

Audit insertion failure rolls back the domain mutation. Effective no-ops write no event.

## 12. API shape

The canonical v1 namespace is `/api/v1/master-data`.

Initial resources:

- `GET|POST /academic-units`
- `GET|PATCH /academic-units/{id}`
- `GET|POST /teachers`
- `GET|PATCH /teachers/{id}`
- `GET|POST /classes`
- `GET|PATCH /classes/{id}`
- `GET|POST /subjects`
- `GET|PATCH /subjects/{id}`
- `GET|POST /academic-years`
- `GET|PATCH /academic-years/{id}`
- `GET|POST /semesters`
- `GET|PATCH /semesters/{id}`
- `GET|POST /lesson-period-sets`
- `GET|PATCH /lesson-period-sets/{id}`
- `GET|POST /lesson-periods`
- `GET|PATCH /lesson-periods/{id}`

List endpoints are paginated and support bounded literal `search`, `status`, and relevant parent/unit filters.

Unknown query/body fields are rejected.

No endpoint accepts `schoolId` as mutable input.

## 13. Deterministic ordering

Server list ordering must be deterministic so Excel preview and UI do not reshuffle equal names:

- Units, Teachers, Classes, Subjects, Academic Years: normalized `code`, then ULID;
- Semesters: `startsOn`, then code, then ULID;
- LessonPeriodSets: code, then ULID;
- LessonPeriods: sequence, then code, then ULID.

## 14. Future schedule import resolver contract

S1B only creates the references; it does not parse Excel.

S2/import code must resolve at minimum:

| Import concept | Stable resolver |
| --- | --- |
| Academic Year | School + AcademicYear.code |
| Semester | AcademicYear.id + Semester.code |
| Laboratory | School + Laboratory.code (already canonical) |
| Class | School + AcademicClass.code |
| Teacher | School + Teacher.code; bounded personnelNumber fallback |
| Subject | School + Subject.code |
| JP | LessonPeriodSet.id + LessonPeriod.code |

Names are display/snapshot values only and never primary import matching keys.

## 15. Cross-entity mutation rules

A mutation assigning or replacing a foreign reference must lock/validate the current-School target in the same transaction.

For new active relationships:

- active AcademicClass -> newly assigned homeroom Teacher must be active;
- active Teacher/Class/Subject -> newly assigned AcademicUnit must be active;
- active Semester/LessonPeriodSet -> parent AcademicYear must be active;
- active LessonPeriod -> parent LessonPeriodSet must be active.

Later deactivation of a referenced parent does not cascade or silently mutate children. It may prevent new operational scheduling until configuration is corrected.

## 16. Database constraints vs service invariants

Database constraints should enforce what is safely expressible on both PostgreSQL and test SQLite where practical:

- ULID PK/FK;
- same-table/parent foreign keys;
- unique normalized codes;
- parent-scoped unique code/sequence keys;
- nonnegative/simple scalar checks when portable.

Service-level locked transactions enforce:

- same-School foreign ownership where redundant School IDs exist;
- academic-unit cycle/depth rules;
- active-year overlap;
- semester containment/overlap;
- lesson-period time overlap;
- linked membership belongs to same School;
- status-dependent active-reference eligibility;
- stale version rejection;
- audit atomicity.

## 17. Migration and local prototype policy

S1B must not automatically migrate current browser seed/local AppDB records.

Reason:

- local rows use weak generic `{id, category, name, code}` shape;
- they do not contain the required typed academic fields;
- silently promoting them would create false production truth.

For development/UAT, canonical records are created explicitly through seed fixtures dedicated to tests or through the server UI/API.

Existing browser-local Schedule/Session/Journal rows remain legacy until their own source-of-truth slices. S1B does not invent foreign-key mappings for free-text historical prototype rows.

## 18. Frontend cutover requirements

When S1B reaches the web layer:

- `/master-data` academic categories read only from Academic Master API;
- academic counts come only from API results/meta;
- forms become entity-specific rather than generic Name/Code only;
- hard-delete UI for academic entities is removed;
- stale 412 is surfaced as a reload/review conflict, not overwritten;
- inactive refs remain visible when viewing existing relationships;
- browser local seed must not reappear after reload/storage changes;
- Laboratory remains a canonical link to the existing Laboratory page/API, not duplicated as another master table.

## 19. Explicit non-goals

S1B does not implement:

- Student master/enrollment roster;
- curriculum/version packages;
- teacher workload;
- room timetable rules;
- subject-to-class curriculum assignment;
- Excel upload/import engine;
- schedule rows/occurrences;
- calendar closures;
- attendance;
- grades;
- SIS/Dapodik replacement;
- code-alias/rename workflow;
- hard delete;
- tenant-global User management.

## 20. Acceptance gates

### A. Identity and tenant safety

- all server IDs are ULIDs generated server-side;
- every entity is School-owned;
- cross-School detail/update is safe 404;
- cross-School relationship assignment is rejected without disclosure;
- Teacher optional membership link is same-School only and never mutates User.

### B. Stable identity

- code normalization occurs before uniqueness validation;
- duplicate canonical codes cannot exist in one scope;
- generic PATCH cannot change a business code;
- names may change without changing relational identity;
- future resolver keys are documented and tested.

### C. Lifecycle/history

- no hard-delete route exists;
- deactivate/reactivate is audited;
- references survive parent deactivation;
- historical reads never depend on active status.

### D. Concurrency

- PATCH requires strong If-Match;
- stale versions return 412 before mutation;
- meaningful update increments exactly once;
- normalized no-op preserves version, updatedAt, ETag, and event history.

### E. Date/time integrity

- invalid Academic Year range rejected;
- overlapping active Academic Years rejected;
- Semester must be inside its Academic Year;
- overlapping active Semesters rejected;
- LessonPeriod times cannot overlap inside one set;
- code/sequence uniqueness is parent-scoped.

### F. Audit

- create/effective update/status changes append exactly one typed event;
- no-op appends zero events;
- audit failure rolls back mutation;
- actor and entity snapshots remain sufficient for later Audit Log projection.

### G. Authorization

- backend permissions are exact and tested;
- frontend permission guards are not trusted as security boundaries;
- no delete capability is accidentally granted.

### H. Frontend source of truth

- the six academic master categories no longer use `useAppData`/`masterDataRepository` for authority;
- no seed-derived academic counts are displayed as server facts;
- browser reload preserves canonical state because PostgreSQL is authoritative.

### I. Contract/CI

Before merge of each implementation slice:

- OpenAPI reflects the implemented endpoints and error codes;
- PostgreSQL migration + seed gate passes;
- portable API test suite passes;
- web lint/typecheck/Vitest/build pass for web-changing slices;
- review threads are resolved;
- exact-head merge guard is used.

## 21. Recommended implementation slicing

To keep reviewable PRs and dependency order:

### S1B-1 — Academic period and time-grid foundation

- schema/event foundation;
- AcademicYear;
- Semester;
- LessonPeriodSet;
- LessonPeriod;
- RBAC and backend tests;
- OpenAPI for this surface.

### S1B-2 — Academic directory

- AcademicUnit;
- Teacher;
- AcademicClass;
- Subject;
- same-School relationship invariants;
- backend tests and OpenAPI extension.

### S1B-3 — Master Data frontend cutover

- typed API client/parsers;
- canonical `/master-data` Academic UI;
- remove academic AppDB authority and hard-delete actions;
- source-of-truth regression tests;
- browser UAT.

Only after S1B is green should S2 schedule import/unified availability rely on these identifiers.
