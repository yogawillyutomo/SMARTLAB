# Incident Domain Field Classification

Status: Proposed — Pending Independent Review

Companion to: [Incident Domain Contract RFC](incident-domain-contract.md)

This companion classifies the current local prototype and the proposed canonical Incident v1 fields. It is architecture-only and does not add schema, API, permissions, or frontend behavior.

## 1. Classification vocabulary

| Classification | Meaning |
| --- | --- |
| Canonical Incident | Mutable or immutable current aggregate state owned by Incident |
| Canonical immutable snapshot | Report-time or event-time evidence retained independently of a live relationship |
| Derived projection | Computed for display/query and not stored as writable Incident authority |
| Incident event/history only | Append-only typed evidence in `IncidentEvent`, not mutable root state |
| Work Order-owned | Repair execution data belonging to the future Work Order aggregate |
| Future/deferred | Valid future concern excluded from Incident v1 |
| Rejected legacy/local field | Prototype representation that must not enter the canonical contract |

## 2. Legacy Incident field disposition

| Legacy field | Classification | Canonical disposition | Reason |
| --- | --- | --- | --- |
| `id` | Canonical Incident | server ULID | Stable aggregate identity |
| `ticketNumber` | Canonical Incident | server `INC-{UTC_YEAR}-{6 digits}` | Human identity; never client supplied |
| `reporterName` | Rejected legacy/local field | replace with server-derived reporter live references and immutable snapshots | Free text cannot authorize or reconstruct identity |
| `laboratoryId` | Canonical Incident + canonical immutable snapshot | same-School live reference plus ID/code/name snapshots | Required report context and stable historical display |
| `assetCode` | Future/deferred | no Asset dependency in Incident v1 | Asset backend/relationship is not canonical yet |
| `date` | Canonical Incident | split into client observation `occurredAt` and server `reportedAt` | Distinguishes occurrence from persistence time |
| `category` | Canonical Incident | closed machine enum | Indonesian/local values map at presentation layer |
| `title` | Canonical Incident | bounded report title | Mutable only while reported |
| `description` | Canonical Incident | bounded problem details | Mutable only while reported |
| `impact` | Canonical Incident | nullable bounded operational impact | Reporter/triage evidence, not repair diagnosis |
| `priority` | Canonical Incident | `low/normal/high/critical` | Operational priority, not Work Order scheduling authority |
| `blocksPracticum` | Canonical Incident | rename `blocksLaboratoryOperation` | General Laboratory operation boundary, not only practicum |
| `stepsTaken` | Canonical Incident | nullable immediate reporter actions | Not repair diagnosis/action ownership |
| `status` | Canonical Incident | closed machine lifecycle | Changes only through assignment/transition commands |
| `assignedTechnician` | Rejected legacy/local field | replace with canonical same-School membership plus snapshots | Free text cannot enforce eligibility or ownership |
| `workOrderId` | Rejected legacy/local field | future Work Order owns nullable `incident_id`; cardinality 0..N | Single reverse link is the wrong authority/cardinality |
| `comments` | Incident event/history only | `incident.comment_added` events | Append-only, actor-derived, aggregate-versioned |
| `timeline` | Derived projection | render from immutable Incident events | Local mutable array duplicates domain history |

## 3. Canonical Incident root fields

