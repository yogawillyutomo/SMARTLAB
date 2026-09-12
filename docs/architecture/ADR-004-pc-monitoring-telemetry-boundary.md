# ADR-004 — PC Monitoring Telemetry Boundary

**Status:** PROPOSED — S6 planning only; implementation and merge are blocked until S5.6 closes  
**Date:** 2026-09-12  
**Decision scope:** LARAS PC-agent identity, enrollment/revocation, approved telemetry, Device authority, privacy, retention, and monitoring-read boundaries.

## Context

LARAS already has canonical School-scoped Device inventory and technical profiles. The `/monitoring` UI intentionally shows only canonical Device data today and explicitly refuses to fabricate realtime state. S6 adds real PC monitoring without turning the agent into a surveillance or remote-administration product.

Repository policy already reserves `services/pc-agent` for a Go-based Windows service and allows only device-health telemetry. Keylogging, screenshots, browser history, personal documents, and user-content collection are prohibited.

The main architectural risk is not chart rendering. It is allowing an untrusted endpoint to impersonate another Device, cross School boundaries, mutate Device authority, or silently expand telemetry into invasive collection.

## Decision

### 1. Device remains canonical authority

The PC agent is telemetry evidence for one exact canonical Device. It does not own or mutate:

- Device lifecycle, code, home Laboratory, serial number, or canonical technical profile;
- Asset lifecycle/condition or Asset↔Device linkage;
- Loan, Maintenance, Work Order, Incident, Inventory, Availability, TESSELA, or Calendar authority.

Observed agent data may expose drift against the canonical Device profile, but it must never auto-rewrite canonical Device data. Reconciliation is an explicit future operator workflow.

### 2. One active installation is bound to one exact Device

S6 v1 uses a server-authorized enrollment flow:

1. an authorized human creates a short-lived, single-use enrollment code for one exact Device;
2. the Windows agent redeems only that code over TLS;
3. the server derives School and Device identity from the enrollment record — the agent never supplies authoritative `schoolId` or `deviceId` during normal telemetry ingestion;
4. successful redemption creates one active `DeviceAgentInstallation` and returns a machine credential once;
5. re-enrollment/replacement must revoke the prior active installation under a serialized Device-scoped write.

S6 v1 allows enrollment only for eligible Windows-capable Device types: `desktop_pc`, `laptop`, and `server`, and only while the Device lifecycle is eligible for monitoring. Terminal/ineligible Device state must fail closed.

No MAC address, Windows MachineGuid, motherboard UUID, or other hardware fingerprint becomes canonical identity authority.

### 3. Machine authentication is separate from user authentication

PC-agent endpoints do not use a browser session as machine identity.

Proposed v1 credential model:

- credential identifier + cryptographically random 256-bit secret;
- secret returned only once at enrollment;
- server persists only a one-way secret hash plus lifecycle metadata;
- agent stores the secret using Windows DPAPI LocalMachine protection in a service-owned location with restrictive ACLs;
- TLS is mandatory;
- revoked credentials are rejected immediately;
- credentials must never appear in application logs, audit payloads, URLs, query strings, or telemetry bodies.

Bearer-token machine auth is accepted for v1 because TLS, high-entropy per-installation credentials, hashed-at-rest secrets, DPAPI storage, revocation, rate limits, and exact Device binding provide a materially smaller attack surface than introducing an unproven custom signing protocol. HMAC/mTLS may be revisited only with a concrete threat or deployment requirement.

### 4. Approved telemetry is narrowly enumerated

S6 v1 may collect only:

- heartbeat / server receive freshness;
- agent version and service health metadata;
- CPU utilization;
- memory total/used;
- fixed-volume disk total/free;
- network link state and aggregate byte counters/rates, without destination/URL history or packet content;
- system uptime;
- OS name/version/build/architecture;
- non-user hardware inventory such as CPU model/core count, RAM capacity, disk model/capacity, and display/GPU model where reliably available.

S6 v1 explicitly does **not** collect:

- keystrokes;
- screenshots/screen recording;
- webcam/microphone data;
- browser history, URLs, DNS history, or packet capture;
- documents or file contents;
- usernames, typed content, clipboard, personal identifiers, or account activity;
- process lists or installed-application lists;
- arbitrary shell output;
- temperature/sensor telemetry as a baseline requirement.

Temperature is intentionally excluded from S6 v1 because Windows sensor availability is inconsistent and the current repository privacy contract does not list it as approved default telemetry.

### 5. Online/offline is a telemetry read model, not Device lifecycle

Online state is derived from **server `received_at`**, never from the agent clock or a writable Device field.

