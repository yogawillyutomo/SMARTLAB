# Incident Domain Contract RFC

Status: Proposed — Pending Independent Review

Scope: Incident v1 architecture and implementation contract only. This document does not implement backend, frontend, OpenAPI, permissions, migrations, Work Order, notifications, or reporting.

Canonical base: `eaf7ec358d391c7493706f51ad17e01e41fdbdae` (`feat(web): integrate device transfers (#35)`)

## 1. Decision summary

An Incident is a School-owned report of an operational problem or abnormal condition observed in one Laboratory, optionally involving one canonical Device. It owns report identity, reporter evidence, subject snapshots, operational priority, triage, accountable assignment, lifecycle, append-only comments, verification, closure, and immutable domain history.

Incident v1 makes these decisions:

- School and reporter identity are derived from the authenticated active `SchoolMembership`; clients cannot supply either authority.
- A new Incident requires one active same-School Laboratory. A Device is optional and, when present, must be an eligible same-School Device whose home Laboratory matches the reported Laboratory.
- The report subject is correctable only while `reported`, only through generic PATCH by `incidents.update`, and freezes after triage.
- Reporter, Laboratory, Device, assignee, and actor display evidence is snapshotted so later rename, deactivation, retirement, or deletion cannot rewrite history.
- `incidents.view` grants access to records visible under row policy; proposed `incidents.view-all` expands visibility to all Incidents in the active School. Without it, a caller sees only Incidents reported by the same User.
- Proposed `incidents.comment` is separate from `incidents.update`. Comments are bounded, append-only `incident.comment_added` events and have no edit/delete operation.
- The lifecycle is `reported`, `triaged`, `assigned`, `in_progress`, `resolved`, `verified`, `closed`, or `rejected`. `closed` and `rejected` are terminal. Waiting for spare parts is Work Order-owned and is not an Incident status.
- Assignment targets an active same-School membership whose active User has effective `incidents.update`. It is capability-driven, not role-name-driven.
- Technician-style progress transitions require the actor to be the current assignee or to hold `incidents.assign` as an administrative override, in addition to `incidents.update`.
- The aggregate has one positive integer `version`. Every post-create mutation requires strong `If-Match: "<version>"`; meaningful commits increment once and append exactly one typed Incident event.
- Effective no-ops preserve `version`, ETag, `updatedAt`, and event history.
- Incident v1 has no hard delete, no general idempotency key, and no automatic replay after an ambiguous mutation outcome.
- Incident and Work Order are separate aggregates. Future Work Orders own nullable `incident_id`; one Incident may have zero to many Work Orders.

## 2. Existing implementation audit

The current React Incident page is a local prototype and is not canonical authority. Its useful product signals are title, description, impact, priority, Laboratory context, triage, assignment, comments, timeline, and reporter-facing creation. The following prototype behaviors are explicitly rejected as backend architecture:

- `reporterName` and `assignedTechnician` as free text;
- `INC-2026-{array length + 1}` ticket numbering;
- local `Date.now()` identity;
- client-local duplicate-title detection as a persistence rule;
- unrestricted local arrays for comments and timeline;
- a single `incident.workOrderId` relationship;
- Incident status `Menunggu Spare Part`;
- repair diagnosis, action, parts, cost, and technician execution inside Incident;
- hard-delete UI and a nonexistent `incidents.delete` permission;
- AppDB Laboratory, Device, Asset, and Work Order identifiers as canonical backend IDs.

The current backend establishes the conventions retained here:

- ULID model identities and School tenant ownership;
- one active membership in one active School resolved by `ResolveCurrentMembershipContext`;
- exact permission middleware with no controller role-name fallback;
- server-derived `school_id` and actor identity;
- `{ "data": ... }` envelopes and stable `{message, code}` errors;
- camelCase API fields, strict unknown-field rejection, and bounded page-number pagination;
- tenant-leading queries and safe not-found behavior;
- strong quoted integer ETags and required `If-Match` preconditions;
- transactional aggregate version increments and append-only typed domain events;
- deterministic ordering with an ID tie-breaker;
- the repository lock family Laboratory -> Layout -> Device.

The field-by-field disposition is defined in [incident-domain-field-classification.md](incident-domain-field-classification.md).

## 3. Aggregate boundary

Incident owns:

- Incident identity and human ticket number;
- reporter User and membership evidence;
- required Laboratory subject and optional Device subject;
- category, operational priority, title, description, impact, blocking flag, observed time, and steps already taken;
- triage summary;
- current accountable assignee;
- Incident lifecycle and lifecycle timestamps;
- rejection, resolution, reopen, and verification explanations;
- append-only comments;
- one aggregate version and immutable `IncidentEvent` history.

Incident does not own:

- diagnosis, repair actions, technician execution, schedules, repair start/end, spare parts, cost, repair tests, or waiting-part state;
- Device lifecycle, technical profile, home Laboratory, Layout placement, current location, Transfer, Loan custody, or telemetry;
- Asset accounting, procurement, warranty, condition, depreciation, or disposal;
- notification delivery, QR flows, Maintenance execution, or Work Order lifecycle;
- duplicate-title suppression or automatic telemetry-alert creation.

