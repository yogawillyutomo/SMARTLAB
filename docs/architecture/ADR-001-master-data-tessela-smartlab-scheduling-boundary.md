# ADR-001: Master Data, TESSELA, and SmartLab Scheduling Boundary

**Status:** Accepted  
**Date:** 2026-09-05  
**Decision owner:** Bakaran Project / SmartLab  
**Applies before:** SmartLab Phase S2 — Scheduling & Availability

## Context

SmartLab already has a working Laravel/PostgreSQL Academic Master API with stable IDs for academic years, semesters, lesson-period sets, lesson periods, academic units, teachers, classes, and subjects.

The broader Bakaran Project architecture is also expected to provide shared Master Data for multiple products, while TESSELA is the dedicated timetable-generation product. Without an explicit boundary, SmartLab could accidentally become a second timetable solver or duplicate cross-product academic authority.

This ADR locks the target responsibilities before SmartLab implements canonical Scheduling & Availability.

## Decision summary

1. **Shared BP Master Data is the target cross-product authority for school-wide academic reference data.**
2. **TESSELA is the sole timetable-generation / constraint-solving authority.**
3. **SmartLab does not implement a school timetable solver.**
4. **SmartLab remains authoritative for Laboratory resources and operational laboratory use.**
5. **TESSELA may assign a planned laboratory/room in a published timetable, but that assignment references a SmartLab-owned Laboratory resource.**
6. **SmartLab owns date-specific operational exceptions, availability, reservations, sessions, and journals.**
7. **A one-date exception never destructively rewrites the recurring TESSELA timetable.**
8. **The Academic Master implementation already delivered in SmartLab is preserved and evolves into a compatibility projection/adapter when shared BP Master Data becomes available.**
9. **Published timetable versions are immutable integration artifacts. SmartLab validates and atomically activates a publication; it does not silently repair or optimize it.**

## Responsibility matrix

| Capability / data | BP Master Data | TESSELA | SmartLab |
| --- | --- | --- | --- |
| School / tenant academic identity | **Authoritative target** | consume | consume |
| Academic year | **Authoritative target** | consume | projection/reference |
| Semester | **Authoritative target** | consume | projection/reference |
| Academic units / programs / concentrations | **Authoritative target** | consume | projection/reference |
| Teacher master | **Authoritative target** | consume | projection/reference |
| Class / rombel master | **Authoritative target** | consume | projection/reference |
| Subject master | **Authoritative target** | consume | projection/reference |
| Lesson-period set / bell schedule | **Authoritative target** | consume | projection/reference |
| Lesson periods | **Authoritative target** | consume | projection/reference |
| Laboratory identity, capacity, status, operational properties | consume/reference if needed | consume as scheduling resource | **Authoritative** |
| School timetable constraints | reference data only | **Authoritative** | not owner |
| Timetable solving / optimization | no | **Authoritative** | **must not implement** |
| Published timetable version | reference | **Authoritative** | consume/import |
| Planned room/lab assignment in timetable | no | may assign reference | validate/reference |
| Laboratory availability | no | may consume planning snapshot | **Authoritative operationally** |
| Laboratory reservation | no | no | **Authoritative** |
| Date-specific lab closure | no | may be informed for future solve | **Authoritative** |
| Schedule exception for one occurrence | no | recurring plan unchanged | **Authoritative** |
| Priority-event override | no | recurring plan unchanged | **Authoritative** |
| Laboratory session / execution | no | no | **Authoritative** |
| Journal / activity report | no | no | **Authoritative** |

## What TESSELA owns

TESSELA answers:

> How should the school's academic timetable be arranged under its hard and soft constraints?

Typical TESSELA concerns include:

- teacher availability and collisions;
- class collisions;
- subject allocation;
- teaching-load constraints;
- day/period placement;
- room/laboratory candidate constraints when room allocation is part of the solve;
- hard/soft constraint evaluation;
- feasibility and optimization;
- timetable versions;
- publication of an approved timetable.

SmartLab must not duplicate these responsibilities.

### Validation is not solving

SmartLab may reject an imported published timetable that is structurally invalid for SmartLab integration, for example:

- unknown academic reference;
- unknown/inactive Laboratory reference;
- malformed period range;
- duplicate source identifier;
- overlapping duplicate occurrence inside one publication;
- invalid publication metadata.

That is **integration validation**, not timetable solving. SmartLab must not rearrange teachers, classes, subjects, times, or rooms to make an invalid publication feasible.

## What SmartLab owns

SmartLab answers:

> Given the published academic plan, how is actual laboratory use operated safely and auditable on a specific date?

SmartLab owns:

- Laboratory identity and operational status;
- capacity and operational properties of the laboratory;
- unified laboratory availability;
- reservations outside the regular timetable;
- dated closures;
- maintenance-related unavailability;
- priority events;
- dated schedule exceptions;
- operational room relocation for an affected occurrence;
- laboratory session lifecycle;
- journal / activity report;
- incident interaction with an occurrence/session;
- future telemetry/maintenance effects on operational availability.

