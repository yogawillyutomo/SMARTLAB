# Laboratory Session and Activity Report Contract

**Status:** S3.1 contract locked; S3.2 LaboratorySession backend implemented; S3.3 ActivityReport backend implemented  
**Date:** 2026-09-05  
**Depends on:** ADR-001, S2 Published Timetable/Schedule Occurrence, Unified Laboratory Availability, Reservation, Schedule Exception, Priority Event, Incident

## 1. Purpose

Phase S3 turns an approved operational use of a Laboratory into evidence of what actually happened.

The canonical user journey is:

```text
operational source
    ↓
eligible execution
    ↓
LaboratorySession
    ↓
start
    ↓
in progress
    ↓
end
    ↓
ActivityReport draft
    ↓
submit
    ↓
verify / request revision
    ↓
complete
```

The UX may present this as one **Pelaksanaan Lab** workflow, but the domain remains two related entities:

```text
LaboratorySession 1 ─── 1 ActivityReport
```

for normal canonical execution.

A manually backfilled report is the only approved exception to the 1:1 relationship and must never invent a fake LaboratorySession.

## 2. Domain ownership

### LaboratorySession owns

- actual execution identity;
- source-of-use provenance;
- effective Laboratory used for the execution;
- planned/effective source window snapshots;
- actual start/end timestamps;
- opening/closing operational observations;
- end outcome;
- execution actors;
- append-oriented lifecycle audit.

### ActivityReport owns

- report/journal identity;
- report type;
- narrative and evidence about the completed activity;
- attendance/participant aggregates;
- material/software/resource notes;
- issues and follow-up;
- attachments metadata;
- links to canonical Incidents;
- draft/submission/revision/verification lifecycle;
- append-oriented audit.

### It does not own

LaboratorySession and ActivityReport do not become authorities for:

- school timetable generation;
- recurring schedule structure;
- Reservation approval;
- Priority Event approval;
- individual student attendance;
- Device/Asset identity;
- Incident lifecycle;
- academic master identity.

TESSELA remains timetable authority.  
HADIRA remains the intended product authority for individual attendance.  
SmartLab stores only execution/report evidence needed for Laboratory operation.

## 3. Canonical execution sources

A normal LaboratorySession must originate from exactly one canonical operational source:

```text
schedule_occurrence
laboratory_reservation
priority_event
```

There is no general-purpose `manual` operational Session source.

Ad-hoc real Laboratory use must first become an authorized Reservation or Priority Event. This prevents Session creation from becoming a bypass around Unified Availability and approval policy.

### 3.1 ScheduleOccurrence source

A ScheduleOccurrence is eligible only when:

- it belongs to the current active timetable publication at preparation/start time;
- its operational status is `scheduled` or `relocated`;
- it is not cancelled by an active ScheduleException;
- its effective Laboratory is resolvable and active;
- the user has permission to execute the source.

When relocated, LaboratorySession references the **operational Laboratory**, while preserving:

- planned TESSELA Laboratory;
- ScheduleException ID/version;
- publication ID/source publication ID/source version;
- source schedule ID;
- occurrence ID.

### 3.2 LaboratoryReservation source

A Reservation is eligible only while:

```text
status = approved
```

The Session uses the approved Reservation Laboratory/date/time and preserves Reservation number/version plus requester/PIC snapshots.

### 3.3 PriorityEvent source

A Priority Event is eligible only while:

```text
status = approved
```

The Session uses the approved Priority Event Laboratory/date/time and preserves event number/version, category, requester, and PIC snapshots.

## 4. Source evidence and snapshot rule

A Session must not depend on mutable display text for historical truth.

Conceptually it stores:

```text
sourceType
sourceId
sourceVersionEvidence
sourceDate
sourceStartsAt
sourceEndsAt
laboratoryId
sourceEvidence
```

`sourceEvidence` contains the immutable or auditable identifiers needed to explain the source later.

For ScheduleOccurrence this includes timetable publication/source identity and any active ScheduleException evidence used to determine the operational Laboratory.

Human-readable codes/names may be stored as snapshots for historical display, but never replace canonical identifiers.

Once a Session starts, later timetable/master changes never rewrite its source snapshot or actual execution facts.

## 5. Session identity and lifecycle

Conceptual LaboratorySession fields:

```text
id                         ULID
schoolId
sessionNumber              server-generated human number

sourceType
sourceId
sourceVersionEvidence
sourceEvidence

laboratoryId
sourceDate
sourceStartsAt
sourceEndsAt

activityKind
responsibleTeacherId?      academic reference when applicable
responsibleNameSnapshot
academicClassId?
subjectId?
plannedParticipantCount?

status
openingCondition?
closingCondition?
endOutcome?
operationalNotes?

preparedByUserId
preparedByMembershipId
startedByUserId?
startedByMembershipId?
endedByUserId?
endedByMembershipId?

actualStartedAt?
actualEndedAt?
cancelledAt?
cancellationReason?

version
createdAt
updatedAt
```

### 5.1 Session states

Canonical Session states are deliberately smaller than the user-facing workflow states:

```text
prepared
in_progress
ended
cancelled
```

Transitions:

```text
[*] ──prepare──> prepared
prepared ──start──> in_progress
prepared ──cancel(reason)──> cancelled
in_progress ──end(outcome)──> ended
```

No ordinary transition exists from `in_progress` to `cancelled`.

If an activity starts and must stop early, it is ended with:

```text
endOutcome = interrupted
```

rather than erased or cancelled.

Allowed end outcomes:

```text
completed
interrupted
```

`ended` and `cancelled` are terminal for ordinary workflow.

There is no hard delete.

## 6. Planned source versus actual execution

The source window remains evidence of what was authorized/planned:

```text
sourceDate
sourceStartsAt
sourceEndsAt
```

The Session records what actually happened:

```text
actualStartedAt
actualEndedAt
```

Actual timestamps never mutate ScheduleOccurrence, Reservation, Priority Event, or ScheduleException.

Starting late or ending late therefore does not rewrite TESSELA.

No arbitrary grace-period policy is locked in S3.1. A later tenant policy may define warnings or escalation for early/late execution without changing the source-of-truth boundary.

## 7. Preparation and start-time revalidation

Preparing a Session records the current source evidence but does not make that evidence permanently valid.

Before `start`, the server must revalidate the source.

### Schedule source revalidation

Confirm:

- current active timetable publication;
- occurrence still operationally valid;
- planned/relocated Laboratory still matches the prepared evidence;
- active ScheduleException evidence still matches;
- source date/time still matches.

### Reservation source revalidation

Confirm:

- Reservation still approved;
- Reservation version/effective Laboratory/date/time still match.

### Priority source revalidation

Confirm:

- Priority Event still approved;
- Priority Event version/effective Laboratory/date/time still match.

If source evidence changed, start fails closed:

```text
SESSION_SOURCE_CHANGED
```

The client must reload and explicitly re-prepare/reconcile. SmartLab never silently changes a prepared Session to another Laboratory or source version.

## 8. Execution eligibility versus free availability

Starting an execution is not equivalent to asking whether the source window is free.

The canonical source itself already occupies the slot.

Therefore the start service evaluates:

```text
source is valid
AND
source owns this Laboratory window
AND
no incompatible blocker exists other than this source
AND
Laboratory is operational
```

The server may internally reuse Unified Laboratory Availability with controlled self-source exclusion.

Clients must not receive a general-purpose ability to exclude arbitrary blockers from availability.

## 9. Duplicate execution protection

For one canonical source, SmartLab permits at most one active/non-cancelled Session.

Conceptually:

```text
(sourceType, sourceId) UNIQUE
WHERE status IN ('prepared', 'in_progress', 'ended')
```

A cancelled prepared Session remains historical evidence and may be followed by a new preparation if the source is still valid.

This prevents two users from starting the same ScheduleOccurrence/Reservation/Priority Event as separate canonical executions.

## 10. School-local date rule

Normal execution start is tied to the source occurrence date in the School timezone.

A standard start request must therefore target the School-local source date.

Historical data entry must not fake start/end lifecycle transitions. Historical/legacy evidence uses the manual backfill report path defined later.

No client-supplied timezone becomes authority.

## 11. In-progress Session becomes operational occupancy

The source continues to explain why the Laboratory was authorized, but an in-progress Session becomes evidence of actual occupancy.

Unified Laboratory Availability must eventually include:

```text
LaboratorySession(status = in_progress)
```