## 4. Canonical aggregate fields

The proposed `incidents` aggregate contains:

| Field | Required | Authority | Mutability |
| --- | --- | --- | --- |
| `id` | yes | server ULID | immutable |
| `school_id` | yes | active membership context | immutable |
| `ticket_year` | yes | server UTC clock | immutable |
| `ticket_sequence` | yes | locked School/year sequence | immutable |
| `ticket_number` | yes | server formatter | immutable |
| `reporter_user_id` | nullable live FK | authenticated User | immutable |
| `reporter_membership_id` | nullable live FK | active membership | immutable |
| reporter User/membership ID and name snapshots | yes | authenticated context at report time | immutable |
| `laboratory_id` | nullable live FK | validated report subject | correctable only while `reported` |
| Laboratory ID/code/name snapshots | yes | Laboratory at report/correction time | same correction boundary |
| `device_id` | nullable live FK | validated optional Device | correctable only while `reported` |
| Device ID/code/type snapshots | nullable as a set | Device at report/correction time | same correction boundary |
| `category` | yes | create/PATCH allowlist | mutable only while `reported` |
| `priority` | yes | create/PATCH/triage command | PATCH only while `reported`; triage may finalize atomically |
| `title` | yes | create/PATCH allowlist | mutable only while `reported` |
| `description` | yes | create/PATCH allowlist | mutable only while `reported` |
| `impact` | no | create/PATCH/triage command | mutable while `reported`; triage may finalize atomically |
| `blocks_laboratory_operation` | yes | create/PATCH/triage command | mutable while `reported`; triage may finalize atomically |
| `steps_taken` | no | create/PATCH allowlist | mutable only while `reported` |
| `occurred_at` | yes | client observation time | mutable only while `reported` |
| `status` | yes | transition/assignment commands | never generic PATCH |
| `assignee_membership_id` and current assignee snapshot | no | assignment command | assignment command only |
| `triage_summary` | no until triaged | triage transition | transition command only |
| `resolution_summary` | no until resolved | resolve transition | transition command only; cleared on reopen |
| `rejection_reason` | no until rejected | reject transition | transition command only |
| `verification_note` | no until verified | verify transition | transition command only; cleared on reopen |
| lifecycle timestamps | state-dependent | server clock | transition/assignment commands only |
| `reported_at` | yes | server clock | immutable |
| `version` | yes, starts at 1 | aggregate transaction | server increment only |
| `created_at`, `updated_at` | yes | server | server-managed |

Live foreign keys support current joins but are not historical display authority. Historical snapshot fields remain required even if a referenced User, membership, Laboratory, or Device is later renamed, deactivated, retired, decommissioned, or removed under a future retention policy.

## 5. Stable API enums and bounds

Incident category keys are:

`hardware`, `software`, `network`, `electrical`, `peripheral`, `facility`, `cleanliness`, `security`, `other`.

Priority keys are:

`low`, `normal`, `high`, `critical`.

Lifecycle keys are:

`reported`, `triaged`, `assigned`, `in_progress`, `resolved`, `verified`, `closed`, `rejected`.

Indonesian labels are presentation mappings and are never persisted enum authority. Suggested mappings include `network -> Jaringan`, `electrical -> Listrik`, `peripheral -> Periferal`, `low -> Rendah`, `critical -> Kritis`, and the lifecycle mapping recorded in the task brief.

Bounds:

- `title`: trimmed, 5-200 characters;
- `description`: trimmed, 10-4,000 characters;
- `impact`, `stepsTaken`, `triageSummary`, and `verificationNote`: nullable after trim, maximum 2,000 characters, except `triageSummary` and `verificationNote` become required for their transitions;
- `resolutionSummary`: required for resolve, 5-4,000 characters;
- rejection, reassignment, and reopen reasons: required where specified, 5-1,000 characters;
- comment text: trimmed, 1-2,000 characters;
- `occurredAt`: RFC 3339 date-time no later than five minutes after server receipt time;
- search: trimmed 2-100 characters;
- pagination: `page >= 1`, `perPage` default 25 and maximum 100, except Device reporting discovery maximum 20.

V1 uses the closed category enum directly. The local `incident-category` Master Data collection is not a backend dependency.

## 6. Reporter authority and own-record visibility

Create derives reporter evidence from the authenticated User and current active membership. Payloads containing `schoolId`, reporter IDs, reporter name, reporter membership, status, assignee, version, ticket number, timestamps, or history are rejected with `422 VALIDATION_FAILED`.

Every Incident read starts with `school_id = currentSchoolId` and the row-visibility predicate:

- with `incidents.view-all`: all Incident rows in the active School are visible;
- without `incidents.view-all`: only rows whose immutable `reporter_user_id_snapshot` equals the authenticated User ID are visible.

Using the User snapshot rather than the live membership ID preserves ownership when the same User receives a replacement membership in the same School. Access still requires one current active membership and `incidents.view`. An unknown, cross-School, or non-visible Incident identifier returns the same `404 INCIDENT_NOT_FOUND` response.

Row visibility applies to detail, PATCH, assignment, transition, comment, and event history. Action permission never expands row visibility. Controllers and policies must not hardcode role names.

## 7. Permission model

