# Published Timetable and Schedule Occurrence Contract

**Status:** LOCKED — S2.2 BACKEND IMPLEMENTED

**Implementation:** `feat/published-timetable-backend` / PR #62

**Baseline:** `main@80e01c59bbf23faef9196db66e1cebd9cdebab5b`

**Scope:** S2.1 — TESSELA published-timetable ingestion semantics, immutable publication versioning, normalized SmartLab schedule projection, and date-specific occurrence identity.

## 1. Purpose

This contract defines the first canonical Scheduling slice after ADR-001 locked the Master Data ↔ TESSELA ↔ SmartLab boundary.

It answers four questions:

1. what SmartLab accepts conceptually from a published TESSELA timetable;
2. how a publication/version is identified, validated, staged, activated, and superseded;
3. how recurring academic schedule entries become stable date-specific `ScheduleOccurrence` records;
4. what remains immutable planning data versus later SmartLab operational overlays.

S2.1 does **not** implement a timetable solver, reservation engine, schedule exception workflow, priority-event override, session/journal workflow, Excel parser, or final service-to-service transport.

The core decision is:

> TESSELA publishes the academic plan. SmartLab normalizes and preserves that plan, then later overlays operational laboratory availability without rewriting the source timetable.

## 2. Normative architecture boundary

ADR-001 remains authoritative.

### BP Master Data target ownership

Target cross-product authority:

- School / tenant academic identity;
- Academic Year;
- Semester;
- Academic Unit / program structure;
- Teacher;
- Academic Class / rombel;
- Subject;
- Lesson Period Set;
- Lesson Period.

SmartLab currently has working equivalents for these academic references. They remain canonical inside the current SmartLab product boundary until shared BP Master Data is available, then become a synchronized projection/adapter.

### TESSELA ownership

TESSELA owns:

- timetable constraints;
- timetable solving;
- optimization;
- teacher/class/subject placement;
- planned room/laboratory assignment when room allocation is part of the solve;
- timetable versioning at the source;
- publication of an approved timetable.

### SmartLab ownership

SmartLab owns:

- Laboratory identity and operational properties;
- normalized local schedule projection;
- date-specific `ScheduleOccurrence` identity;
- later operational availability;
- later reservations;
- later closures/maintenance unavailability;
- later dated exceptions;
- later priority events;
- later Sessions and Journals.

SmartLab must never move teachers, classes, subjects, periods, or planned rooms merely to make an invalid TESSELA publication feasible.

## 3. Existing frontend model audit

The transitional browser-local `Schedule` model currently stores:

- `day` as localized display text;
- `date` as a legacy field even though regular schedules recur by weekday;
- `startTime` / `endTime` as free local times;
- `lessonHours`;
- `laboratoryId`;
- `className`;
- `teacherName`;
- `subject`;
- localized `activityType`;
- localized status;
- semester display text.

The current page also performs teacher/class/laboratory overlap checks in the browser.

None of the following may be copied into the canonical backend contract as identity:

- teacher name;
- class name;
- subject name;
- localized weekday labels;
- display semester labels;
- transient browser IDs.

The local model remains a prototype until S2 cutover. It is not a migration source of truth.

## 4. Contract terminology

| Term | Meaning |
| --- | --- |
| **Source publication** | An immutable timetable snapshot published by TESSELA. |
| **Publication family** | The logical timetable scope for one School + Semester across versions. |
| **Source version** | Monotonic TESSELA version inside one publication family. |
| **TimetablePublication** | SmartLab's immutable local record of one accepted/staged source publication version. |
| **TimetableEntry** | One normalized academic allocation rule inside a publication. |
| **ScheduleOccurrence** | One date-specific materialized projection of one TimetableEntry. |
| **Planned Laboratory** | Laboratory assigned by the source timetable; not the final dated operational decision. |
| **Operational Laboratory** | Effective Laboratory after SmartLab operational overlays; defined in later S2 slices. |
| **Publication activation** | Atomic switch making one fully validated publication the active plan for a School + Semester. |
| **Supersession** | A newer active publication replaces the previous one prospectively as current planning authority. |