as an operational blocker.

The blocker starts at `actualStartedAt` and remains open until `actualEndedAt`.

This is intentional fail-closed behavior:

- if a class overruns its planned period, later users must not see the Laboratory as free;
- if an operator forgets to end a Session, the system exposes an operational problem instead of guessing an end time.

The Session blocker must preserve source identity so overlapping planned-source evidence remains explainable rather than appearing as an unrelated double booking.

## 12. Source mutations while a Session exists

Source-domain mutation services become Session-aware in S3 implementation.

### Prepared Session

A prepared Session is an explicit operational commitment.

A source mutation that would invalidate its Laboratory/date/time/source identity must not silently make it stale.

The supported model is explicit reconciliation:

```text
cancel/reconcile prepared Session
    ↓
change source
    ↓
prepare again if needed
```

### In-progress Session

A source mutation that would invalidate an in-progress Session must fail closed with an active-session conflict.

Examples:

- cancelling its approved Reservation;
- cancelling its approved Priority Event;
- restoring/changing a ScheduleException that would move the current execution;
- activating a timetable version that invalidates a prepared/current ScheduleOccurrence.

### Ended Session

Ended Sessions are historical evidence.

Later source changes do not rewrite or invalidate them.

## 13. Timetable publication reconciliation extension

S2.8 publication impact must be extended when S3 becomes canonical.

A future/current **prepared** Session sourced from the current timetable publication is an activation blocker until explicitly reconciled.

An **in-progress** Session sourced from the current timetable is an activation blocker until it ends.

An ended historical Session is not silently migrated and is not rewritten by a new timetable publication.

This new blocker will conceptually be:

```text
active_session_conflict
```

S3 implementation must add it to the publication-impact contract and UAT before Session cutover is considered complete.

## 14. Ending a Session and report creation

Ending a Session must record:

- actual end time;
- `endOutcome`;
- closing operational observation;
- end actor;
- version/audit event.

For normal canonical execution, ending the Session **atomically creates or confirms exactly one ActivityReport draft**.

This gives:

```text
LaboratorySession(status = ended)
        1
        │
        1
ActivityReport(status = draft)
```

The initial report draft may contain source/session snapshots and empty report content. It does not need complete report fields merely to let the Session end.

If the transaction cannot guarantee the Session/report relationship, the mutation fails rather than leaving ambiguous partial state.

## 15. ActivityReport identity

Conceptual fields:

```text
id                         ULID
schoolId
reportNumber               server-generated human number

origin                     session | manual_backfill
sessionId?                 required when origin=session
manualBackfillReason?      required when origin=manual_backfill

reportType
status

laboratoryId
occurredOn
sourceSnapshot
sessionSnapshot

plannedParticipantCount?
presentCount?
absentCount?
attendanceNotes?
externalAttendanceRef?

commonContent
typeSpecificContent

revisionReason?
submittedAt?
submittedByUserId?
verifiedAt?
verifiedByUserId?

version
createdAt
updatedAt
```

## 16. Report types

Canonical report discriminator:

```text
practicum
exam
workshop
general
```

The report type controls server validation of type-specific content.

### Common report content

Common semantic fields include:

- objective/purpose;
- material/topic/agenda;
- software/resources used;
- attendance/participant summary;
- operational opening/closing condition references;
- issues encountered;
- follow-up;
- outcome/reflection;
- Incident references;
- attachment metadata.

### Practicum

Additional examples:

- academic class/subject snapshots;
- learning/practicum topic;
- practical steps;
- software/tools;
- learning outcome/reflection.

### Exam

Additional examples:

- exam/activity classification;
- proctor/technician;
- readiness;
- participant summary;
- continuity/interruption notes;
- accommodation/evidence.

### Workshop

Additional examples:

- organizer;
- facilitator;
- agenda;
- resources;
- output/result.

### General

Additional examples:

- activity owner;
- classification;
- resource/room use;
- result.

Exact physical JSON/table storage is not locked by S3.1. Server validation by `reportType` is locked.

## 17. Report lifecycle

Canonical ActivityReport states:

```text
draft
submitted
revision_required
verified
```

Transitions:

```text
draft ──submit──> submitted

submitted ──verify──> verified
submitted ──request revision(reason)──> revision_required

revision_required ──reopen/edit──> draft
```