## Laboratory / room allocation decision

A hybrid boundary is accepted.

### Planned allocation

TESSELA **may** publish a planned Laboratory reference as part of a timetable entry when room allocation is included in the solve.

Example:

```text
Monday · Period 1–3
Class: XI PPLG 1
Subject: Web Programming
Teacher: T-001
Planned Laboratory: LAB-RPL-1
```

TESSELA is not the owner of `LAB-RPL-1`. It only references the Laboratory resource owned by SmartLab.

### Operational allocation

SmartLab determines whether the planned Laboratory can actually be used for a dated occurrence.

Example:

```text
Recurring TESSELA plan:
Monday · Period 1–3 · LAB-RPL-1

2026-09-14:
LAB-RPL-1 unavailable because of maintenance

SmartLab exception:
2026-09-14 only
original laboratory = LAB-RPL-1
replacement laboratory = LAB-RPL-2
reason = maintenance
approved by = ...
```

The recurring TESSELA timetable is unchanged.

If the change becomes structural rather than exceptional, it should become input for a future TESSELA revision and publication, not an endless series of SmartLab exceptions.

## Target integration flow

```text
BP MASTER DATA
  │
  ├── school / academic year / semester
  ├── teacher / class / subject
  └── academic structure / lesson periods
  │
  ├──────────────► TESSELA
  │                  │
  │                  ├── constraint model
  │                  ├── solver
  │                  └── published timetable version
  │                                      │
  │                                      ▼
  └────────────────────────────────► SMARTLAB
                                         ▲
                                         │
SMARTLAB Laboratory catalog ─────────────┘
  │
  └────────► TESSELA may consume laboratory references/capabilities
             for planning when room assignment is solved

SMARTLAB after publication:
Published timetable
  + closures
  + maintenance unavailability
  + approved reservations
  + priority events
  + dated exceptions
  = operational laboratory availability
```

## Published timetable contract semantics

The exact transport can be implemented later, but the semantic envelope is locked.

A publication must have a stable identity and version, conceptually:

```text
publicationId
publicationVersion
schoolId
academicYearId
semesterId
publishedAt
effectiveFrom
effectiveTo
sourceSystem = TESSELA
entries[]
```

Each entry should carry enough stable references to reproduce the academic plan without relying on display text:

```text
sourceScheduleId
teacherId
classId
subjectId
lessonPeriodStartId / lessonPeriodEndId
dayOfWeek or explicit occurrence date where applicable
plannedLaboratoryId?   // SmartLab Laboratory reference
activityType
status
```

Human-readable names/codes may be included as snapshots for diagnostics, but they are not identity.

## Publication lifecycle

Published timetable versions are treated as immutable artifacts.

SmartLab import behavior must be:

1. receive/read the complete publication;
2. validate publication metadata and stable references;
3. validate Laboratory references that are present;
4. reject ambiguous or incomplete mappings;
5. stage the publication without replacing the active version;
6. complete validation for the entire publication;
7. atomically activate the publication;
8. retain previous publication metadata/history for audit and historical records.

SmartLab must not partially activate half of a timetable version.

A new TESSELA publication supersedes the previous plan prospectively according to its effective range. It must not rewrite historical completed Sessions, Journals, Incidents, or previously audited exceptions.

## Idempotency

Importing the same `publicationId + publicationVersion` again must be safe.

Expected behavior:

- identical payload: no duplicate schedule creation;
- same identity/version with different content: reject as integrity conflict;
- newer version: stage and validate as a new immutable publication;
- older version: do not silently reactivate over a newer active publication.

## Academic Master compatibility strategy

### Current state

SmartLab Academic Master is already implemented and canonical inside the current SmartLab product boundary.

This work is **not discarded**.

### Target state

When shared BP Master Data exists, SmartLab Academic Master becomes a synchronized projection/reference layer for externally owned academic entities.

The compatibility layer should preserve:

- existing SmartLab ULIDs where required for local referential integrity;
- stable external source identity;
- mapping between external and local IDs;
- source/version metadata;
- synchronization timestamps;
- deterministic idempotent upsert behavior.

Conceptual mapping metadata:

```text
sourceSystem
sourceEntityType
sourceId
localId
sourceVersion
syncedAt
```

Implementation may use explicit columns or a dedicated mapping table; this ADR locks the semantics, not the physical schema.

## Synchronization rules

When BP Master Data becomes authoritative:

1. externally owned fields must not silently fork inside SmartLab;
2. sync is idempotent;
3. ambiguous matching fails closed;
4. stable source IDs take precedence over display names;
5. historical local references remain resolvable;
6. deletion from the source must not cascade into destructive historical deletion;
7. inactive/archived state should be synchronized safely;
8. a temporary shared-service outage must not cause SmartLab to create a competing source of truth.

SmartLab may continue operating on the **last successfully synchronized projection** for already-known references where the business operation is safe to do so, but it must expose freshness/staleness when relevant.

It must not fabricate new external master identities while disconnected.

## Bootstrap / migration from current SmartLab master

When shared BP Master Data is introduced, migration should follow:

1. export current SmartLab academic entities;
2. map by stable source identity when already available;
3. otherwise use stable code plus controlled school scope;
4. flag ambiguous or duplicate matches for manual review;
5. never auto-merge ambiguous records by name;
6. create mapping records;
7. verify all schedule/session/history foreign references remain resolvable;
8. switch externally owned edit operations to the shared-master workflow only after reconciliation passes.

No destructive replacement migration is approved by this ADR.

## Availability model

SmartLab's unified availability evaluates, at minimum:

```text
Published TESSELA plan
+ SmartLab Reservations
+ Priority Events
+ Laboratory Closures
+ Maintenance Unavailability
+ Schedule Exceptions
= Operational Availability
```

A source with higher operational priority may affect a dated occurrence only through an explicit, authorized resolution.

## Date-specific exception rules

A dated exception may:

- cancel only the affected occurrence;
- move it to another SmartLab Laboratory;
- reschedule the dated occurrence;
- replace it with an approved priority event;
- preserve it when there is no real resource conflict.

A dated exception must contain:

- stable ID;
- source publication / schedule reference;
- affected date;
- original plan snapshot/reference;
- resolution;
- replacement resource/time where applicable;
- reason;
- requester/approver context;
- audit reference.

The recurring TESSELA schedule is not edited by this workflow.

## Conflict ownership

### Conflict discovered during TESSELA solve

TESSELA owns resolution.

### Structural conflict detected while importing a publication

SmartLab rejects the publication or affected invalid integration batch and reports the problem. It does not solve it.

### Operational conflict arising after publication

SmartLab owns resolution when caused by:

- dated closure;
- maintenance;
- approved reservation/policy;
- priority event;
- laboratory operational status;
- other SmartLab operational constraints.

If the resolution should become permanent/recurring, it is escalated as input for a future TESSELA timetable revision.

## Failure behavior

### BP Master Data unavailable

SmartLab may read its last synchronized projection for known references. It must not silently become the new cross-product academic authority.

### TESSELA unavailable

The last successfully activated published timetable remains usable for SmartLab operations. SmartLab does not invoke an internal replacement solver.

### New TESSELA publication fails validation

Keep the current active publication. Record/report the failure. Do not partially activate the new version.

### SmartLab unavailable

TESSELA publication remains valid at its source. Re-delivery/import must be idempotent after SmartLab recovers.

## Audit requirements

Material integration actions must be auditable:

- publication received;
- validation accepted/rejected;
- publication activated;
- previous publication superseded;
- reference mapping reconciled;
- dated exception created/approved/cancelled;
- planned laboratory replaced operationally.

Audit must preserve source publication/version identifiers.

## Security boundary

- service/user authentication is required for integration endpoints;
- tenant/school scope must be explicit and validated;
- SmartLab authorization remains enforced by Laravel Policies/permissions;
- an external timetable publication does not grant a user permission to create manual SmartLab exceptions;
- no display-name-only cross-tenant reference resolution is allowed.

## Explicit non-goals

This ADR does **not** approve:

- implementing the TESSELA solver inside SmartLab;
- copying TESSELA optimization algorithms into SmartLab;
- making SmartLab a second authority for teacher/class/subject master after BP Master Data exists;
- destructive replacement of current SmartLab Academic Master data;
- automatically changing recurring timetables due to one-date laboratory events;
- implementing remote desktop or invasive monitoring;
- choosing the final transport technology for service-to-service delivery.

## Consequences

### Positive

- no dual timetable source of truth;
- SmartLab can focus on laboratory operations;
- TESSELA remains independently evolvable as a timetable product;
- existing SmartLab academic-master work remains valuable;
- room assignment supports both planning and operational exceptions;
- historical sessions/journals stay reproducible against publication versions;
- S2 can proceed with a clear bounded context.

### Cost / complexity

- a mapping/projection layer is eventually required for shared Master Data;
- publication versioning and atomic activation add integration complexity;
- TESSELA needs access to stable SmartLab Laboratory references if it solves room allocation;
- structural operational changes require feedback into a future TESSELA publication instead of local permanent mutation.

## S2 entry gate after this ADR

Phase S2 may begin when implementation work respects this boundary.

The first S2 contract should model **published schedule ingestion/reference plus SmartLab operational availability**, not a solver.

Recommended sequence:

1. published timetable contract and version lifecycle;
2. SmartLab schedule projection/occurrence model;
3. calendar/closure model;
4. unified laboratory availability query;
5. reservations and approval;
6. dated schedule exceptions;
7. priority-event override;
8. integration UAT with TESSELA-style publication fixtures.

## Follow-up decisions still needed

These do not block the ownership boundary itself, but must be resolved in the relevant implementation PR:

- exact service-to-service transport and authentication mechanism;
- whether timetable publication is push, pull, or both;
- exact external-ID mapping schema;
- whether TESSELA consumes full Laboratory capability data or only stable lab references;
- approval chain for priority overrides;
- policy for capacity warnings vs hard rejection;
- retention duration for superseded publication payloads.