## 5. Publication scope: full School + Semester snapshot

S2.1 accepts only **complete timetable snapshots for one School + Semester scope and one declared effective window**.

A publication is not a patch/delta.

One publication version represents the complete known academic timetable applicable to:

- exactly one School;
- exactly one Academic Year;
- exactly one Semester;
- one effective date window inside that Semester.

A mid-semester revision may therefore publish a complete replacement snapshot whose `effectiveFrom` is the cutover date and whose `effectiveTo` is later in the same Semester. It is still complete for that declared window; it is not a list of changed rows only.

Why full snapshots:

- activation can be atomic;
- omission has clear semantics;
- replay is deterministic;
- stale entries cannot survive accidentally from an older version;
- availability queries can rely on one active planning snapshot;
- partial failure cannot leave mixed TESSELA versions active.

Incremental timetable deltas are a future optimization and are not approved by S2.1.

## 6. TimetablePublication contract

A local `TimetablePublication` uses a server-generated ULID and preserves immutable source identity.

| Field | Contract |
| --- | --- |
| `id` | SmartLab server-generated immutable ULID |
| `schoolId` | immutable owning School ULID, derived from trusted integration context |
| `sourceSystem` | `tessela` in S2.1 |
| `sourcePublicationId` | required opaque stable source identifier |
| `sourceVersion` | required positive integer, monotonic inside the publication family |
| `schemaVersion` | required source payload schema version string |
| `academicReferenceSource` | source namespace for academic IDs, e.g. `smartlab` during transition or `bp_master_data` later |
| `academicYearId` | resolved local AcademicYear ULID |
| `semesterId` | resolved local Semester ULID |
| `publishedAt` | source publication timestamp |
| `effectiveFrom` | local calendar date |
| `effectiveTo` | local calendar date |
| `payloadSha256` | SmartLab-computed SHA-256 over canonicalized source payload |
| `status` | `staged`, `validated`, `active`, `superseded`, or `rejected` |
| `validatedAt` | nullable server timestamp |
| `activatedAt` | nullable server timestamp |
| `supersededAt` | nullable server timestamp |
| `supersededById` | nullable newer TimetablePublication ULID |
| `validationSummary` | bounded structured counts/result metadata; not free-form source truth |
| timestamps | server-owned |

### 6.1 Publication family identity

The logical family key is:

```text
schoolId
+ sourceSystem
+ sourcePublicationId
+ semesterId
```

`sourcePublicationId` should remain stable across source versions for the same logical School + Semester timetable.

### 6.2 Immutable identity key

One immutable version is uniquely identified by:

```text
schoolId
+ sourceSystem
+ sourcePublicationId
+ sourceVersion
```

The same identity/version may never represent different content.

### 6.3 Effective-range invariants

- `effectiveFrom <= effectiveTo`;
- both dates must be fully contained inside the resolved Semester date range;
- the Semester must belong to the resolved Academic Year;
- Academic Year and Semester must belong to the same School;
- S2.1 does not silently expand an effective range outside the source declaration.

## 7. Source payload semantic envelope

Transport is deliberately not fixed in S2.1. Whether payloads arrive through HTTP push, pull, file exchange, queue, or another controlled mechanism is a later implementation decision.

The semantic envelope is locked:

```json
{
  "schemaVersion": "1.0",
  "sourceSystem": "tessela",
  "sourcePublicationId": "TT-2026-2027-GASAL",
  "sourceVersion": 3,
  "academicReferenceSource": "smartlab",
  "schoolSourceId": "school-source-id",
  "academicYearSourceId": "academic-year-source-id",
  "semesterSourceId": "semester-source-id",
  "publishedAt": "2026-09-05T05:00:00+07:00",
  "effectiveFrom": "2026-07-13",
  "effectiveTo": "2026-12-18",
  "entries": []
}
```