Rules:

- only `draft` content is freely editable;
- `submitted` is read-only until verified or returned;
- revision request requires a reason;
- `verified` is terminal for ordinary workflow;
- no hard delete;
- correcting a verified report requires a future explicit correction/addendum contract rather than direct overwrite.

## 18. Composite user-facing execution state

Frontend status is derived from operational source + Session + ActivityReport.

| Condition | UX state |
| --- | --- |
| eligible future source, no Session | `scheduled` |
| source ready/current, no Session or Session prepared | `not_started` |
| Session in progress | `in_progress` |
| Session ended but report missing because of legacy/recovery | `awaiting_report` |
| Report draft | `report_draft` |
| Report submitted | `report_submitted` |
| Report revision required | `revision_required` |
| Report verified | `verified` |
| source/session cancelled before execution | `cancelled` |

The UX can map these to Indonesian labels:

- Terjadwal
- Belum Dimulai
- Berlangsung
- Menunggu Laporan
- Laporan Draft
- Laporan Diajukan
- Perlu Perbaikan
- Terverifikasi
- Dibatalkan

The composite status is a read model, not another mutable status column that competes with Session/ActivityReport state.

## 19. Completion semantics

A Laboratory execution is operationally finished when the Session is `ended`.

The **workflow** is complete only when the associated ActivityReport satisfies the current reporting policy.

Until tenant-configurable policy exists, S3 uses the conservative baseline:

```text
workflow complete = ActivityReport verified
```

A future tenant policy may relax verification for selected report types, but cannot make the report itself optional for a completed canonical Session.

A cancelled pre-start Session requires no ActivityReport.

## 20. Attendance boundary with HADIRA

SmartLab does not become an individual student attendance system.

ActivityReport may store aggregate execution evidence such as:

```text
plannedParticipantCount
presentCount
absentCount
attendanceNotes
```

and an optional external reference:

```text
externalAttendanceSystem
externalAttendanceReferenceId
```

Individual student attendance, reasons, lateness, and attendance history belong to HADIRA when integrated.

SmartLab must not duplicate a second authoritative per-student attendance ledger.

If aggregate totals differ from planned participants, the report may require an explanatory note according to report-type policy; S3.1 does not hard-code a universal equality rule.

## 21. Responsible person versus authenticated actor

Academic responsibility and authenticated mutation identity are separate concepts.

A scheduled teacher may exist in Academic Master without a SmartLab login.

Therefore Session/Report may preserve:

```text
responsibleTeacherId?
responsibleNameSnapshot
```

while lifecycle audit independently records:

```text
actorUserId
actorMembershipId
actorNameSnapshot
```

The authenticated actor is never inferred from a teacher display name.

## 22. Device observations and Incident boundary

The current browser prototype automatically creates Incident records from free-text broken-PC entries when a Session is finished.

That behavior is **not** the canonical target.

S3 defines an execution observation concept:

```text
SessionIssueObservation
- id
- sessionId
- subjectType        device | asset | facility | other
- referenceId?
- summary
- severity
- observedAt
- incidentId?
```

An observation is evidence from the execution; it is not automatically a full Incident.

Promotion/linkage to a canonical Incident must be explicit and permission-checked.

If Incident creation is requested:

- use stable Device/Asset references when available;
- preserve Session/Report provenance;
- prevent accidental duplicate ticket creation;
- audit the link.

Session completion itself must not silently create Incident tickets from arbitrary text.

## 23. Attachments

Report attachments are metadata references, not raw blobs in the ActivityReport row.

Conceptual metadata includes:

```text
id
reportId
storageProvider
storageKey
fileName
mediaType
sizeBytes
sha256
uploadedBy
createdAt
```

Allowed file types, maximum size, malware scanning, retention, and storage provider are implementation/security decisions for a focused attachment slice.

A report must remain readable when an attachment is temporarily unavailable.

## 24. Manual backfill report

Manual report entry is exceptional and exists only for:

- legacy migration;
- historical backfill;
- recovery from an approved data-gap procedure.

It does not create a fake Session or fake canonical scheduling source.

Required evidence:

```text
origin = manual_backfill
manualBackfillReason
occurredOn
laboratoryId
responsible person snapshot
activity description
createdBy actor
audit event
```