The existing permissions remain unchanged in meaning. This RFC proposes exactly two additions:

- `incidents.view-all`: expand `incidents.view` from own-reported records to every Incident in the active School;
- `incidents.comment`: append a comment to a visible non-terminal Incident.

Final proposed grants for the later backend PR:

| Role | view | create | update | approve | assign | export | view-all | comment |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `admin-lab` | yes | yes | yes | no | yes | yes | yes | yes |
| `kepala-lab` | yes | no | no | yes | no | yes | yes | yes |
| `teknisi` | yes | no | yes | no | no | no | yes | yes |
| `guru` | yes | yes | no | no | no | no | no | yes |
| `ketua-kelas` | yes | yes | no | no | no | no | no | yes |
| `siswa` | yes | yes | no | no | no | no | no | yes |
| `pimpinan` | yes | no | no | no | no | yes | yes | no |
| `super-admin` | yes | yes | yes | yes | yes | yes | yes | yes |

Super Admin receives explicitly catalogued permissions through the seeder convention; there is no role-name or wildcard authorization fallback. `incidents.export` remains catalogued but has no Incident v1 endpoint. Export is deferred to a reporting slice that can define redaction, row scope, limits, and asynchronous delivery.

## 8. Reporting discovery boundary

Users with `incidents.create` do not require `laboratories.view` or `devices.view`. Incident v1 provides two narrow, read-only reporting discovery endpoints registered before `/incidents/{incidentId}`:

| Endpoint | Permission | Projection |
| --- | --- | --- |
| `GET /api/v1/incidents/reporting-context/laboratories` | `incidents.create` | active same-School Laboratory `id`, `code`, `name` |
| `GET /api/v1/incidents/reporting-context/laboratories/{laboratoryId}/devices` | `incidents.create` | eligible Devices homed in that Laboratory: `id`, `deviceCode`, `deviceType` |

Laboratories are paginated and ordered by normalized `code ASC, id ASC`; optional search matches code/name. The Device endpoint requires a selected active Laboratory and a 2-100 character `search` matching normalized `deviceCode`; it returns at most 20 rows ordered by `deviceCode ASC, id ASC`. It never supports unfiltered inventory browsing.

These projections do not expose serial number, hostname, QR public identity, technical profile, telemetry, Layout placement, Asset data, current location, lifecycle detail, user data, or counts. Device candidates are limited to `in_service` and `spare` Devices whose `home_laboratory_id` equals the selected Laboratory. A caller may omit Device and report a Laboratory-level Incident. Raw ULID entry is not a supported UI path, but direct API create still revalidates every identifier and eligibility rule.

## 9. Laboratory and Device subject policy

Create and reported-state subject correction require:

- Laboratory exists in the active School and has status `active`;
- optional Device exists in the active School;
- Device lifecycle is `in_service` or `spare`;
- Device `homeLaboratoryId` equals the selected Laboratory.

An inactive Laboratory cannot receive a new Incident. An Incident remains readable, assignable, progressable, commentable, resolvable, verifiable, and closable if its Laboratory later becomes inactive.

An Incident remains manageable if its referenced Device later becomes `retired` or `decommissioned`. Those lifecycle changes do not mutate Incident status, subject snapshots, assignment, or history. Incident never mutates Device or Laboratory.

Subject Laboratory and Device may be corrected only while status is `reported`, through PATCH with `incidents.update` and matching `If-Match`. After triage, subject identity and snapshots freeze. If a post-triage report is discovered to name the wrong subject, staff create a correct replacement Incident, add a comment on the original identifying the replacement ticket, and resolve the original with an explicit administrative resolution summary. The original historical subject is not rewritten.

## 10. Lifecycle and transition authority

The exact graph is:

| From | To | Exact permission | Additional rule | Required command data |
| --- | --- | --- | --- | --- |
| `reported` | `triaged` | `incidents.approve` | visible record | `triageSummary`; optional finalized priority/impact/blocking flag |
| `reported` | `rejected` | `incidents.approve` | visible record | `reason` |
| `triaged` | `assigned` | `incidents.assign` | assignment command only | eligible `assigneeMembershipId`; optional reason |
| `triaged` | `resolved` | `incidents.approve` | simple issue resolved during triage | `resolutionSummary` |
| `assigned` | `in_progress` | `incidents.update` | actor is assignee or also has `incidents.assign` | no data |
| `assigned` | `resolved` | `incidents.update` | same ownership rule | `resolutionSummary` |
| `in_progress` | `resolved` | `incidents.update` | same ownership rule | `resolutionSummary` |
| `resolved` | `verified` | `incidents.approve` | visible record | `verificationNote` |
| `resolved` | `in_progress` | `incidents.approve` | failed verification/reopen | `reason` |
| `verified` | `closed` | `incidents.approve` | visible record | no data |

No other edge exists. `closed` and `rejected` reject PATCH, assignment, transition, and comment commands. A closed Incident cannot reopen in v1.

`reported -> triaged` may finalize `priority`, `impact`, and `blocksLaboratoryOperation` atomically with one `incident.triaged` event and one version increment. It cannot change subject, title, description, category, steps taken, or occurrence time. Reopen clears current `resolutionSummary`, `resolvedAt`, `verificationNote`, and `verifiedAt`; the prior evidence remains in immutable events.

