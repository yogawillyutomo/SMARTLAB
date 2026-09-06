# SMARTLAB Documentation Convergence Audit

**Audit date:** 2026-09-06  
**Remote baseline:** `main@a15d39128126f42591b4b5e1236e8d3e4711fd53`  
**Latest merged PR:** #73  
**Relevant open PR:** #74 (`0dc1556554835d5da3c363976a6ab49adb41d44d`)  
**Scope:** documentation convergence only; no runtime/domain redesign

## Evidence hierarchy

When statements disagree, use this order:

1. remote repository/branch/commit and merged Git history;
2. executable source, migrations, tests and machine-readable contracts;
3. exact-head CI/check evidence;
4. accepted ADR/domain contracts;
5. current architecture/source-of-truth documents;
6. product/backlog narrative documents;
7. prompt snapshots or historical planning prose.

An open PR is relevant current development evidence, but its code/documentation is **not merged authority** until it lands.

## Verified repository inventory

### Top level

```text
.editorconfig
.github/
.gitignore
AGENTS.md
README.md
apps/
docs/
infrastructure/
packages/
scripts/
services/
```

### Documentation on verified main

```text
docs/
├── architecture/
├── backlog/
├── development/
├── product/
└── references/
```

There is no `docs/README.md` and no `docs/reviews/` on the verified `main` baseline. This convergence tranche adds the former. Open PR #74 proposes the latter with the first S3.6 operational-UAT artifact.

### Machine-readable contracts

`packages/contracts/` contains the contract README, root OpenAPI document, and split contracts for academic master, sessions, ActivityReports, availability, calendar, reservations, schedule exceptions, Priority Events, and published timetables. It remains outside `docs/` by design.

### Infrastructure

```text
infrastructure/
├── deployment/README.md
├── docker/README.md
└── nginx/README.md
```

All three are placeholder/reserved documentation at the verified baseline. They are not production configuration evidence.

## Documentation drift matrix

| document | declared current milestone | actual repository reality | stale statement | required correction | authority |
| --- | --- | --- | --- | --- | --- |
| `README.md` | S3.5 delivered; S3.6 is next | `main` is S3.5, but PR #74 is already open for S3.6 with passing API/web checks | “next slice is S3.6” omits active PR reality | keep merged-main truth, but link the canonical docs index and treat PR #74 as in-progress/unmerged evidence | repository summary; subordinate to source/Git/CI |
| `docs/architecture/CURRENT_STATE.md` | S3.2–S3.5 canonical; S3.6 planned next | accurate for merged `main`; PR #74 proposes the S3.6 update | not materially stale for merged main, but becomes outdated once #74 lands | do not duplicate-edit in this tranche because #74 already carries the S3.6 reconciliation; revalidate after #74 changes state | current architecture snapshot |
| `docs/architecture/REPOSITORY_STRUCTURE.md` | describes PC Agent and infrastructure as if runtime structures exist; lists `docs/reviews` | PC Agent is documentation-only; infrastructure is placeholder; `docs/reviews` absent on main | current-vs-target status is not explicit | distinguish current runtime from reserved target, mark infrastructure placeholders, and describe reviews as optional/pending rather than existing | repository layout guide |
| `docs/architecture/source-of-truth-migration.md` | detailed S2 + S3.1–S3.5 delivery, then S3.6 next | main matches through S3.5; PR #74 implements S3.6 but is not merged | some transitional prose still reads like earlier S3 entry context | avoid competing edits while #74 already updates this file; canonical index records the open-PR state | migration authority / detailed roadmap |
| `docs/product/SMARTLAB_OPERATIONAL_WORKFLOW_SPEC.md` | sections still say S3.2 current, ActivityReport absent, `/sessions` local; historical gap table calls availability/priority/session work missing | S3.3–S3.5 are merged and canonical; `/sessions` cut over in S3.4; ActivityReport is canonical; S3.6 PR open | explicit current-state claims are stale | update current implementation rows; relabel old gap/roadmap tables as historical planning baseline and point to `docs/README.md` for current roadmap | product workflow specification; not implementation authority |
| `docs/backlog/P0_FRONTEND_STABILIZATION.md` | EX-01 stops at S3.2 and says Session UI/report transitional; next work “Phase S3” | S3.3–S3.5 are merged; S3.6 is open in #74 | follow-up table and closing paragraph are stale | mark EX-01 canonical through S3.5, S3.6 in progress, and direct future sequence to S4 after S3.6 exit | backlog/history; not higher than source/Git |
| `docs/reviews/` references | repository docs imply review directory exists | directory absent on main; #74 adds first review file | structure statement can be read as current inventory | document it as review-evidence location “when present”; do not fabricate directory/files on main | review evidence location |
| `infrastructure/*/README.md` | reserved/planned | exactly placeholder state | risk is external docs describing them as complete | preserve placeholder wording and make canonical docs index explicitly state “not production ready” | infrastructure location; currently non-executable |
| `packages/contracts/` | integration source of truth | present and actively versioned through S3.5 on main; #74 proposes OpenAPI 0.24 | no taxonomy drift requiring move | keep outside `docs/`; link it from the docs index | machine-readable integration authority |

## Source cross-check for S3.3–S3.5

The drift classification above is supported by executable/main-tree evidence, including:

- `ActivityReportMutationService`, `ActivityReportController`, `ActivityReport` model and ActivityReport migrations;
- `LaboratorySession*` application/domain/controller/model classes and Session migrations;
- `SessionIssueObservationService`, observation controller/model and S3.5 migration;
- `ActivityReportAttachmentService`, attachment controller/model and private evidence configuration;
- typed frontend `laboratorySessionApi` and `activityReportApi` clients;
- merged S3.4 `/sessions` source-of-truth cutover;
- OpenAPI session/report contracts;
- main exact-head API/web CI success.

