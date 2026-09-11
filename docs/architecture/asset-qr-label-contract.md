# Asset QR Identity & Label Batch Contract

**Status:** LOCKED FOR S5.6 IMPLEMENTATION  
**Baseline:** `main@276326946bd4d4b9c6cf7073058886a893279e52`  
**Branch:** `feat/s5-6-asset-qr-labels`  
**Product brand:** LARAS — Laboratory Asset & Resource Administration System  
**Canonical public origin:** `https://laras.bakaranproject.com`

Brand/domain authority is additionally locked in [LARAS Brand & Canonical Domain Contract](../product/LARAS_BRAND.md).

## 1. Purpose

S5.6 adds a durable Asset-owned QR identity and printable physical-label workflow for canonical LARAS Assets. It does not create a new Asset, Device, Inventory, Loan, Maintenance, Work Order, scheduling, or Laboratory-availability authority.

The physical QR is an entry point to live canonical data. It is not a copy of mutable technical, financial, custody, or operational state.

## 2. Ownership boundary

- One QR identity belongs to exactly one canonical Asset.
- Device remains technical authority. Existing Device QR identity is not reused as the Asset QR.
- Asset remains administrative/custody subject authority.
- Loan, MaintenanceExecution, WorkOrder, Incident, and LaboratorySession never own the physical Asset sticker.
- Replacing/upgrading RAM, storage, OS, or another Device technical profile does not require replacing the Asset sticker.
- Asset↔Device link/unlink does not rotate the Asset QR by itself.

## 3. Physical QR payload — canonical public URL

The physical label encodes the permanent LARAS HTTPS public URL:

`https://laras.bakaranproject.com/q/<public-uuid>`

Rules:

1. the only record identifier in the URL is the random, non-enumerable public UUID;
2. the URL must never contain Asset ULID, School ULID, Device ULID, serial number, price, funding, supplier, notes, borrower/person identity, Loan/Maintenance/Work Order identifiers, audit/event payload, or technical specifications;
3. production `VITE_PUBLIC_SCAN_ORIGIN` is exactly `https://laras.bakaranproject.com`;
4. production label generation must fail closed when that origin is not configured or the resulting public URL exceeds the locked QR capacity;
5. Vercel preview/development hostnames or other transient hosting URLs must never become physical-label authority;
6. hosting infrastructure may change later, but the canonical LARAS domain must remain compatible with already-issued physical labels.

The QR encoder is local and dependency-free, uses Version 8 / ECC H with a four-module quiet zone, and does not send the payload to an external QR/CDN/chart service.

A leaked or photographed label therefore reveals only a public web URL containing the random public UUID. The public page still returns only the safe-minimal projection below.

## 4. Identity lifecycle

`AssetQrIdentity` is history-preserving:

- `active` — current public identifier for one Asset;
- `revoked` — no longer resolves publicly.

Rules:

1. One Asset has at most one active QR identity.
2. `public_id` is globally unique and random.
3. `token_version` increases monotonically per Asset.
4. Rotation revokes the current row and inserts a new row transactionally.
5. Revocation requires actor snapshot, reason, and timestamp.
6. A revoked public identifier resolves as not found; it never redirects to a replacement token.
7. Identity issue/rotation/revoke does not increment Asset `version`.
8. Historical identity rows are never deleted or rewritten except the single active→revoked transition and nullable live-actor FK cleanup.

## 5. Anonymous public scan projection

`/q/{publicId}` is a public LARAS web route. It resolves through the dedicated anonymous API projection and must never reuse the canonical `AssetResource`.

Allowed anonymous fields are intentionally minimal:

- display-safe School name/code;
- Asset code;
- Asset name;
- category;
- condition label;
- lifecycle status;
- Home Laboratory code/name when assigned.

Anonymous scan must not expose:

- internal Asset, School, Device, Loan, Work Order, Maintenance, Incident, membership, or actor IDs;
- serial number;
- acquisition/purchase data, price/value, funding source, or supplier;
- internal notes;
- linked Device technical profile/specifications;
- borrower/custody identity;
- Incident/Work Order/Maintenance history;
- actor identity or audit data.

Unknown, malformed, revoked, or otherwise invalid public UUIDs use the same safe not-found behavior. Old rotated tokens never redirect to the replacement token.

A browser session does not silently expand the anonymous response. The public page remains safe-minimal even when the browser is also logged in.

## 6. Login handoff and authenticated expansion

Sensitive or richer information requires LARAS authentication **and** existing authorization.

Flow:

1. phone camera opens `https://laras.bakaranproject.com/q/{publicId}`;
2. public page shows only the safe-minimal projection;
3. user chooses **Masuk LARAS untuk detail lengkap**;
4. login preserves a safe internal return path back to the same `/q/{publicId}` page;
5. after login, an authenticated resolver may return only the canonical `assetId` when:
   - the user has an active SchoolMembership;
   - the active School is the same School that owns the QR identity;
   - the user has `assets.view`;
