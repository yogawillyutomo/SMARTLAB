# P0 Frontend Stabilization

This backlog captures the first stabilization work before Laravel integration. Product workflow direction is defined in [the operational workflow specification](../product/SMARTLAB_OPERATIONAL_WORKFLOW_SPEC.md); this remains a concise execution backlog rather than a duplicate product specification.

**Status legend:** Selesai means merged into `main`; Dalam perencanaan means approved/planned but not implemented in the current frontend.

## P0-01 Authentication hydration — Selesai
- Hydrate authentication before route guards redirect.
- Add an explicit hydration/loading state.
- Make “remember me” choose persistent vs session storage.

## P0-02 Dynamic permissions — Selesai
- Use one persisted permission source for menus, page guards, and action guards.
- Prevent view-only roles from mutating monitoring, inventory, incidents, or maintenance.

## P0-03 Real CRUD behavior — Selesai
- Replace toast-only Master Data actions with repository-backed persistence.
- Ensure every primary button changes state or clearly indicates unavailable functionality.

## P0-04 Device–asset–incident integrity — Dalam perencanaan
- Resolve selected PC positions to device and asset identifiers.
- Replace free-text broken-PC entry with icon-based selection.
- Persist `brokenPCsBefore` and create incidents against valid asset IDs.

## P0-05 Inventory integrity — Dalam perencanaan
- Reject spare-part use exceeding available stock.
- Use transactional domain behavior when the Laravel API is introduced.

## P0-06 Document numbering — Dalam perencanaan
- Use persistent sequences and dynamic year/settings.
- Separate internal IDs from display numbers.

## P0-07 Deep links — Dalam perencanaan
- Read route parameters for session, journal, monitoring device, incident, and work-order detail routes.
- Ensure global search and notifications open the correct record.

## P0-08 Functional filters and settings — Dalam perencanaan
- Implement real schedule day/week/list behavior.
- Apply report date/lab filters.
- Make document formats and accent/theme settings functional.

Theme detail: the UI store supports Light, Dark, and System, but current application bootstrap applies Dark after UI hydration. Fix this only in a focused settings/UI PR with regression verification.

## P0-09 Form architecture — Dalam perencanaan
- Adopt React Hook Form and Zod for complex forms.
- Validate duplicate codes, date ordering, quantities, attendance totals, and file constraints.

## P0-10 Baseline cleanup — Dalam perencanaan
- Remove unused Supabase dependency.
- Set document language to Indonesian.
- Replace Vite/Bolt metadata and imagery with SmartLab branding.
- Make lint, typecheck, and build pass in CI.

## Approved follow-up backlog (not automatically P0)

| Item | Scope | Dependencies / sequence |
| --- | --- | --- |
| WF-01 | Safely migrate approved operational terminology and navigation. | Preserve routes, deep links, and session/journal data. |
| MD-01 | Academic master data: teachers, classes, subjects, years, semesters. | Teachers remain distinct from user accounts. |
| IMP-01 | Excel import preview, validation, stable-code matching, audit. | Depends on MD-01. |
| AV-01 | Shared laboratory availability engine. | Schedule, reservation, priority, maintenance, closure, exception sources. |
| OV-01 | Priority event and non-destructive occurrence override. | Depends on AV-01 and approved authority. |
| EX-01 | Unified Pelaksanaan Lab and linked activity reports. | Depends on dated occurrence model; preserves legacy journals. |
| LAYOUT-01 | Layout integrity and stable Device–Asset–Incident linkage. | Covers P0-04 direction without expanding monitoring scope. |

Recommended sequence: MD-01 → IMP-01 → AV-01 → regular schedule/reservation work → OV-01 → EX-01, while LAYOUT-01 progresses with the asset/device domain. Each item needs a focused PR and normal validation evidence; listing it here does not change permissions, backend contracts, or data migrations.