## 11. Assignment semantics

Assignment uses `POST /api/v1/incidents/{incidentId}/assignments` and never generic PATCH or the transition endpoint.

An eligible assignee membership:

- belongs to the active School;
- has `status = active`;
- belongs to a User with `status = active`;
- has effective `incidents.update` at assignment time.

Initial assignment is allowed only from `triaged`; it atomically sets assignee and status `assigned`. Reassignment is allowed only while `assigned` or `in_progress`; status remains unchanged. Reassignment requires a reason. V1 has no unassignment. Assigning the same current membership is an effective no-op, even if a reason is supplied.

If the assignee later becomes inactive or loses `incidents.update`, historical snapshots remain readable and the Incident remains assigned. That membership cannot progress the Incident through middleware/policy. An actor with `incidents.assign` reassigns it to an eligible membership.

The candidate endpoint is:

`GET /api/v1/incidents/assignee-candidates?search=&page=&perPage=`

It requires `incidents.assign`, returns only active eligible same-School memberships, and exposes `{membershipId, user: {id, name}}`. It does not expose email, phone, NIP/NIS, role names, or unrelated permissions. Ordering is normalized User name ascending, then membership ID ascending. Search is optional, bounded, and matches User name only.

## 12. Comment decision

V1 adopts comments through `incidents.comment`.

- Caller must pass normal authentication, active membership, exact permission, and Incident row visibility.
- Comment body is server-trimmed, nonblank, and at most 2,000 characters.
- Comments are allowed in every non-terminal status.
- Comment actor is server-derived and snapshotted.
- Comment text cannot be edited or deleted.
- There is no `incident_comments` mutable aggregate and no independent comment version.
- The `incident.comment_added` event is the canonical comment record; its event ID is the comment ID.
- A meaningful comment increments Incident version once and appends exactly one event in the same transaction.

Comments are read through the event history endpoint. The Incident DTO does not embed an unbounded comment array.

## 13. Ticket numbering

Ticket numbers are server-generated and unique within a School. Format:

`INC-{UTC_YEAR}-{SIX_DIGIT_SEQUENCE}`

Example: `INC-2026-000123`.

The database has `incident_number_sequences(school_id, ticket_year, last_value)` with a unique `(school_id, ticket_year)` key. During Incident create, inside the same transaction:

1. Validate and lock the Laboratory and optional Device under the repository lock order.
2. `INSERT ... ON CONFLICT DO NOTHING` the School/year sequence row.
3. `SELECT ... FOR UPDATE` that exact row.
4. Reject exhaustion above 999,999 with `409 INCIDENT_TICKET_SEQUENCE_EXHAUSTED`.
5. Increment `last_value`, format the ticket, and insert the Incident plus `incident.reported` event.
6. Commit all changes together; rollback returns the sequence increment.

Database uniqueness covers `(school_id, ticket_year, ticket_sequence)` and `(school_id, ticket_number)`. The client cannot supply or reserve a number. Neither `count()+1` nor timestamps participate in numbering. Numbers are immutable and are not globally unique outside their School context.

## 14. Concurrency and precondition precedence

Create starts at version 1 and emits `ETag: "1"`. Detail and every successful post-create mutation emit `ETag: "<version>"`. List items expose `version` but the collection has no aggregate ETag.

Every PATCH, assignment, transition, and comment command requires exactly one strong quoted positive integer:

`If-Match: "<version>"`

Weak, wildcard, unquoted, comma-separated, whitespace-padded, zero, negative, missing, or malformed forms return `428 PRECONDITION_REQUIRED`. A syntactically valid stale value returns `412 INCIDENT_VERSION_CONFLICT`.

Request precedence is:

1. Sanctum authentication;
2. active membership and School context;
3. exact route permission;
4. `If-Match` syntax for mutations;
5. structural request validation, including unknown fields;
6. tenant and row-visible Incident lookup;
7. locked Incident version;
8. status, transition, assignment ownership, and eligibility rules.

No command introduces a child aggregate version. Every meaningful commit changes the Incident and writes exactly one IncidentEvent in one transaction. A failed event insert rolls back the aggregate change.

## 15. Effective no-op policy

Generic PATCH normalizes strings, nullable blanks, enums, booleans, and timestamps before comparison. If every allowed field is canonically equal, it returns HTTP 200 with the current Incident DTO and ETag while preserving `version`, `updatedAt`, and history.

Assigning the current assignee is also an effective no-op. Status transitions and comments cannot be no-ops: a same-status or unsupported transition returns `INCIDENT_INVALID_TRANSITION`, and a blank comment fails validation.

Even an effective no-op requires a current matching `If-Match`. Stale no-op submissions return 412.

## 16. Ambiguous mutation and retry policy

Incident v1 has no general idempotency key and clients never automatically replay an ambiguous mutation.

For a lost PATCH, assignment, transition, or comment response, the frontend must GET the canonical Incident and GET event history before allowing another mutation. If the first command committed, a manual repeat with its old `If-Match` fails 412 and writes no duplicate event. If reconciliation cannot establish the outcome, the UI remains explicitly unconfirmed.