Field names shown here are semantic names, not yet a committed HTTP/OpenAPI route.

## 8. Academic reference namespace

A publication declares exactly one `academicReferenceSource`.

Examples:

- `smartlab` — transitional mode where TESSELA references current SmartLab academic ULIDs;
- `bp_master_data` — target mode where TESSELA references shared BP Master Data identities.

Every Teacher/Class/Subject/AcademicYear/Semester/LessonPeriod source ID in the publication belongs to that declared namespace.

SmartLab resolves inbound source IDs into current local projection IDs before a publication may become `validated`.

Rules:

1. source IDs are identity; display codes/names are only diagnostics;
2. ambiguous source-to-local mapping fails closed;
3. display name matching is never allowed;
4. code fallback is allowed only in an explicit controlled bootstrap/reconciliation process, never as ordinary publication ingestion;
5. all resolved references must belong to the publication School;
6. source identity snapshots are retained so future projection remapping remains auditable.

## 9. Laboratory reference namespace

Laboratory is a SmartLab-owned domain.

Therefore `plannedLaboratoryId`, when present, is the canonical SmartLab Laboratory ULID exported/known to TESSELA.

TESSELA may also send optional snapshots such as:

- Laboratory code;
- Laboratory name;
- capacity observed during solve.

Those snapshots are diagnostics only.

SmartLab never resolves a planned Laboratory by display name.

A missing planned Laboratory is valid because SmartLab may consume the complete School timetable, including classes not assigned to a laboratory.

## 10. TimetableEntry contract

A `TimetableEntry` is immutable after its publication payload is accepted.

| Field | Contract |
| --- | --- |
| `id` | SmartLab server-generated ULID |
| `schoolId` | inherited immutable School |
| `publicationId` | immutable parent TimetablePublication |
| `sourceScheduleId` | required stable source entry identifier |
| `teacherId` | resolved local Teacher ULID |
| `academicClassId` | resolved local AcademicClass ULID |
| `subjectId` | resolved local Subject ULID |
| `lessonPeriodSetId` | resolved local LessonPeriodSet ULID |
| `startLessonPeriodId` | resolved local instruction LessonPeriod ULID |
| `endLessonPeriodId` | resolved local instruction LessonPeriod ULID |
| `plannedLaboratoryId` | nullable SmartLab Laboratory ULID |
| `activityType` | `practical`, `theory`, `exam`, or `other` |
| `recurrenceKind` | `weekly` or `single_date` |
| `weekday` | ISO weekday `1..7`; required only for `weekly` |
| `entryEffectiveFrom` | required for weekly; inside publication range |
| `entryEffectiveTo` | required for weekly; inside publication range |
| `occursOn` | required only for `single_date` |
| `startTimeSnapshot` | server-resolved local wall-clock start from LessonPeriod |
| `endTimeSnapshot` | server-resolved local wall-clock end from LessonPeriod |
| `instructionPeriodCount` | server-derived positive integer |
| `sourceSnapshots` | bounded diagnostic codes/names from source, optional |
| timestamps | server-owned |

### 10.1 Source schedule identity

`sourceScheduleId` must be unique inside one publication.

TESSELA should preserve the same `sourceScheduleId` across source versions when the logical allocation survives a revision. SmartLab may use it for diff/audit correlation, but publication version remains part of immutable identity.

### 10.2 Teacher cardinality in S2.1

S2.1 supports exactly one Teacher per TimetableEntry.

Team teaching / multiple teachers are not modeled in this contract. If required later, it needs an explicit additive relation rather than delimited text.

### 10.3 Class cardinality in S2.1

S2.1 supports exactly one AcademicClass per TimetableEntry.

Merged-class/cohort allocations are deferred. They must not be represented by concatenated class names.

## 11. Lesson-period invariants

The Academic Master contract already defines:

- LessonPeriod belongs to one LessonPeriodSet;
- kind is `instruction` or `break`;
- periods inside one set do not overlap;
- sequence is unique.

