# LARAS — Brand & Canonical Domain Contract

**Status:** LOCKED for the S5.6 rollout  
**Product brand:** LARAS  
**Expanded name:** Laboratory Asset & Resource Administration System  
**Descriptor:** Laboratory Management Platform  
**Owner / publisher:** Bakaran Project  
**Canonical public origin:** `https://laras.bakaranproject.com`

## Brand rule

User-facing product surfaces must use **LARAS**. The former **SMARTLAB / SmartLab** name is treated as a legacy technical/repository identifier during the migration window and must not be reintroduced into new user-facing copy.

The preferred presentation is:

> **LARAS**  
> Laboratory Management Platform  
> by Bakaran Project

The expanded name, **Laboratory Asset & Resource Administration System**, may be used in documentation, metadata, onboarding, and formal product descriptions. It does not need to be repeated in compact navigation surfaces.

## Canonical domain rule

All physical Asset QR labels must resolve through the permanent public origin:

`https://laras.bakaranproject.com/q/<public-uuid>`

The domain is an enduring product address, not a hosting-provider address. Vercel, another frontend host, the API host, or other infrastructure may change later without changing the physical QR contract. DNS/routing must preserve this public origin for already-issued labels.

Physical labels must never encode a Vercel preview hostname or another transient deployment URL.

## Runtime configuration

- `VITE_PUBLIC_SCAN_ORIGIN` must be set to `https://laras.bakaranproject.com` for production label generation.
- `VITE_API_ORIGIN` remains the deployed Laravel API origin when the web host does not provide an equivalent verified `/api` proxy.
- QR rendering must fail closed when the canonical public origin is absent or the resulting URL exceeds the locked QR capacity.

## Compatibility rule during S5.6

This tranche is a **brand migration, not an internal namespace rewrite**. Until S5.6 closes and the repository migration is planned separately, the following may intentionally retain the legacy SMARTLAB identifier:

- GitHub repository name `SMARTLAB`;
- branch/history references;
- database/schema/table names already shipped;
- PHP/TypeScript internal names where changing them has no user-facing value;
- existing API paths and permission keys;
- legacy environment-variable names such as `SMARTLAB_*`;
- local test identities such as `@smartlab.local`;
- browser storage keys such as `smartlab_pplg_ui` so existing preferences are not silently lost.

Do not rename those identifiers merely for cosmetic consistency inside PR #90. A later compatibility-safe migration may rename selected internals after S5.6 is merged and runtime/physical QR evidence is complete.

## Label/PDF rule

Newly generated physical labels and downloadable PDFs use **LARAS** branding. PDF filenames use the `laras-asset-labels-...pdf` prefix. The centered `BP` QR mark remains a Bakaran Project ownership mark and is independent from the product wordmark.

## Change control

Changing the product name, canonical public origin, QR route shape, or UUID-only identifier rule after physical labels are issued is a migration event. It requires an explicit compatibility plan and must not be performed as an incidental UI refactor.