Default policy proposal:

- heartbeat every 60 seconds;
- `online` when last server receive age is <= 150 seconds;
- `stale` when > 150 seconds and <= 600 seconds;
- `offline` when > 600 seconds;
- `not_enrolled` and `revoked` are explicit non-telemetry states.

Late buffered samples may reconstruct historical metrics but can never backdate a Device into `online` state.

### 6. History is append-oriented; current status is a projection

S6 separates:

- mutable latest-state projection for efficient monitoring reads;
- append-oriented metric samples for bounded history;
- append-oriented hardware snapshots only when normalized inventory changes;
- durable enrollment/revocation evidence.

Initial proposal:

- metric sample every 5 minutes;
- 30-day raw metric retention;
- hardware snapshots retained on change;
- latest projection retained while the Device exists;
- retention cleanup is server-controlled and tested.

At 500 monitored PCs, a 5-minute sample interval produces about 144,000 metric samples/day (~4.32 million/30 days), which remains feasible on ordinary PostgreSQL without introducing TimescaleDB as a new dependency. This is a sizing estimate, not a production benchmark.

### 7. Offline buffering is bounded and idempotent

The agent buffers metric samples locally during network loss:

- maximum 24 hours of 5-minute samples (288 samples per installation by default);
- oldest samples are dropped when the bound is exceeded, with a local dropped-sample counter surfaced after reconnect;
- retry uses exponential backoff with jitter and a bounded maximum delay;
- reconnect sends bounded batches (proposed maximum 100 samples/request);
- each sample has a stable random `sampleId`, boot identifier, and monotonic sequence so server retries are idempotent and gaps/restarts can be explained.

The server rejects samples too far in the future and samples older than the accepted backfill window. `received_at` remains server-owned.

### 8. Realtime v1 uses polling, not a new websocket authority

S6 does not require Redis/WebSocket/SSE infrastructure merely to display near-realtime health.

Initial UI proposal:

- agent heartbeat: 60 seconds;
- web monitoring refresh: 30 seconds while visible;
- standard authenticated HTTP read endpoints;
- later push transport may optimize presentation but must not become telemetry authority.

### 9. No remote-control channel in S6 core

S6 core must not implement:

- arbitrary commands/shell execution;
- remote desktop/control;
- file upload/download from PCs;
- browser control;
- power actions;
- software installation/removal;
- unsigned or silently downloaded agent updates.

A signed agent-update mechanism is a later security tranche. Until then, update policy is explicit manual/admin-controlled deployment. If automatic updates are introduced later, signature verification and rollback policy are mandatory before enablement.

### 10. No automatic operational side effects

Telemetry may show health state and threshold badges, but S6 v1 does not automatically:

- change Device lifecycle;
- change Asset condition;
- create/close Incident;
- create Work Order;
- consume Inventory;
- block a Laboratory;
- notify users persistently.

Persistent notifications/analytics belong to S7 unless a later accepted contract explicitly moves a narrowly defined alert into S6.

## Security consequences

Implementation must include:

- one-time expiring enrollment codes stored hashed;
- revocable per-installation credentials stored hashed server-side and protected by DPAPI on Windows;
- machine-specific middleware separate from Sanctum user authorization;
- School/Device scope derived from credential, not request body;
- request/body size caps and rate limits;
- strict telemetry schema validation and numeric bounds;
- duplicate/replay idempotency;
- no credential/body logging;
- audit events for human enrollment creation, redemption, revocation, and replacement;
- cross-School negative tests and PostgreSQL concurrency tests.

## Product consequences

`/monitoring` can evolve from canonical Device inventory into genuine telemetry without losing the existing Global Laboratory Context. Devices without an active agent remain visible and are labelled `not_enrolled`; no synthetic values are generated.

## Deferred

- signed automatic updater;
- remote command/control;
- automated Incident/Work Order creation;
- long-term analytical rollups beyond initial retention;
- non-Windows agents;
- sensor temperature/fan telemetry;
- process/application inventory;
- remote support tooling;
- integration into S7 notifications/analytics.

## Implementation gate

This ADR is planning-only. S6 implementation must not start until S5.6 Asset QR Identity & Label Batch closes its required runtime/privacy/physical-scan gates and is merged.

## Related contracts

- [PC Monitoring Telemetry Contract](pc-monitoring-telemetry-contract.md)
- [S6 Telemetry UAT / Security Plan](../reviews/s6-pc-monitoring-telemetry-uat-plan.md)
- [Current Architecture State](CURRENT_STATE.md)
- [Agent Instructions](../../AGENTS.md)