TimetableEntry adds:

1. start and end LessonPeriod must exist and belong to the same School;
2. both must belong to `lessonPeriodSetId`;
3. both start and end periods must have `kind=instruction`;
4. start sequence must be `<=` end sequence;
5. every instruction period between start/end contributes to `instructionPeriodCount`;
6. intervening `break` periods may exist and remain part of the wall-clock span;
7. raw source start/end clock strings do not override canonical LessonPeriod times;
8. `startTimeSnapshot` and `endTimeSnapshot` are frozen at ingestion so later Bell Schedule edits do not rewrite historical plan display.

Example:

```text
JP03 instruction 08:30-09:15
BREAK           09:15-09:30
JP04 instruction 09:30-10:15

entry JP03..JP04
instructionPeriodCount = 2
startTimeSnapshot = 08:30:00
endTimeSnapshot = 10:15:00
```

## 12. Recurrence semantics

S2.1 deliberately avoids arbitrary RRULE support.

### 12.1 Weekly

`recurrenceKind=weekly` requires:

- one ISO weekday;
- `entryEffectiveFrom`;
- `entryEffectiveTo`;
- both dates inside the publication range.

A ScheduleOccurrence is generated for each matching weekday date in the entry range.

### 12.2 Single date

`recurrenceKind=single_date` requires:

- `occursOn`;
- no weekday;
- occurrence date inside publication range.

This supports legitimate source-side one-date academic allocations without turning SmartLab exceptions into TESSELA entries.

### 12.3 No hidden recurrence inference

SmartLab does not infer recurrence from:

- localized weekday names;
- missing date values;
- repeated display labels;
- previous publication data.

Recurrence is explicit.

## 13. ScheduleOccurrence contract

A `ScheduleOccurrence` is a date-specific immutable projection of one TimetableEntry.

| Field | Contract |
| --- | --- |
| `id` | server-generated ULID |
| `schoolId` | immutable School |
| `publicationId` | immutable publication |
| `entryId` | immutable TimetableEntry |
| `occursOn` | local calendar date |
| `teacherId` | copied resolved reference |
| `academicClassId` | copied resolved reference |
| `subjectId` | copied resolved reference |
| `plannedLaboratoryId` | nullable copied planned Laboratory |
| `lessonPeriodSetId` | copied time-grid reference |
| `startLessonPeriodId` | copied start reference |
| `endLessonPeriodId` | copied end reference |
| `startTimeSnapshot` | immutable local wall-clock snapshot |
| `endTimeSnapshot` | immutable local wall-clock snapshot |
| `activityType` | immutable source-plan value |
| timestamps | server-owned |

Unique key:

```text
publicationId + entryId + occursOn
```

### 13.1 Why occurrences are materialized

SmartLab materializes occurrences during staging because later domains need stable date-specific IDs for:

- availability;
- reservations/conflict checks;
- schedule exceptions;
- priority-event impact preview;
- Sessions;
- Journals;
- Incidents linked to a dated activity;
- audit and historical reproduction.

The publication/entry remains the recurring plan. The occurrence is the dated projection.

### 13.2 Occurrence immutability

Operational changes do not mutate source-plan fields on ScheduleOccurrence.

Later overlays reference the occurrence.

For example:

```text
ScheduleOccurrence
plannedLaboratoryId = LAB-RPL-1

ScheduleException
replacementLaboratoryId = LAB-RPL-2
reason = maintenance
```

The occurrence still records the original plan.

## 14. Staging and materialization workflow

Publication processing follows:

```text
receive source payload
        ↓
canonicalize payload + compute SHA-256
        ↓
identity/idempotency check
        ↓
create/reuse staged publication
        ↓
resolve academic references
        ↓
resolve Laboratory references
        ↓
normalize immutable TimetableEntry rows
        ↓
materialize ScheduleOccurrence rows
        ↓
validate complete publication
        ↓
validated
        ↓
atomic activation
```

