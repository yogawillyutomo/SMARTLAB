# Dated Schedule Exception Contract

**Status:** Implemented in S2.7

SmartLab owns date-specific operational exceptions over immutable Schedule Occurrences produced from the active TESSELA timetable publication.

## Scope locked for S2.7

S2.7 supports exactly two resolutions:

- `cancel`: suppress the affected occurrence for that date only;
- `relocate`: keep the same occurrence date/time, teacher, class, subject, and activity, but use another SmartLab Laboratory for that date only.

S2.7 deliberately does **not** move an occurrence to another date or clock time. Changing time/date can create teacher/class conflicts and belongs to timetable planning/solving unless a later, explicitly bounded operational policy is approved.

Priority-event replacement and its request/approval workflow remain S2.8.

## Immutable source plan

A Schedule Exception never updates these TESSELA-derived fields:

- ScheduleOccurrence ID;
- publication/entry identity;
- source publication ID/version;
- source schedule ID;
- occurrence date;
- teacher;
- class;
- subject;
- start/end time;
- planned Laboratory.

The exception stores source identity snapshots for audit and overlays operational behavior.

## One active exception per occurrence

At most one active Schedule Exception may exist for one ScheduleOccurrence.

Historical cancelled exceptions are retained. Applying another exception after cancellation creates another auditable row rather than rewriting the previous history.

## Direct approval

S2.7 is an authorized direct-action workflow, not a pending request workflow.

Baseline mutation authority:

- Super Admin: create/cancel;
- Admin Lab: create/cancel;
- Kepala Lab: create/cancel.

Teknisi and Pimpinan receive read-only exception visibility. Guru does not receive exception mutation authority.

The authenticated user and SchoolMembership become the approver identity; clients do not supply approver fields.

## Relocation validation

Relocation must:

1. target a different Laboratory from the source planned Laboratory;
2. target a Laboratory in the same School;
3. target an active Laboratory;
4. satisfy the current AcademicClass student count when that count is known;
5. pass Unified Laboratory Availability for the exact original occurrence date/time.

The source occurrence itself is not treated as occupancy on the replacement Laboratory, so no solver or timetable rewrite is performed.

## Availability overlay

Unified Availability interprets an active exception as follows.

### Cancel

For the source planned Laboratory:

```text
TESSELA ScheduleOccurrence
        +
active exception = cancel
        ↓
source occurrence suppressed for that date
```

No replacement schedule occupancy is created.

### Relocate

```text
TESSELA occurrence at LAB-A
        +
active exception = relocate LAB-B
        ↓
LAB-A: source occurrence suppressed
LAB-B: Schedule Exception becomes schedule occupancy
```

The relocation blocker keeps source occurrence, publication, schedule, teacher, class, and subject provenance.

A relocation counts as schedule occupancy, so Unified Availability reports `scheduled` (or `mixed` when another operational blocker also exists), not a generic `blocked` state.

## Current-plan read model

`GET /schedule-occurrences` continues to return the immutable planned fields and additionally returns:

- `operationalStatus = scheduled | cancelled | relocated`;
- `operationalLaboratory`;
- active `exception` metadata.

This means consumers can always distinguish the TESSELA plan from the effective SmartLab operation.

## Concurrency

Exception mutations use database transactions and row locks.

Creation locks the source ScheduleOccurrence and all involved Laboratories. Laboratory IDs are locked in deterministic order.

This coordinates with Reservation mutations, which also serialize on Laboratory rows. A relocation and a competing reservation therefore cannot both safely claim the same Laboratory window through supported mutation paths.

## Cancellation / restoration

Cancelling an active exception does not blindly remove the overlay.

If the source publication remains active and the occurrence has an original planned Laboratory, SmartLab checks whether restoring that source occurrence would now be safe. The check excludes the exception being cancelled and the source occurrence itself from the preflight calculation.

If another blocker now occupies the original Laboratory window, cancellation fails closed with `SCHEDULE_EXCEPTION_RESTORATION_UNAVAILABLE`.

## Publication lifecycle

An exception may remain in historical storage after its source publication is superseded.

It is operational only while the referenced source occurrence belongs to the active current publication. Unified Availability does not project a relocation from a superseded source publication.

How a new TESSELA publication should preview and reconcile conflicts with existing future reservations/exceptions is intentionally deferred to S2.8.

## Audit and versioning

Material exception changes are append-oriented:

- `schedule_exception.applied`;
- `schedule_exception.cancelled`.

Each exception has an integer version. Cancellation requires:

```http
If-Match: "<current-version>"
```

Missing/malformed preconditions fail with HTTP 428. Stale versions fail with HTTP 412.

## Non-goals

S2.7 does not:

- solve or optimize a timetable;
- modify recurring TESSELA entries;
- change teacher/class/subject;
- move an occurrence to another date/time;
- implement priority-event override;
- auto-cancel reservations;
- silently migrate an exception to a newer TESSELA publication.
