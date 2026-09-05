# Laboratory Reservation Contract

**Status:** Implemented in S2.6

SmartLab owns dated Laboratory reservations. Reservations do not mutate TESSELA timetable entries and do not create a second timetable authority.

## Lifecycle

```text
submitted
   ├── approved
   ├── rejected
   └── cancelled

approved
   └── cancelled
```

There is no in-place structural edit in S2.6. If a requester needs a different Laboratory/date/time/activity after submission, cancel the old request and submit a new reservation so the audit trail remains explicit.

## Slot-hold policy

Both `submitted` and `approved` reservations block Unified Laboratory Availability.

This intentionally matches the operational expectation that a submitted request temporarily holds its requested slot while awaiting a decision. `rejected` and `cancelled` reservations do not block.

## Submission safety

Reservation creation:

1. locks the selected Laboratory row with `FOR UPDATE`;
2. validates tenant ownership and participant capacity;
3. calls the canonical Unified Availability service;
4. fails closed unless `available=true`;
5. creates the reservation as `submitted`;
6. writes an append-oriented audit event;
7. commits the transaction.

The Laboratory row is the serialization lock for reservation mutations on that Laboratory. Competing overlapping submissions cannot both observe the same slot as free through the supported application path.

## Approval safety

Approval also locks the Laboratory and reservation, requires a matching `If-Match` version, and re-runs Unified Availability while excluding the reservation itself.

Therefore a reservation that was valid when submitted can still be refused at approval if operational reality changed, for example:

- a TESSELA-backed ScheduleOccurrence now overlaps;
- a new Calendar blocker exists;
- the Laboratory became inactive;
- another reservation holds the slot.

The reservation remains `submitted` when this re-check fails.

## Identity and visibility

Requester identity is derived from the authenticated user and active SchoolMembership. Clients cannot provide or override requester identity.

Baseline visibility:

- Guru: own reservations only; create and cancel own submitted/approved reservations.
- Admin Lab: all reservations; create, approve/reject, cancel, export.
- Kepala Lab: all reservations; approve/reject, cancel, export.
- Pimpinan: read/export all reservations.
- Super Admin: complete catalog permission set.

Cross-School reservations are never disclosed.

## Versioning and audit

Each reservation has an integer entity version.

Approve, reject, and cancel require:

```http
If-Match: "<current-version>"
```

Material lifecycle changes write append-oriented `laboratory_reservation_events` with actor snapshots and before/after versions.

## Relationship to schedule changes

An already approved reservation can become operationally conflicted if a newer TESSELA publication is activated later. S2.6 makes that conflict visible through Unified Availability. Publication impact/reconciliation policy remains part of the later S2.8 integration/UAT slice rather than silently rewriting either source.