All entries/occurrences are prepared before activation.

A publication is never active while only part of its entries or occurrences exist.

## 15. Publication lifecycle

Allowed lifecycle:

```text
staged
 ├──→ rejected
 └──→ validated
          ↓
        active
          ↓
      superseded
```

Rules:

- `rejected` is terminal for that immutable source version;
- `superseded` is terminal;
- an active publication is never edited;
- reactivation of an old superseded version is not allowed through ordinary flow;
- correction requires a new TESSELA source version.

A technically identical replay of an existing version does not create a second lifecycle record.

## 16. Idempotency and canonical payload hash

SmartLab computes `payloadSha256` from a canonical representation.

Canonicalization must at least normalize:

- object-key ordering;
- source-defined collection ordering where ordering is semantically irrelevant;
- Unicode normalization;
- date/time representation;
- null/omitted optional fields according to the final implementation contract.

Behavior:

| Case | Result |
| --- | --- |
| unseen source publication/version | stage normally |
| same source identity/version + same hash | idempotent replay; return/reuse existing result |
| same source identity/version + different hash | reject immutable-version conflict |
| newer sourceVersion | stage as new immutable version |
| older sourceVersion after newer version exists | retain for audit if explicitly received, but never silently reactivate over newer active version |

Exact HTTP status/error mapping is implementation-stage work, but the semantic conflict must be stable.

## 17. Complete-publication validation

A publication cannot become `validated` unless all applicable invariants pass.

### 17.1 Reference validity

- all academic references resolve uniquely;
- all resolved references are same-School;
- Academic Year / Semester relation is valid;
- future/current operational references are eligible/active under domain policy;
- planned Laboratory, when present, exists in the same School;
- inactive Laboratory cannot receive a new current/future planned allocation.

Historical backfill policy for inactive references is not part of S2.1.

### 17.2 Entry uniqueness

Inside one publication:

- `sourceScheduleId` unique;
- normalized duplicate entries are rejected rather than silently deduplicated.

### 17.3 Occurrence collision validation

After materialization, SmartLab detects structural source conflicts for the same date/time interval. Overlap is evaluated using the materialized local wall-clock interval (`startTimeSnapshot`/`endTimeSnapshot`), not merely LessonPeriod sequence numbers, because different LessonPeriodSets may use different clocks.

At minimum, overlapping occurrences may not double-book:

- the same Teacher;
- the same AcademicClass;
- the same non-null planned Laboratory.

SmartLab reports these as source-publication validation failures.

It does not move any entry to resolve them.

### 17.4 Capacity

Whether `AcademicClass.studentCount > Laboratory.capacity` is a hard rejection or warning remains a separate policy decision.

S2.1 requires the validator to be capable of producing a capacity diagnostic; it does not yet lock warning-versus-error policy.

## 18. Time semantics

Academic schedule planning uses:

- local calendar dates;
- LessonPeriod local wall-clock times;
- School context.

Source publication timestamps such as `publishedAt` are offset-aware timestamps.

Server audit timestamps remain normal absolute timestamps.

S2.1 does not convert a LessonPeriod into UTC and then use UTC as academic schedule identity. Academic dates/times must remain stable across infrastructure timezone changes.

## 19. Activation semantics

Only one `TimetablePublication` may be the current active publication for a School + Semester.

Activation is a short transaction after all heavy staging/validation/materialization work is complete.

Activation must atomically:

1. verify the candidate is still `validated`;
2. verify the School-local activation date is not earlier than `effectiveFrom`;
3. verify no newer conflicting activation occurred concurrently;
4. mark current active publication `superseded` if present;
5. set its `supersededById`;
6. mark candidate `active`;
7. record activation audit event.

S2.1 does not implement scheduled future auto-activation. A candidate whose `effectiveFrom` is in the future remains `validated` until an authorized activation at/after the cutover date.

No window may expose two active publications for the same School + Semester.

## 20. Supersession and historical references

A newer publication changes the current academic plan.