Manual backfill requires a dedicated elevated permission.

It cannot be used as an ordinary shortcut around Reservation/Priority/Event execution.

## 25. Offline-capable report drafts

The product goal includes offline-capable journal/report drafting.

Offline capability does **not** change server authority.

Target rule:

- canonical ActivityReport ID/version is server-issued before normal offline editing;
- client may cache draft content locally;
- draft mutations use a stable client mutation ID plus base server version;
- reconnect sync is idempotent;
- version conflicts never use blind last-write-wins;
- unsynced local content is retained until the user resolves a conflict;
- `submit`, `verify`, and `request revision` require confirmed server state;
- lifecycle transitions are not fabricated offline.

Attachment offline queues are separate from report-content sync.

S3.1 locks these semantics but does not require offline implementation in the first backend PR.

## 26. Optimistic concurrency

LaboratorySession and ActivityReport each have independent integer versions.

Material state changes require an optimistic precondition such as:

```http
If-Match: "<current-version>"
```

Missing/malformed precondition:

```text
428 PRECONDITION_REQUIRED
```

Stale version:

```text
412 SESSION_VERSION_CONFLICT
412 ACTIVITY_REPORT_VERSION_CONFLICT
```

State transitions also run inside database transactions and re-read authoritative source state.

## 27. Audit events

Conceptual Session events:

```text
laboratory_session.prepared
laboratory_session.started
laboratory_session.ended
laboratory_session.cancelled
```

Conceptual Report events:

```text
activity_report.created
activity_report.updated
activity_report.submitted
activity_report.revision_requested
activity_report.reopened
activity_report.verified
activity_report.manual_backfill_created
```

Audit payloads store meaningful transition evidence and versions, not full uncontrolled copies of sensitive report content.

## 28. Authorization baseline

S3 introduces server permission families conceptually as:

```text
sessions.view
sessions.view-all
sessions.prepare
sessions.start
sessions.end
sessions.cancel
sessions.export

activity-reports.view
activity-reports.view-all
activity-reports.edit
activity-reports.submit
activity-reports.verify
activity-reports.request-revision
activity-reports.create-backfill
activity-reports.export
```

Baseline intent:

### Super Admin

All Session and ActivityReport permissions.

### Admin Lab

All normal Session/Report operations, including verification and controlled backfill.

### Kepala Lab

View all, normal execution operations where appropriate, verification/revision, export.

### Guru

View own eligible executions, prepare/start/end own permitted source, edit/submit own report. No verification and no manual backfill.

### Teknisi

Read baseline. Starting/ending on behalf of a Priority Event or technical activity requires a future explicit executor/delegation assignment rather than blanket mutation permission.

### Ketua Kelas

No canonical Session mutation by default until a delegation model is locked.

### Siswa

No Session/Report mutation.

### Pimpinan

Read all/export; no operational mutation.

This intentionally defaults ambiguous delegated execution to deny rather than broad role access.

Server permission/policy is authoritative; frontend guards are UX only.

## 29. Query/read model

The canonical Pelaksanaan Lab screen should not require the browser to merge local repositories.

A server execution read model may combine:

- eligible ScheduleOccurrences;
- approved Reservations;
- approved Priority Events;
- existing LaboratorySessions;
- associated ActivityReports.

Required filters include at least:

- date/range;
- Laboratory;
- source type;
- composite status;
- academic class/teacher when applicable;
- report status;
- own/all scope.

The read model must preserve source type and identifiers so every row is explainable.

## 30. Frontend migration target

Target experience:

```text
/sessions
  ├─ Hari Ini
  ├─ Sedang Berlangsung
  ├─ Menunggu Laporan
  └─ Riwayat & Laporan
```

`/journals` remains a compatibility/deep-link route during migration and must not become a second source of truth.

It should eventually redirect or route into the report/history view of the canonical Pelaksanaan Lab workflow.

No working route is removed silently.

## 31. Legacy prototype migration

Current browser-local Session/Journal records are not canonical.

Migration rules:

1. do not upload local prototype seed records as if they were production evidence;
2. identify any genuinely retained user-created legacy records separately from demo seed data;
3. map stable Laboratory/source references where evidence exists;
4. never infer canonical schedule/reservation identity from display names alone;
5. records without trustworthy execution source become manual backfill candidates, not fake ScheduleOccurrences;
6. preserve original legacy identifiers in migration metadata when imported;
7. ambiguous records require manual review;
8. after canonical cutover, `/sessions` and `/journals` must not combine server records with local prototype records.

## 32. Failure behavior

### Source unavailable or changed before start

Fail closed. Do not start from stale prepared evidence.

### TESSELA unavailable after a valid source occurrence was already materialized

Use canonical current active ScheduleOccurrence data under the existing S2 availability rules; do not invent a new timetable.

### Report draft creation failure while ending Session

Do not leave an ambiguous normal canonical Session/report relationship. The end transaction must either establish the ended Session plus its draft or fail.

### Incident service unavailable

Do not fabricate Incident IDs. Preserve observation evidence and allow Incident linkage retry separately.

### Attachment unavailable

Report remains readable; attachment metadata indicates failure/unavailability.

### Offline draft conflict

Preserve local unsynced content and require reconciliation; never silently overwrite the newer server draft.

## 33. Security and privacy

- School/tenant scope is mandatory on every query/mutation.
- Session source IDs must be resolved inside the active School.
- Actor identity comes from authenticated session/membership.
- Student-level attendance is not copied into SmartLab as a competing ledger.
- Reports must not become a channel for invasive device/user monitoring.
- Attachment access follows report authorization.
- Audit records avoid unnecessary sensitive content.
- There is no hidden screenshot, keystroke, browser-history, or personal-file collection.

## 34. Non-goals

S3 does not:

- implement a timetable solver;
- change recurring TESSELA schedules;
- auto-approve Reservation/Priority Event;
- permit arbitrary manual operational Session creation;
- create a second individual attendance system;
- auto-create canonical Incidents from free text;
- treat report verification as student assessment;
- implement Work Order/stock consumption;
- implement PC telemetry;
- silently merge offline conflicts.

## 35. S3 implementation sequence

### S3.1 — Contract lock

This document.

### S3.2 — LaboratorySession backend — implemented

Delivered:

- persistence + event history;
- source eligibility and preparation;
- explicit `Teacher.membership_id` ownership for Guru schedule sources;
- start-time source fingerprint revalidation;
- duplicate-source protection;
- start/end/cancel lifecycle;
- Session-aware Reservation/Priority/ScheduleException and Laboratory-deactivation guards;
- in-progress Session availability blocker;
- timetable publication `active_session_conflict`;
- permissions, OpenAPI 0.20, and integration tests.

No frontend cutover yet. ActivityReport is still absent, so S3.2 end records report-pending evidence; S3.3 must make normal end + report draft atomic before `/sessions` becomes canonical.

### S3.3 — ActivityReport backend — implemented

Delivered:

- 1:1 normal Session report;
- atomic draft creation on Session end;
- report type discriminator/validation;
- draft/edit/submit/revision/verify;
- manual backfill permission/path;
- aggregate attendance boundary;
- versioning/audit;
- API contract and tests.

### S3.4 — Unified Pelaksanaan Lab frontend

Cut `/sessions` to canonical server authority:

- Today;
- In Progress;
- Awaiting Report;
- History & Reports;
- mobile-first execution actions;
- report editing/submission/verification.

Keep `/journals` as a safe compatibility/deep-link path.

### S3.5 — Observation, Incident linkage, attachments

Implement explicit issue observations, Incident promotion/linkage, and attachment metadata/storage policy.

### S3.6 — Offline draft sync and UAT

Implement controlled offline report draft support, conflict UX, idempotent sync, and end-to-end operational UAT.

## 36. S3.1 exit criteria

S3.1 is complete when repository documentation consistently states that:

- Session has exactly one approved canonical source type;
- manual operational Session creation is not a normal path;
- source state is revalidated before start;
- planned source evidence is preserved separately from actual execution;
- in-progress Session becomes operational occupancy;
- source mutations cannot silently invalidate prepared/in-progress Sessions;
- normal ended Session gets exactly one ActivityReport draft;
- individual attendance remains outside SmartLab authority;
- Incident creation is explicit, not automatic from free text;
- offline drafts preserve server authority/version conflicts;
- permission baseline and phased implementation order are recorded.

No database/API/frontend implementation is required for S3.1.
