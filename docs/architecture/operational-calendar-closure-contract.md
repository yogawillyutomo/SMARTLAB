# Operational Calendar & Closure Contract

**Status:** Implemented in S2.4

SmartLab owns dated operational calendar events that may affect laboratory availability without rewriting TESSELA timetable data.

## Core semantics

- `scope=school` applies to all laboratories and requires no Laboratory ID.
- `scope=laboratory` applies only to one SmartLab Laboratory.
- `availabilityEffect=informational` never blocks availability.
- `availabilityEffect=blocked` is an explicit blocker consumed by S2.5.
- Category describes business context; category does not silently determine availability.
- Multi-day events are all-day only in S2.4.
- Partial-day events are restricted to one local calendar date with a valid start/end time.
- Events are versioned with ETag / If-Match and cancelled, never hard-deleted.
- Overlapping blockers are allowed and preserved independently; S2.5 will combine their provenance.

## Relationship to TESSELA

A calendar closure never edits `TimetableEntry` or `ScheduleOccurrence`.

Example:

```text
TESSELA occurrence
2026-09-14 · LAB-RPL-1 · 07:00-09:15

SmartLab calendar blocker
2026-09-14 · LAB-RPL-1 · maintenance · blocked

Result in S2.5
occurrence remains immutable
availability = blocked
reason = calendar event
```

Structural timetable changes remain TESSELA publication changes. Dated operational reality remains SmartLab-owned.