It does **not** rewrite historical domain records.

Existing future operational records need later impact/reconciliation rules, but these invariants are already locked:

- completed Session keeps its original ScheduleOccurrence;
- Journal keeps its Session/Occurrence lineage;
- Incident history is never retargeted silently;
- an existing approved ScheduleException is never silently reattached to a different occurrence;
- old TimetablePublication/Entry/Occurrence rows remain readable for history.

S2.2+ must define impact preview before a new publication supersedes occurrences already referenced by future reservations/exceptions/sessions.

## 21. Current-plan query semantics

For ordinary current/future schedule and availability views:

- select the active TimetablePublication for current School + Semester;
- the requested date must fall inside that publication's effective window;
- query its materialized ScheduleOccurrences by date/range;
- overlay later SmartLab operational state.

Arbitrary historical timetable browsing across superseded effective windows is a read-model concern for S2.3. Historical business records already linked to an occurrence always follow their stored publication/occurrence lineage.

For historical workflow records:

- follow the stored occurrence/publication reference;
- never re-resolve history against today's active publication.

## 22. Planned Laboratory versus operational Laboratory

S2.1 stores only the source planned assignment:

`ScheduleOccurrence.plannedLaboratoryId`.

It does not persist a second mutable `currentLaboratoryId` on the occurrence.

Later S2 availability derives an effective answer using overlays such as:

```text
planned Laboratory
+ closure
+ maintenance unavailability
+ reservation policy
+ priority event
+ ScheduleException
= effective operational allocation
```

Every effective result must expose provenance.

## 23. No regular-schedule CRUD in canonical S2.1

Imported TESSELA TimetableEntry rows are not edited by SmartLab generic CRUD.

Canonical SmartLab must not provide:

- "edit teacher" on an imported entry;
- "edit class" on an imported entry;
- "move period" on an imported entry;
- "delete recurring entry" on an imported entry;
- permanent planned-room mutation on an imported entry.

Structural changes belong in TESSELA and arrive as a newer publication version.

Date-specific operational changes belong to later SmartLab ScheduleException workflow.

This is a deliberate break from the current browser-local `Tambah/Edit/Hapus Jadwal Reguler` prototype.

Cutover of that UI happens only when the server slice is ready.

## 24. Audit contract

Material events must be append-oriented and tenant-scoped.

Minimum event types:

- `publication_received`;
- `publication_replayed`;
- `publication_validation_failed`;
- `publication_validated`;
- `publication_activated`;
- `publication_superseded`;
- `publication_integrity_conflict`.

Minimum audit snapshots:

- School ID;
- TimetablePublication ID;
- source system;
- sourcePublicationId;
- sourceVersion;
- payloadSha256;
- actor/service identity where available;
- result counts;
- timestamp.

Entry-level validation errors may be retained in a bounded validation-result store rather than one audit row per field error.

## 25. Security and tenant isolation

- School scope is never accepted as an untrusted arbitrary ownership mutation;
- integration authentication must resolve one trusted School context or a trusted platform-to-school mapping;
- source School identity must match that context;
- cross-School academic or Laboratory references fail closed;
- timetable publication never grants user-level SmartLab permissions;
- viewing/editing later operational schedule data remains protected by Laravel authorization;
- no public unauthenticated schedule import is approved.

Final service-auth mechanism is intentionally deferred.

## 26. Failure behavior

### TESSELA unavailable

Last active publication remains operationally readable. SmartLab does not invoke a replacement solver.

### BP Master Data unavailable

Known local projection references may continue to support already-activated schedules. New publication validation requiring unresolved external references remains staged/fails closed rather than fabricating identities.

### New publication invalid

Current active publication remains unchanged.

### Materialization fails

Candidate remains non-active and may be marked rejected according to implementation error classification. No partial activation occurs.

### Activation race

Only one transaction wins. A stale activation attempt must fail without creating two active versions.

## 27. Validation result shape

Exact API schemas are future work, but the domain result must distinguish at least:

- errors — block activation;
- warnings — do not block unless policy later upgrades them;
- counts.

Conceptual result:

```json
{
  "entriesReceived": 642,
  "entriesNormalized": 642,
  "occurrencesMaterialized": 11234,
  "errors": 0,
  "warnings": 7,
  "diagnostics": {
    "unknownReferences": 0,
    "duplicateSourceScheduleIds": 0,
    "teacherCollisions": 0,
    "classCollisions": 0,
    "laboratoryCollisions": 0,
    "capacityWarnings": 7
  }
}
```

The implementation must bound diagnostic payload size and support a downloadable/detail mechanism if very large result sets occur later.

## 28. Example normalized entry

```json
{
  "sourceScheduleId": "SCH-XIPPLG1-WEB-MON-01",
  "teacherId": "01...",
  "academicClassId": "01...",
  "subjectId": "01...",
  "lessonPeriodSetId": "01...",
  "startLessonPeriodId": "01...",
  "endLessonPeriodId": "01...",
  "plannedLaboratoryId": "01...",
  "activityType": "practical",
  "recurrenceKind": "weekly",
  "weekday": 1,
  "entryEffectiveFrom": "2026-07-13",
  "entryEffectiveTo": "2026-12-18",
  "startTimeSnapshot": "07:00:00",
  "endTimeSnapshot": "09:15:00",
  "instructionPeriodCount": 3
}
```

## 29. Example occurrence

For Monday 2026-09-14:

```json
{
  "occursOn": "2026-09-14",
  "sourceScheduleId": "SCH-XIPPLG1-WEB-MON-01",
  "plannedLaboratoryId": "01...",
  "teacherId": "01...",
  "academicClassId": "01...",
  "subjectId": "01...",
  "startTimeSnapshot": "07:00:00",
  "endTimeSnapshot": "09:15:00"
}
```

If LAB-RPL-1 is unavailable that day, S2.1 does not edit this occurrence. A later ScheduleException references its stable occurrence ID.

## 30. Legacy frontend cutover rules

When S2 implementation reaches frontend cutover:

1. `/schedules` stops reading `useAppData().db.schedules`;
2. teacher/class/subject labels come from normalized server DTOs/snapshots, not local free text;
3. current "Tambah/Edit/Hapus Jadwal Reguler" actions are removed or replaced by source-aware actions only when product UX is approved;
4. ordinary users are directed to TESSELA/republication for structural timetable edits;
5. date-specific operational changes use SmartLab exception workflow once implemented;
6. browser seed schedules disappear from production truth;
7. existing local schedule records are not silently uploaded as canonical TESSELA publications.

A deliberate data migration/import plan is required if any prototype data must be preserved.

## 31. OpenAPI boundary

Repository convention states that implemented HTTP contracts belong in `packages/contracts/openapi.yaml`.

Therefore this S2.1 architecture PR does **not** add speculative HTTP routes to OpenAPI.

The implementation PR must add OpenAPI together with actual routes/services/tests.

Possible route families may later include:

```text
/integrations/timetable-publications
/timetable-publications
/schedule-occurrences
```

These names are illustrative only and are not locked by this document.

## 32. Database direction

Exact Laravel migrations are implementation work, but the domain model should map cleanly to tables conceptually equivalent to:

```text
timetable_publications
timetable_entries
schedule_occurrences
timetable_publication_events / existing audit abstraction
publication_validation_results
```

Do not collapse publication, recurring entry, and occurrence into one table.

Do not store all entries only as opaque JSON if doing so prevents relational validation and occurrence queries.

Retaining the original/canonical source payload for audit/replay is allowed in addition to normalized relational data, subject to size/retention policy.

## 33. Implementation acceptance tests

S2.1 implementation is not complete without tests for at least:

### Identity and replay

- first publication version accepted;
- identical replay is idempotent;
- same identity/version with changed payload is rejected;
- newer version stages separately;
- older version cannot silently replace newer active version.