| Database field | API field | Required | Mutable states/command | Authority | Historical treatment |
| --- | --- | --- | --- | --- | --- |
| `id` | `id` | yes | never | server ULID | event `incident_id_snapshot` |
| `school_id` | omitted | yes | never | active membership | tenant boundary; restrict School deletion |
| `ticket_year` | omitted | yes | never | server UTC year | retained |
| `ticket_sequence` | omitted | yes | never | locked School/year sequence | retained; School/year unique |
| `ticket_number` | `ticketNumber` | yes | never | server formatter | copied to every event snapshot |
| `reporter_user_id` | live value not separately exposed | nullable live FK | never | authenticated User | null-on-delete convenience only |
| `reporter_membership_id` | omitted | nullable live FK | never | active membership | null-on-delete convenience only |
| `reporter_user_id_snapshot` | `reporter.userId` | yes | never | authenticated User | row-visibility/report evidence |
| `reporter_membership_id_snapshot` | omitted | yes | never | active membership | immutable context evidence |
| `reporter_name_snapshot` | `reporter.name` | yes | never | authenticated User | immutable display evidence |
| `laboratory_id` | live join not authority | nullable live FK | reported PATCH only | validated same-School active Laboratory | null-on-delete convenience |
| `laboratory_id_snapshot` | `laboratory.id` | yes | reported PATCH only | selected Laboratory | frozen after triage |
| `laboratory_code_snapshot` | `laboratory.code` | yes | reported PATCH only | selected Laboratory | frozen after triage |
| `laboratory_name_snapshot` | `laboratory.name` | yes | reported PATCH only | selected Laboratory | frozen after triage |
| `device_id` | live join not authority | nullable | reported PATCH only | validated optional Device | null-on-delete convenience |
| `device_id_snapshot` | `device.id` | nullable | reported PATCH only | selected Device | all Device snapshots null together when absent |
| `device_code_snapshot` | `device.deviceCode` | nullable | reported PATCH only | selected Device | frozen after triage |
| `device_type_snapshot` | `device.deviceType` | nullable | reported PATCH only | selected Device | frozen after triage |
| `category` | `category` | yes | PATCH while reported | create/PATCH allowlist | every change captured in event |
| `priority` | `priority` | yes | PATCH while reported; triage finalization | create/PATCH/transition | every change captured in event |
| `title` | `title` | yes | PATCH while reported | create/PATCH allowlist | every change captured in event |
| `description` | `description` | yes | PATCH while reported | create/PATCH allowlist | every change captured in event |
| `impact` | `impact` | no | PATCH while reported; triage finalization | create/PATCH/transition | every change captured in event |
| `blocks_laboratory_operation` | `blocksLaboratoryOperation` | yes | PATCH while reported; triage finalization | create/PATCH/transition | every change captured in event |
| `steps_taken` | `stepsTaken` | no | PATCH while reported | create/PATCH allowlist | every change captured in event |
| `occurred_at` | `occurredAt` | yes | PATCH while reported | client observation time | event evidence |
| `status` | `status` | yes | assignment/transition only | lifecycle graph | every transition captured |
| `assignee_membership_id` | `assignee.membershipId` | state-dependent | assignment only | eligible same-School membership | live pointer plus current snapshot |
| `assignee_user_id_snapshot` | `assignee.userId` | state-dependent | assignment only | assignee User at assignment | replacement updates current snapshot; events retain prior |
| `assignee_name_snapshot` | `assignee.name` | state-dependent | assignment only | assignee User at assignment | replacement updates current snapshot; events retain prior |
| `triage_summary` | `triageSummary` | triaged onward | triage transition only | approver command | triage event retains value |
| `resolution_summary` | `resolutionSummary` | resolved/verified/closed | resolve transition; cleared on reopen | resolver command | prior summaries remain in events |
| `rejection_reason` | `rejectionReason` | rejected only | reject transition only | approver command | rejection event retains value |
| `verification_note` | `verificationNote` | verified/closed | verify transition; cleared on reopen | approver command | prior note remains in events |
| `version` | `version` | yes | server only | aggregate transaction | event before/after pair |
| `reported_at` | `reportedAt` | yes | never | server clock | immutable report time |
| `triaged_at` | `triagedAt` | state-dependent | triage transition | server clock | event time also retained |
| `assigned_at` | `assignedAt` | state-dependent | initial assignment | server clock | first assignment evidence |
| `started_at` | `startedAt` | state-dependent | first start transition | server clock | first start retained; reopen does not replace it |
| `resolved_at` | `resolvedAt` | state-dependent | resolve; cleared on reopen | server clock | prior resolved event remains |
| `verified_at` | `verifiedAt` | state-dependent | verify; cleared on reopen | server clock | prior verified event remains |
| `closed_at` | `closedAt` | closed only | close transition | server clock | immutable terminal time |
| `rejected_at` | `rejectedAt` | rejected only | reject transition | server clock | immutable terminal time |
| `created_at` | `createdAt` | yes | never | server | equals persistence creation evidence |
| `updated_at` | `updatedAt` | yes | meaningful aggregate mutation | server | preserved on no-op |

## 4. Derived projections

| Projection | Source | Writable | Rule |
| --- | --- | --- | --- |
| Reporter own-scope | Incident School + `reporter_user_id_snapshot` + current User | no | used when caller lacks `incidents.view-all` |
| Laboratory display | Incident Laboratory snapshots | no | does not silently replace with current Laboratory name |
| Device display | Incident Device snapshots | no | null for Laboratory-level report |
| Assignee display | current Incident assignee snapshots | no | event history reconstructs prior assignments |
| Comment list | `incident.comment_added` events | no | ordered through event endpoint |
| Timeline | all typed Incident events | no | never persisted as mutable JSON array |
| Work Order count/list | future Work Order query by `incident_id` | no | omitted from Incident v1 DTO |
| Current Device/Laboratory status | live domain query with separate permissions | no | not embedded in Incident DTO |
| Open/terminal label | Incident status | no | UI mapping only |

## 5. IncidentEvent fields

