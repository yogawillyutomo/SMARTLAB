# P0 Frontend Stabilization

This backlog captures the first stabilization work before Laravel integration.

## P0-01 Authentication hydration
- Hydrate authentication before route guards redirect.
- Add an explicit hydration/loading state.
- Make “remember me” choose persistent vs session storage.

## P0-02 Dynamic permissions
- Use one persisted permission source for menus, page guards, and action guards.
- Prevent view-only roles from mutating monitoring, inventory, incidents, or maintenance.

## P0-03 Real CRUD behavior
- Replace toast-only Master Data actions with repository-backed persistence.
- Ensure every primary button changes state or clearly indicates unavailable functionality.

## P0-04 Device–asset–incident integrity
- Resolve selected PC positions to device and asset identifiers.
- Replace free-text broken-PC entry with icon-based selection.
- Persist `brokenPCsBefore` and create incidents against valid asset IDs.

## P0-05 Inventory integrity
- Reject spare-part use exceeding available stock.
- Use transactional domain behavior when the Laravel API is introduced.

## P0-06 Document numbering
- Use persistent sequences and dynamic year/settings.
- Separate internal IDs from display numbers.

## P0-07 Deep links
- Read route parameters for session, journal, monitoring device, incident, and work-order detail routes.
- Ensure global search and notifications open the correct record.

## P0-08 Functional filters and settings
- Implement real schedule day/week/list behavior.
- Apply report date/lab filters.
- Make document formats and accent/theme settings functional.

## P0-09 Form architecture
- Adopt React Hook Form and Zod for complex forms.
- Validate duplicate codes, date ordering, quantities, attendance totals, and file constraints.

## P0-10 Baseline cleanup
- Remove unused Supabase dependency.
- Set document language to Indonesian.
- Replace Vite/Bolt metadata and imagery with SmartLab branding.
- Make lint, typecheck, and build pass in CI.
