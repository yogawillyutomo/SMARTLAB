# Unified Laboratory Availability Contract

**Status:** Implemented in S2.5 and extended through S2.8

SmartLab evaluates one School-local Laboratory and one local date/time window against canonical operational evidence.

## Decision states

- `available`: schedule coverage is complete and no blocker overlaps the requested half-open interval.
- `scheduled`: one or more active TESSELA ScheduleOccurrences overlap the window.
- `blocked`: a SmartLab operational blocker overlaps the window, such as a blocked Calendar Event or inactive Laboratory.
- `mixed`: both schedule occupancy and operational blockers overlap.
- `unknown`: no blocker is known, but SmartLab cannot prove availability because schedule publication coverage is missing or ambiguous.

`available=true` is emitted only for the `available` state.

## Fail-closed coverage rule

Absence of ScheduleOccurrence rows does **not** prove that a Laboratory is free.

For the requested date SmartLab counts active TimetablePublications whose effective range covers the date:

- exactly one -> `schedule.status=covered`;
- zero -> `missing`;
- more than one -> `ambiguous`.

When no blocker exists and coverage is missing/ambiguous, the result is `unknown`, never `available`.

A known blocker is still enough to return unavailable even when schedule coverage is incomplete; the response also carries the coverage issue.

## Time overlap

All checks use half-open interval semantics:

```text
existing.start < requested.end
AND
existing.end > requested.start
```

Therefore an occurrence ending at 08:45 does not conflict with a request beginning exactly at 08:45.

All date/time query values are interpreted in the School's local operational clock. S2.5 does not convert schedule snapshots to another timezone.

## Canonical sources in S2.5

1. Laboratory status.
2. Active TESSELA-backed ScheduleOccurrence rows from an active publication covering the date.
3. Active dated ScheduleException overlays: cancellation suppresses source occupancy; relocation suppresses the original and creates schedule occupancy on the replacement Laboratory.
4. Submitted or approved LaboratoryReservation rows for the requested Laboratory/date.
5. Approved PriorityEvent rows for the requested Laboratory/date/time.
6. Active OperationalCalendarEvent rows whose scope is School or the requested Laboratory.

Active relocations, submitted/approved reservations, approved Priority Events, and blocked Calendar Events become blockers. Informational Calendar Events are returned separately as notices and do not change availability.

## Deferred sources

S2.5 intentionally does not yet include:

- canonical preventive/corrective maintenance unavailability outside the current Calendar blocker mechanism.

S2.6 Reservation, S2.7 Schedule Exception, and S2.8 Priority Event extend this same service rather than adding parallel conflict logic. Later operational sources must do the same.