| Field | Classification | Required | Authority | Rule |
| --- | --- | --- | --- | --- |
| `id` | Incident event/history only | yes | server ULID | comment ID for comment event |
| `school_id` | Incident event/history only | yes | Incident tenant | tenant-leading index |
| `incident_id` | Incident event/history only | nullable live FK | committed Incident | null-on-delete convenience; Incident has no v1 delete |
| `incident_id_snapshot` | Canonical immutable snapshot | yes | Incident at mutation | historical identity authority |
| `ticket_number_snapshot` | Canonical immutable snapshot | yes | Incident at mutation | display reconstruction |
| `actor_user_id` | Incident event/history only | nullable live FK | authenticated actor | null-on-delete convenience |
| `actor_membership_id` | Incident event/history only | nullable live FK | active membership | null-on-delete convenience |
| `actor_user_id_snapshot` | Canonical immutable snapshot | yes | authenticated actor | retained |
| `actor_membership_id_snapshot` | Canonical immutable snapshot | yes | active membership | retained |
| `actor_name_snapshot` | Canonical immutable snapshot | yes | actor at mutation | retained across rename/deactivation |
| `event_type` | Incident event/history only | yes | closed server catalog | cannot be client supplied |
| `incident_version_before` | Incident event/history only | yes | locked aggregate | zero only for reported event |
| `incident_version_after` | Incident event/history only | yes | committed aggregate | exactly before + 1 |
| `payload` | Incident event/history only | yes | event-specific validator | exact keys per event type; no arbitrary audit blob |
| `created_at` | Incident event/history only | yes | server clock | immutable |

Event payloads contain only the typed data required by the parent RFC. Sensitive authentication/session data, unrestricted request bodies, technical profiles, telemetry, Asset accounting, and Work Order repair data are prohibited.

## 6. Assignment field disposition

| Concern | Classification | Decision |
| --- | --- | --- |
| Free-text technician name | Rejected legacy/local field | never canonical |
| Current membership reference | Canonical Incident | nullable before assignment; command-owned |
| Current assignee User/name snapshot | Canonical immutable snapshot on root | represents current accountable assignee |
| Previous assignee | Incident event/history only | preserved in assigned/reassigned event payload |
| Role name | Derived projection/rejected authority | eligibility uses effective `incidents.update`, not role key |
| Email, phone, NIP/NIS | Rejected from Incident projection | not required for assignment UI/API |
| Unassignment | Future/deferred | excluded from v1; reassignment is the recovery path |

## 7. Lifecycle and explanation disposition

| Concern | Owner/classification | Decision |
| --- | --- | --- |
| Triage summary | Canonical Incident + event history | required on `reported -> triaged` |
| Rejection reason | Canonical Incident + event history | required on `reported -> rejected` |
| Resolution summary | Canonical Incident + event history | required for every resolve edge; current value cleared on reopen |
| Verification note | Canonical Incident + event history | required on `resolved -> verified`; current value cleared on reopen |
| Reopen reason | Incident event/history only | required on `resolved -> in_progress` |
| Reassignment reason | Incident event/history only | required for a different assignee |
| Waiting for spare parts | Work Order-owned | no Incident enum/field |
| Repair diagnosis/action | Work Order-owned | rejected from Incident payload |
| Repair schedule/start/end | Work Order-owned | Incident timestamps describe Incident lifecycle only |
| Spare parts/cost/test result | Work Order-owned | no Incident persistence |

## 8. Ticket sequence fields

| Field | Classification | Authority | Integrity |
| --- | --- | --- | --- |
| sequence `school_id` | Canonical Incident infrastructure | active School context | composite unique with year |
| `ticket_year` | Canonical Incident infrastructure | server UTC year | composite unique with School |
| `last_value` | Canonical Incident infrastructure | locked database row | positive, maximum 999,999 |
| formatted ticket | Canonical Incident | transaction formatter | unique in School; immutable |

The sequence row is not exposed through API and is not an Incident child aggregate. Its lock exists only to allocate one human number safely during create.

## 9. Cross-domain boundary table

| Domain concern | Incident stores | Incident must not store/mutate |
| --- | --- | --- |
| School/identity | tenant ID, reporter/actor/assignee snapshots | client-selected School or free-text identity |
| Laboratory | one subject live reference plus report snapshots | Laboratory status/capacity/layout/current occupancy |
| Device | optional live reference plus report snapshots | lifecycle, home custody, placement, QR, technical profile, telemetry |
| Asset | nothing in v1 | asset code, condition, depreciation, procurement, disposal |
| Work Order | no reverse authority | diagnosis, action, technician execution, parts, cost, waiting state |
| Comments | append-only comment events | mutable root comment array or delete/edit |
| Audit | typed Incident events | competing generic mutable timeline |
| Notifications | nothing in v1 | recipients, delivery state, preferences |
| Reporting/export | versioned Incident data and permissions | export job/file state in Incident aggregate |

## 10. Migration disposition

Local AppDB Incident records are not silently promoted by ID equality. A later migration requires reviewed mapping for School, reporter, Laboratory, optional Device, status, assignee, and historical times. Unmapped free-text reporter/technician/Asset evidence must remain in a preserved migration report or explicitly approved legacy snapshot extension; it must not be fabricated into canonical User, membership, Device, or Asset IDs.

Legacy `Menunggu Spare Part` maps to future Work Order state, not an Incident enum. Legacy records with that status require a reviewed status mapping based on surrounding evidence. Legacy single `workOrderId` becomes a candidate Work Order-side `incident_id` relationship; it never becomes an Incident column. No migration implementation belongs to this RFC.

## 11. Review status

Architecture blockers: none.

Independent review must confirm the field bounds, snapshot set, reported-state correction policy, comment-as-event representation, and Work Order exclusions before this companion is approved.