6. the browser then enters the protected canonical `/assets/{assetId}` page;
7. other richer domains remain protected by their own permissions (`devices.view`, `loans.view`, `maintenance.view`, `work-orders.view`, and so on).

Login therefore grants no implicit Asset visibility and never bypasses tenant isolation or RBAC.

Platform Super Admin has no implicit tenant access; the normal active SchoolMembership boundary remains mandatory.

## 7. Permissions

S5.6 introduces:

- `assets.manage-qr` — issue, rotate, or revoke Asset QR identity;
- `assets.generate-labels` — create label batches and record reprints.

Generation is least-privilege:

- `assets.generate-labels` + `assets.view` are required for label generation;
- `assets.manage-qr` is additionally required only when at least one selected Asset lacks an active QR and generation would issue it;
- a batch made entirely from Assets with active QR identities does not require `assets.manage-qr`.

Baseline grants:

- `admin-lab`: both;
- `kepala-lab`: both;
- `super-admin`: both only through the existing all-catalog role and still subject to active membership;
- no automatic grants to `teknisi`, `guru`, `ketua-kelas`, `siswa`, or `pimpinan`.

## 8. Label batch authority

`AssetQrLabelBatch` records one immutable generation request. `AssetQrLabelBatchItem` records the exact Assets and active QR identities selected at that time.

Batch filters may include:

- Home Laboratory;
- Asset category;
- lifecycle;
- condition;
- linked/unlinked Device state;
- QR active/missing state;
- search;
- printed/not-yet-printed state derived from canonical batch history.

Initial physical templates:

- `40x25` mm;
- `50x30` mm — default;
- `70x40` mm.

A batch stores generated-by snapshots, selected filters, template, count, generation time, and per-item Asset/QR/Laboratory snapshots. Reprints are separate append-only events; batch/item rows are not rewritten.

The API `scanPath` snapshot may identify the anonymous API resolver path, but the physical QR itself encodes the canonical LARAS public web `/q/{publicId}` URL.

## 9. Label content

A label may show:

- LARAS / BP branding;
- QR;
- Asset code;
- short Asset name;
- Home Laboratory code/name when space allows.

A label must not show price, funding, supplier, borrower, audit metadata, or sensitive serial information.

QR rendering must use high error correction, preserve the quiet zone, and keep the centered BP mark small enough that real-world scanning remains reliable. Physical phone scan success is the controlling UAT evidence.

## 10. Deployment requirements

Before physical labels are accepted:

- `laras.bakaranproject.com` must resolve to the approved LARAS web deployment;
- `VITE_PUBLIC_SCAN_ORIGIN` must be exactly `https://laras.bakaranproject.com` for production label generation;
- `VITE_API_ORIGIN` must point to the deployed Laravel API when the web host does not proxy `/api`;
- the public `/q/{publicId}` SPA route must resolve on direct navigation;
- the anonymous API must be reachable from the public web origin under the deployed CORS/session policy;
- the authenticated login handoff must return to the same QR route safely.

Preview deployment success alone does not prove any of these runtime conditions.

## 11. Non-effects

QR issuance, rotation, revocation, public scan, login handoff, batch generation, preview, PDF creation, download, print, and reprint must not:

- change Asset condition/lifecycle/home Laboratory/version;
- mutate Device lifecycle/home Laboratory/technical profile;
- create or release Loan/Maintenance/Work Order custody;
- consume Inventory;
- create or resolve Incident;
- create Laboratory closure/availability blockers;
- modify TESSELA schedule or Operational Calendar.

## 12. Persistence invariants

Database enforcement must guarantee:

- same-School Asset↔QR identity binding;
- globally unique public identifier;
- unique token version per Asset;
- at most one active identity per Asset;
- exact active→revoked state evidence;
- immutable batch configuration;
- exact batch-item Asset↔QR snapshot binding at insertion;
- immutable batch items;
- immutable generation/reprint events;
- actor snapshot retention if live User/Membership rows are later removed.

SQLite portable tests and PostgreSQL validation both remain required.

## 13. Brand migration compatibility

S5.6 rebrands user-facing product surfaces to **LARAS**. The GitHub repository name `SMARTLAB`, existing API/internal identifiers, legacy `SMARTLAB_*` environment-variable names, `@smartlab.local` test identities, and existing browser storage keys may remain temporarily for compatibility. They are not public brand authority and must not be renamed incidentally merely for cosmetic consistency inside PR #90.

## 14. Delivery slices

- **S5.6.1:** persistence, permissions, identity lifecycle API, safe public resolution, tests, OpenAPI.
- **S5.6.2:** label batch API, filters, generation/reprint evidence, frontend preview.
- **S5.6.3:** A4 PDF rendering, 40×25 / 50×30 / 70×40 templates, BP mark composition, download/print UX.
- **S5.6.4:** canonical LARAS public URL QR + safe public page + authenticated detail handoff + browser UAT + physical phone scan UAT + privacy/security verification + post-merge regression.

S6 monitoring telemetry remains deferred until S5.6 closes.