Create also has no automatic replay. After a lost create response, the reporter refreshes the own-visible Incident list and reconciles using canonical ticket, subject, occurrence time, and title evidence before a manual resubmission. The server does not treat equal titles as duplicates because distinct operational reports can legitimately share text.

Recovery actions issue GET requests only. Authentication or membership recovery never replays a mutation.

## 17. IncidentEvent history

`IncidentEvent` is append-only domain history with:

- ULID `id`, `school_id`, nullable live `incident_id`, and immutable `incident_id_snapshot`/`ticket_number_snapshot`;
- nullable live actor User/membership IDs plus immutable actor User ID, membership ID, and name snapshots;
- closed `event_type` string;
- `incident_version_before` and `incident_version_after`, where after equals before + 1;
- typed JSON payload validated by event type;
- immutable `created_at`.

Event types and payload ownership:

| Event | Required payload |
| --- | --- |
| `incident.reported` | complete initial report and subject snapshots; version 0 -> 1 |
| `incident.updated` | sorted changed field names and normalized before/after values |
| `incident.triaged` | triage summary and finalized triage fields |
| `incident.assigned` | assignee snapshot and optional reason |
| `incident.reassigned` | previous/new assignee snapshots and required reason |
| `incident.started` | previous and new status |
| `incident.resolved` | resolution summary |
| `incident.reopened` | required reason and cleared current-resolution fields |
| `incident.verified` | verification note |
| `incident.closed` | previous and new status |
| `incident.rejected` | rejection reason |
| `incident.comment_added` | comment text; event ID is comment ID |

Rejected requests, permission failures, stale preconditions, and effective no-ops create no IncidentEvent. Actor snapshots survive rename/deactivation. Subject snapshots survive Laboratory/Device changes.

IncidentEvent is authoritative for domain reconstruction. A future platform audit log may record request-level security metadata and reference `incidentId` plus `incidentEventId`; it must not become a competing mutable Incident history or duplicate unrestricted comment/report payloads.

## 18. REST surface

| Method and path | Permission | If-Match | Result |
| --- | --- | --- | --- |
| `GET /api/v1/incidents/reporting-context/laboratories` | `incidents.create` | no | paginated minimal active Laboratory projection |
| `GET /api/v1/incidents/reporting-context/laboratories/{laboratoryId}/devices` | `incidents.create` | no | searched minimal eligible Device projection |
| `GET /api/v1/incidents/assignee-candidates` | `incidents.assign` | no | paginated minimal eligible membership projection |
| `GET /api/v1/incidents` | `incidents.view` | no | row-scoped paginated Incident collection |
| `POST /api/v1/incidents` | `incidents.create` | no | 201 Incident DTO, ETag `"1"` |
| `GET /api/v1/incidents/{incidentId}` | `incidents.view` | no | visible Incident DTO and ETag |
| `PATCH /api/v1/incidents/{incidentId}` | `incidents.view` + `incidents.update` | yes | reported-state allowlist; 200 Incident DTO |
| `POST /api/v1/incidents/{incidentId}/assignments` | `incidents.view` + `incidents.assign` | yes | initial assignment/reassignment; 200 Incident DTO |
| `POST /api/v1/incidents/{incidentId}/transitions` | `incidents.view` + edge permission | yes | allowed lifecycle edge; 200 Incident DTO |
| `POST /api/v1/incidents/{incidentId}/comments` | `incidents.view` + `incidents.comment` | yes | 201 comment event DTO and aggregate ETag |
| `GET /api/v1/incidents/{incidentId}/events` | `incidents.view` | no | row-scoped paginated immutable events |

Static discovery routes are registered before `{incidentId}`. There is no DELETE, bulk mutation, hard-close shortcut, reopen-closed endpoint, Work Order endpoint, export endpoint, or nested Device/Laboratory general collection.

## 19. Request allowlists

Create accepts exactly:

```json
{
  "laboratoryId": "01J...",
  "deviceId": "01D... or null",
  "category": "hardware",
  "priority": "normal",
  "title": "Desktop cannot boot",
  "description": "The workstation stops before the operating system loads.",
  "impact": "One practicum station is unavailable.",
  "blocksLaboratoryOperation": false,
  "stepsTaken": "Checked power and display cables.",
  "occurredAt": "2026-08-29T03:00:00Z"
}
```

`deviceId`, `impact`, and `stepsTaken` may be null/omitted. `priority` defaults server-side to `normal`; `blocksLaboratoryOperation` defaults false. All other displayed fields are required.

PATCH accepts any nonempty subset of the same report fields only while `reported`. It never accepts School, reporter, ticket, status, assignee, lifecycle timestamps, version, event history, Work Order, Asset, or audit fields.

Assignment accepts exactly `assigneeMembershipId` and optional `reason`; reason is required for reassignment. Transition accepts exactly `toStatus` plus only the data listed for that edge. Comment accepts exactly `text`. Empty objects and unknown fields fail with 422 except assignment-to-current, whose syntactically valid same-assignee payload is a no-op.

## 20. Incident DTO