The current `main` must therefore not be described as “S3.2 only” or as still using browser-local Session/Journal authority.

## Pull request and CI reconciliation

### Main

- HEAD: `a15d39128126f42591b4b5e1236e8d3e4711fd53`
- commit: S3.5 / PR #73
- `api-ci`: PASS
- `web-ci`: PASS
- Vercel commit status: FAILURE due build-rate-limit

The last item prevents an “all checks green” claim.

### Open PR #74

- title: S3.6 offline ActivityReport draft sync and UAT
- head: `0dc1556554835d5da3c363976a6ab49adb41d44d`
- base: current `main`
- mergeable at audit time: true; mergeable state reported unstable because not every status surface is green
- `api-ci`: PASS
- `web-ci`: PASS
- operator browser UAT: explicitly still required by the PR contract

PR #74 must remain “in progress / unmerged” in documentation until its state changes.

## Authority boundary reconciliation

The local SMARTLAB boundary is consistent with Bakaran Platform migration references:

- BP Master Data / School Core target owns shared School, Person, PhysicalSpace, and academic references;
- canonical Person mapping does not implicitly grant SMARTLAB SchoolMembership or product role;
- SMARTLAB SchoolMembership/RBAC remains product-local;
- TESSELA remains sole timetable-generation/publication authority;
- SMARTLAB remains Laboratory and laboratory-operations authority;
- Device, Layout, Transfer, Incident, maintenance and telemetry lifecycles stay SMARTLAB-owned;
- a future Laboratory→PhysicalSpace mapping does not move Device/Incident lifecycle into School Core;
- canonical identity changes must not silently rewrite immutable/historical SMARTLAB evidence.

Relevant Bakaran Platform references:

- `docs/09-migration/06-smartlab-adoption.md`
- `docs/09-migration/08-historical-data-policy.md`

## Taxonomy assessment

The long-term target is sound:

```text
docs/
├── README.md
├── product/
├── architecture/
├── domains/
├── adr/
├── security/
├── testing/
├── operations/
├── development/
├── backlog/
├── reviews/
└── references/
```

### Decision for this tranche

**Adopt the taxonomy as a target, not as a mass-move operation.**

Reasons:

- current links and Git history already point into `docs/architecture/`;
- ADR/domain contracts are stable enough that cosmetic relocation would create churn without improving authority;
- `docs/security/`, `docs/testing/`, and `docs/operations/` do not yet have enough mature content to justify synthetic folders;
- `packages/contracts/` is correctly outside documentation;
- `infrastructure/` is correctly outside documentation and must become executable/runtime evidence in a dedicated production-readiness tranche.

A later move should be justified by concrete navigation or ownership problems and should include link migration/redirect strategy.

## Production documentation debt

| area | current evidence | production gap | gate |
| --- | --- | --- | --- |
| production topology | none canonical | nodes/services/network/trust boundaries | required |
| Docker | placeholder README | image/build/runtime composition and hardening | required |
| Nginx/reverse proxy | placeholder README | routing, TLS, headers, limits, static/API policy | required |
| environments/secrets | `.env.example`-level app setup only | secret ownership, rotation, injection, prohibited storage | required |
| Redis/queue/scheduler | architectural expectation | worker topology, retries, failure/dead-letter, scheduler ownership | required |
| migrations | app migrations + CI | deployment ordering, zero/low-downtime policy, rollback compatibility | required |
| backup | placeholder | schedule, scope, encryption, retention, ownership | required |
| restore | placeholder | tested restore procedure and evidence | required |
| rollback | placeholder | app/schema/config rollback procedure and decision gate | required |
| health/readiness | not production-defined | probes, dependencies, failure semantics | required |
| logging | app/runtime logs only | structured fields, correlation, retention/access | required |
| metrics | none production-defined | service/domain SLI metrics | required |
| alerting | none production-defined | thresholds, routing, escalation | required |
| observability | placeholder-level | dashboards, traces where needed, ownership | required |
| incident response | none canonical | severity, triage, comms, evidence preservation, postmortem | required |
| security hardening | distributed rules | deployment hardening checklist and review evidence | required |
| data retention | not production-locked | domain-by-domain retention/deletion/archive policy | required |
| PC Agent deployment | not implemented | enrollment, signed/reviewed build, update, credential rotation/revocation, recovery | required before telemetry rollout |
| disaster recovery | none canonical | RPO/RTO, dependency strategy, rehearsal | required |
| exact release evidence | CI only | release commit/artifact/config/migration/UAT/approval/deploy/rollback record | required |

No placeholder README may be cited as proof that these capabilities exist.

## Reconciliation actions in this tranche

1. add `docs/README.md` as the canonical human documentation index;
2. add this audit as evidence for the convergence decision;
3. reconcile repository-structure wording with actual current/reserved state;
4. correct explicit S3.2-era current-state claims in the product workflow spec;
5. correct the S3.2-era frontend backlog row and next-phase language;
6. link the root README to the canonical docs index;
7. leave `CURRENT_STATE.md`, `source-of-truth-migration.md`, and the Session/ActivityReport contract untouched here where PR #74 already carries focused S3.6 updates, avoiding unnecessary parallel-conflict churn;
8. do not move large documentation trees or machine-readable contracts.

## Next functional gate

Because PR #74 already contains S3.6 implementation, the practical next functional gate is:

1. complete the operator-required S3.6 browser UAT;
2. make an explicit merge decision for #74;
3. verify the exact merged head and all required checks after merge;
4. only then declare S3 complete and begin S4 contract/authority work.

This documentation tranche does not implement S3.6 and does not authorize its merge.
