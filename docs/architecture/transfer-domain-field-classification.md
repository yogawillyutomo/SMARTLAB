# Transfer Domain Field Classification

Status: Proposed companion to Transfer Domain Contract RFC

This companion classifies the proposed executed `device_transfers` record. It is architecture-only; it does not add a table or change an existing schema.

| Field | Class | Required | Mutable | Authority | Historical treatment |
| --- | --- | --- | --- | --- | --- |
| `id` | A: durable identity | yes | no | Transfer server | ULID snapshot |
| `school_id` | B: tenant/security | yes | no | active SchoolMembership | live FK, restrict School deletion |
| `device_id` | B: relationship | nullable live join | no | Device domain | null-on-delete; never history authority |
| `device_id_snapshot` | A: historical identity | yes | no | Transfer transaction | immutable ULID |
| `device_code_snapshot` | E: display snapshot | yes | no | Device at execution | immutable bounded string |
| `source_laboratory_id` | B: relationship | nullable live join | no | source Device home at execution | null-on-delete |
| `destination_laboratory_id` | B: relationship | nullable live join | no | validated destination | null-on-delete |
| `source_laboratory_id_snapshot` | A: historical identity | yes | no | source Laboratory at execution | immutable ULID |
| `destination_laboratory_id_snapshot` | A: historical identity | yes | no | destination Laboratory at execution | immutable ULID |
| `source_laboratory_code_snapshot` | E: display snapshot | yes | no | source Laboratory at execution | immutable bounded string |
| `destination_laboratory_code_snapshot` | E: display snapshot | yes | no | destination Laboratory at execution | immutable bounded string |
| `source_laboratory_name_snapshot` | E: display snapshot | yes | no | source Laboratory at execution | immutable bounded string |
| `destination_laboratory_name_snapshot` | E: display snapshot | yes | no | destination Laboratory at execution | immutable bounded string |
| `actor_user_id` | B: relationship | nullable live join | no | authenticated actor | null-on-delete |
| `actor_user_id_snapshot` | A: historical identity | yes | no | authenticated actor | immutable ULID |
| `actor_name_snapshot` | E: display snapshot | yes | no | actor at execution | immutable bounded string |
| `reason` | E: operator explanation | no | no | authenticated request | immutable, bounded, redacted from secrets |
| `device_version_before` | C: concurrency evidence | yes | no | locked Device row | immutable integer |
| `device_version_after` | C: concurrency evidence | yes | no | committed Device row | immutable integer |
| `created_at` | D: event time | yes | no | server clock | immutable timestamp |

## Classification boundaries

- No client-supplied `schoolId`, source ID, actor ID, status, approval state, Layout ID, placement, Asset ID, current location, Loan destination, Maintenance state, telemetry field, or retry token is accepted.
- The source Laboratory is not a request field. A tenant-scoped pre-read uses the Device's current `homeLaboratoryId` as a candidate, then the locked Device row and `If-Match` version establish final authority. A null home returns `TRANSFER_SOURCE_UNASSIGNED`.
- Live foreign keys are optional convenience joins only. Snapshot fields are authoritative for historical reconstruction.
- `reason` is an explanation, not an approval, workflow status, incident, or maintenance note. It must be length-limited and must not contain secrets or unrestricted personal data.
- Device `version` remains the single source for stale-state protection; Transfer has no competing aggregate version.
- No field authorizes a destination Layout placement. “Unplaced after Transfer” means no placement was created; the Layout unplaced-candidate endpoint remains a narrower projection that excludes retired Devices.

## Cross-domain mapping

| Concern | Transfer owns | Transfer must not own |
| --- | --- | --- |
| Permanent home custody | executed source/destination event and Device home mutation | temporary current location |
| Device identity | immutable snapshots and Device reference | changing Device ID, code, or QR |
| Layout | precondition checks and historical references | active/archive mutation or destination placement |
| Loan/Maintenance | fail-closed integration precondition in v1 | custody lifecycle and return/repair workflow |
| Asset | none in v1 | accounting, procurement, condition, or Asset transfer |
| Audit | durable transfer row and one Device transfer event | rejected-attempt event spam or unrelated telemetry |