```json
{
  "id": "01I...",
  "ticketNumber": "INC-2026-000123",
  "reporter": { "userId": "01U...", "name": "Reporter Name" },
  "laboratory": { "id": "01L...", "code": "LAB-RPL-1", "name": "Lab RPL 1" },
  "device": { "id": "01D...", "deviceCode": "PC-0001", "deviceType": "desktop_pc" },
  "category": "hardware",
  "priority": "high",
  "title": "Desktop cannot boot",
  "description": "The workstation stops before the operating system loads.",
  "impact": "One practicum station is unavailable.",
  "blocksLaboratoryOperation": false,
  "stepsTaken": "Checked power and display cables.",
  "status": "assigned",
  "assignee": { "membershipId": "01M...", "userId": "01U...", "name": "Technician Name" },
  "triageSummary": "Hardware investigation required.",
  "resolutionSummary": null,
  "rejectionReason": null,
  "verificationNote": null,
  "version": 3,
  "occurredAt": "2026-08-29T03:00:00Z",
  "reportedAt": "2026-08-29T03:05:00Z",
  "triagedAt": "2026-08-29T03:15:00Z",
  "assignedAt": "2026-08-29T03:20:00Z",
  "startedAt": null,
  "resolvedAt": null,
  "verifiedAt": null,
  "closedAt": null,
  "rejectedAt": null,
  "createdAt": "2026-08-29T03:05:00Z",
  "updatedAt": "2026-08-29T03:20:00Z"
}
```

`device` and `assignee` are null when absent. Snapshot projections are returned; the DTO does not embed live full User, membership, Laboratory, Device, Asset, Work Order, Layout, telemetry, comments, or event arrays.

Comment event DTO is `{id, incidentId, type: "incident.comment_added", actor: {userId, name}, text, incidentVersionBefore, incidentVersionAfter, createdAt}`. Other event DTOs use `{id, incidentId, ticketNumber, type, actor, incidentVersionBefore, incidentVersionAfter, data, createdAt}` with the typed payload defined above.

## 21. List and filter contract

`GET /api/v1/incidents` accepts only:

- `status`, `priority`, `category` as closed enum scalars;
- `laboratoryId`, `deviceId`, `assigneeMembershipId` as syntactically valid ULIDs;
- `reportedFrom`, `reportedTo` as RFC 3339 values with `reportedFrom <= reportedTo`;
- `search`, `page`, and `perPage` within the documented bounds.

The query applies `school_id` and own/view-all row scope before every filter. Valid ULID filters that identify another School or a non-visible association return an empty collection, not existence evidence. Search matches ticket number, title, Laboratory code snapshot, and Device code snapshot. It never searches comment text or unrestricted description/impact fields.

Canonical order is `reportedAt DESC, id DESC`; client-selected sorting is not exposed in v1. Event order is `createdAt DESC, id DESC`. Both collections return exactly `{data, meta: {page, perPage, total, lastPage}}`.

## 22. Error taxonomy

Platform errors remain authoritative:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 401 | `UNAUTHENTICATED` | Sanctum identity missing/invalid |
| 403 | `FORBIDDEN` | exact permission or update-ownership rule fails |
| 409 | `ACTIVE_MEMBERSHIP_REQUIRED` | no active membership in an active School |
| 409 | `SCHOOL_CONTEXT_REQUIRED` | more than one active School context requires selection |
| 422 | `VALIDATION_FAILED` | malformed body/query, unknown fields, enum/bound violations |
| 428 | `PRECONDITION_REQUIRED` | missing/malformed required `If-Match` |

Incident errors:

| HTTP | Code | Meaning |
| --- | --- | --- |
| 404 | `INCIDENT_NOT_FOUND` | unknown, cross-School, or row-invisible Incident |
| 412 | `INCIDENT_VERSION_CONFLICT` | syntactically valid stale Incident version |
| 409 | `INCIDENT_INVALID_TRANSITION` | requested lifecycle edge is not in the graph |
| 404 | `INCIDENT_ASSIGNEE_NOT_FOUND` | assignee membership unknown or outside current School |
| 409 | `INCIDENT_ASSIGNEE_INELIGIBLE` | known membership/User inactive or lacks effective update capability |
| 409 | `INCIDENT_LABORATORY_INELIGIBLE` | Laboratory unknown, cross-School, or inactive for create/correction |
| 409 | `INCIDENT_DEVICE_NOT_ELIGIBLE` | Device unknown, cross-School, wrong home Laboratory, or lifecycle-ineligible |
| 409 | `INCIDENT_STATUS_CONFLICT` | PATCH, assignment, or comment is unavailable in current status |
| 409 | `INCIDENT_TICKET_SEQUENCE_EXHAUSTED` | School/year sequence exceeds six digits |

`INCIDENT_ASSIGNMENT_REQUIRED` is not emitted in v1. Initial assignment atomically sets both assignee and `assigned`, and database/application invariants prohibit an assigned/in-progress Incident without an assignee. A failed update-ownership check returns `FORBIDDEN`; it does not claim the assignee is absent.

## 23. Transaction and lock ordering

Incident extends the repository lock family without changing existing ordering:

1. Laboratory rows, ascending ULID;
2. Layout rows, ascending ULID, when another domain requires them;
3. Device rows, ascending ULID;
4. User rows, ascending ULID;
5. SchoolMembership rows, ascending ULID;
6. one `incident_number_sequences` row;
7. Incident rows, ascending ULID;
8. append-only IncidentEvent insert.

Incident never locks Layout because it neither reads placement eligibility nor mutates Layout. The Layout position in the family is retained for compatibility with existing Transfer/Layout transactions.

Create locks the Laboratory, optional Device, then sequence row before inserting Incident/event. Assignment pre-reads the candidate membership as routing information, locks its User and membership, then locks Incident and revalidates version/status/eligibility. Reported-state subject correction uses a two-phase algorithm: pre-read current subject IDs, lock current/requested Laboratories and Devices in sorted order, then lock Incident, check version first, and revalidate that the pre-read subject still matches. A changed Incident returns 412 rather than acting on stale routing information.

PATCH without subject changes, lifecycle transitions, and comments lock only the Incident row. All mutations insert their event after the aggregate update in the same transaction. Future User/membership and Work Order contracts must extend this family consistently rather than invert it.

## 24. Database integrity proposal

PostgreSQL is canonical; portable SQLite tests reproduce equivalent behavior.

Required protections for the later backend PR:

- ULID primary keys and tenant-leading indexes;
- positive `version` and event before/after checks;
- check constraints for closed status/category/priority strings;
- unique School/year sequence and School/ticket number keys;
- status/assignee consistency: `assigned` and `in_progress` require current assignee fields; other pre-assignment and terminal states follow the transition service;
- state-dependent required timestamps and summaries/reasons;
- bounded snapshot/text columns and JSON payload validation in one application validator;
- restrict School deletion; nullable live User/membership/Laboratory/Device joins use null-on-delete while immutable snapshots remain;
- no cascade from subject records into Incident or IncidentEvent history;
- indexes for `(school_id, reported_at, id)`, reporter scope, status/priority/category, Laboratory/Device/assignee filters, and `(school_id, incident_id_snapshot, created_at, id)` events;
- no Incident hard-delete repository method or HTTP route.

## 25. Work Order boundary

The future cardinality is Incident 1 -> 0..N Work Orders. Work Order owns nullable `incident_id`; Incident has no `workOrderId` column or authoritative Work Order list.

Locked rules:

- Incident creation, triage, assignment, progress, resolution, verification, and closure do not require a Work Order in v1.
- Creating a Work Order does not silently rewrite Incident status, assignee, version, or history.
- Incident does not own repair diagnosis, repair action, execution technician, schedule, start/end repair time, spare parts, cost, waiting-part state, or repair test results.
- A future Work Order may snapshot Incident identity and subject while keeping its own aggregate version and history.
- Any future rule preventing Incident resolution/verification while Work Orders are active requires a reviewed Work Order orchestration contract and deterministic cross-aggregate lock order.
- Multiple Work Orders may address separate repair attempts for one Incident; no single-link shortcut is introduced.

No Work Order table, model, API, permission change, frontend flow, or status automation belongs to this architecture PR.

## 26. No-delete and retention decision

Incident v1 exposes no hard delete or soft-delete operation. Closed and rejected records remain queryable under normal row visibility and retention. Comments/events are immutable. The local delete UI has no canonical authority and there is no `incidents.delete` permission.

Privacy erasure, legal retention, or archival deletion requires a separate reviewed retention contract that preserves tenant isolation, event evidence, and referential integrity. It cannot be inferred from `incidents.update`, `incidents.approve`, or Super Admin role names.

## 27. Adversarial implementation matrix