### Tenant/reference integrity

- cross-School references rejected without disclosure;
- unknown Teacher/Class/Subject/Period/Laboratory rejected;
- ambiguous external mapping rejected;
- display-name-only resolution impossible.

### Recurrence

- weekly entries materialize only matching dates;
- single-date entry materializes exactly once;
- effective range boundaries inclusive;
- publication/entry range outside Semester rejected;
- break period inside a span does not inflate instructionPeriodCount.

### Collision validation

- Teacher overlap rejected;
- AcademicClass overlap rejected;
- same non-null Laboratory overlap rejected;
- adjacent periods accepted;
- different laboratories/classes/teachers accepted when no shared constrained resource overlaps.

### Activation

- incomplete staging never becomes active;
- activation atomically supersedes prior publication;
- concurrent activation cannot create two active publications;
- rejected publication leaves current active version unchanged.

### History

- old occurrence remains readable after supersession;
- existing historical linkage does not retarget to new publication.

## 34. Definition of done for S2.1 contract

This contract is considered locked when:

- ADR-001 ownership is preserved;
- full-snapshot publication semantics are explicit;
- source identity/version/hash/idempotency semantics are explicit;
- academic source namespace and SmartLab Laboratory reference rules are explicit;
- TimetablePublication, TimetableEntry, and ScheduleOccurrence responsibilities are separate;
- recurrence is bounded and deterministic;
- activation is atomic;
- collision validation rejects invalid source plans without solving them;
- date-specific operations are explicitly deferred to SmartLab overlays;
- frontend prototype CRUD is recognized as transitional;
- speculative OpenAPI is not introduced before implementation.

## 35. Follow-up slices

After this contract:

### S2.2 — Published timetable backend — implemented

Delivered:

- relational persistence for publication/entry/occurrence/event records;
- payload normalization/hash replay protection;
- current SmartLab-reference validation;
- recurrence materialization;
- collision diagnostics/rejection;
- capacity warnings;
- rejected-publication evidence without partial normalized rows;
- atomic activation/supersession;
- tenant-scoped list/detail endpoints;
- server permissions;
- OpenAPI 0.13;
- PostgreSQL migration/seeder validation and portable feature tests.

The implementation intentionally keeps `academicReferenceSource=smartlab` for this slice. Shared BP Master Data external-ID mapping and service-to-service transport remain deferred decisions.

### S2.3 — Schedule read model and frontend cutover — implemented

Delivered:

- active-publication current-plan queries;
- bounded occurrence list/range endpoint with tenant isolation and filters;
- stable occurrence/source/publication provenance in the read DTO;
- canonical `/schedules` week/day/list frontend;
- `schedules.view` route and navigation authorization from the server permission catalog;
- removal of browser-local structural schedule CRUD from the production schedule page;
- explicit TESSELA source/read-only messaging;
- OpenAPI 0.14 and frontend/backend regression coverage.

This endpoint intentionally represents the **current plan**. It is not a historical reconstruction of which publication happened to be active on an arbitrary past date. Historical workflow records must continue to follow their stored occurrence/publication lineage.

### S2.4 — Calendar / closures

Add dated operational unavailability sources.

### S2.5 — Unified Laboratory Availability

Overlay active occurrences with operational blockers.

### S2.6+ — Reservations, ScheduleException, priority events

Build operational scheduling workflows without editing the immutable TESSELA source plan.

## 36. Open decisions intentionally deferred

These remain real decisions but do not block S2.1 implementation of the core model:

1. push vs pull vs hybrid TESSELA transport;
2. exact service-account/authentication mechanism;
3. exact external-ID mapping table/column design;
4. capacity warning versus hard-error tenant policy;
5. retention duration for raw superseded source payloads;
6. merged-class / team-teaching support;
7. incremental/delta publication protocol;
8. detailed impact-preview UX when a new publication affects future SmartLab reservations/exceptions;
9. whether historical backfill may activate publications containing references now inactive.