| # | Scenario | Expected result |
| --- | --- | --- |
| 1 | Unknown Incident ID | 404 `INCIDENT_NOT_FOUND` |
| 2 | Cross-School Incident ID | same 404; no existence disclosure |
| 3 | Own-only caller requests another reporter's Incident | same 404 |
| 4 | Create with cross-School Laboratory | 409 `INCIDENT_LABORATORY_INELIGIBLE`; no report/sequence/event commit |
| 5 | Create with cross-School Device | 409 `INCIDENT_DEVICE_NOT_ELIGIBLE`; no disclosure |
| 6 | Assignment with cross-School membership | 404 `INCIDENT_ASSIGNEE_NOT_FOUND` |
| 7 | Student creates a Laboratory-only Incident | 201; server reporter; version 1; one reported event |
| 8 | Student lists Incidents | only same reporter User snapshots returned |
| 9 | Student requests another student's Incident directly | 404 |
| 10 | Pimpinan lists Incidents | read all in School through view-all; no mutation permission |
| 11 | Teknisi progresses their own assigned Incident | allowed with current ETag |
| 12 | Teknisi progresses another technician's assignment | 403; no version/event |
| 13 | Admin Lab progresses another assignee's Incident | allowed because update + assign override |
| 14 | Kepala Lab triages/rejects/verifies/closes | allowed only on exact graph edges |
| 15 | `incidents.create` without Laboratory/Device general view | reporting-context works; general inventories remain forbidden |
| 16 | Direct create submits raw foreign IDs not returned by discovery | same tenant/eligibility validation; cannot bypass boundary |
| 17 | Active Laboratory create | allowed |
| 18 | Inactive Laboratory create | 409 Laboratory ineligible |
| 19 | Device omitted | valid Laboratory-level Incident |
| 20 | In-service Device homed in selected Laboratory | allowed |
| 21 | Spare Device homed in selected Laboratory | allowed |
| 22 | Retired or decommissioned Device on new report | 409 Device not eligible |
| 23 | Device home differs from reported Laboratory | 409 Device not eligible |
| 24 | Laboratory later becomes inactive | existing Incident remains manageable; snapshots unchanged |
| 25 | Device later becomes retired/decommissioned | existing Incident remains manageable; no Incident auto-transition |
| 26 | Two concurrent creates in same School/year | distinct serialized ticket numbers |
| 27 | Concurrent creates in different Schools | independent sequence rows; no cross-tenant blocking beyond database scheduling |
| 28 | Unknown payload field | 422; no sequence/report/event |
| 29 | Forged reporter or School | 422; server authority wins |
| 30 | Forged ticket/status/version/timestamps | 422 |
| 31 | Equal open titles | both may exist; no client/server title dedup authority |
| 32 | Reporter attempts PATCH without update permission | 403; may append a correction comment when permitted |
| 33 | Admin corrects subject while reported | one version increment/event after full revalidation |
| 34 | Subject correction after triage | 409 status conflict; use replacement workflow |
| 35 | Canonically equal PATCH with current ETag | 200 no-op; no version/time/event change |
| 36 | Canonically equal PATCH with stale ETag | 412 |
| 37 | `reported -> triaged` with triage summary | succeeds; one triaged event |
| 38 | `reported -> rejected` without reason | 422 |
| 39 | `reported -> rejected` with reason | terminal rejected; one event |
| 40 | `triaged -> assigned` through transition endpoint | invalid transition; assignment command is required |
| 41 | `triaged -> resolved` with summary | succeeds under approve |
| 42 | `assigned -> in_progress` by assignee | succeeds; one started event |
| 43 | `assigned -> resolved` with summary by assignee | succeeds |
| 44 | `in_progress -> resolved` with summary | succeeds |
| 45 | `resolved -> verified` without verification note | 422 |
| 46 | `resolved -> verified` with note | succeeds |
| 47 | `resolved -> in_progress` without reopen reason | 422 |
| 48 | `resolved -> in_progress` with reason | clears current resolution/verification fields; event preserves prior evidence |
| 49 | `verified -> closed` | succeeds; closed is terminal |
| 50 | Closed/rejected mutation or comment | 409 status conflict/invalid transition; no event |
| 51 | Forbidden lifecycle skip | 409 `INCIDENT_INVALID_TRANSITION` |
| 52 | Initial eligible assignment | status and assignee change atomically; one assigned event |
| 53 | Same-assignee command with current ETag | 200 no-op; no version/event |
| 54 | Reassignment without reason | 422 |
| 55 | Reassignment with reason | status preserved; one reassigned event with both snapshots |
| 56 | Assignment to inactive membership/User | 409 assignee ineligible |
| 57 | Assignment to membership lacking effective update | 409 assignee ineligible |
| 58 | Current assignee later loses eligibility | history remains; progress forbidden; Admin can reassign |
| 59 | Two status commands with same version | one commits; loser 412 |
| 60 | Assignment races transition | deterministic locks/version allow one; loser 412 |
| 61 | Comment races transition | one commits; loser 412; no lost comment/status |
| 62 | PATCH races assignment | one commits; loser 412 |
| 63 | Lost successful post-create mutation response | GET Incident/events reconciles; no automatic replay |
| 64 | Manual repeat with old ETag after committed mutation | 412; no duplicate event |
| 65 | Blank/oversized comment | 422; no version/event |
| 66 | Valid comment on visible non-terminal Incident | one version increment and one comment event |
| 67 | Actor renamed/deactivated later | event actor snapshot remains reconstructable |
| 68 | Laboratory/Device renamed later | Incident and event subject snapshots retain report-time meaning |
| 69 | Incident without Work Order | fully valid through v1 lifecycle |
| 70 | Future two Work Orders reference one Incident | Work Orders own two `incident_id` links; Incident unchanged absent orchestration |
| 71 | Client submits waiting-spare-part Incident status | 422/invalid transition; state belongs to Work Order |
| 72 | Client submits repair diagnosis/parts/cost through Incident | 422 unknown fields; no Incident mutation |

Scenario count: 72.

## 28. Implementation sequencing gate

This RFC and its field classification require independent review before lock. The later Incident backend vertical slice may implement permission additions, migrations, sequence allocation, models, services, middleware, requests, resources, routes, OpenAPI, PostgreSQL proof, and portable tests together.

The backend PR must not implement Work Order, Asset, notification, telemetry alert generation, Incident frontend migration, or retention deletion. The frontend integration follows only after the backend contract is merged and must not join canonical Incidents to AppDB records by coincidental IDs.

## 29. Architecture blockers and review status

Architecture blockers: none.

Independent review must verify row visibility, proposed permission grants, ticket sequence/lock ordering, subject correction boundary, lifecycle authority, and comment-as-event design before this RFC can be marked approved or locked.
