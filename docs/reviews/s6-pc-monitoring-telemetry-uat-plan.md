# S6 — PC Monitoring Telemetry UAT / Security Plan

**Status:** PLANNING ONLY — do not execute as implementation evidence until S5.6 closes and the S6 contract is accepted.

This matrix separates automated, simulated-load, browser, and real-Windows evidence. A green CI run cannot substitute for machine-installation, privacy, offline-buffer, or revocation UAT.

## A. Contract / privacy gates

- [ ] Approved telemetry schema contains only enumerated device-health fields.
- [ ] Machine payload rejects unexpected fields.
- [ ] No collector for keystrokes, screenshots, audio/video, browser history, URLs, packet content, documents, clipboard, process list, installed applications, usernames, or arbitrary command output exists.
- [ ] Temperature/sensor telemetry is absent from S6 v1 unless a later accepted contract explicitly adds it.
- [ ] Observed hardware never auto-updates canonical `Device.technicalProfile`.
- [ ] Telemetry never auto-mutates Device lifecycle, Asset condition, Incident, Work Order, Inventory, Loan/Maintenance custody, Laboratory availability, Calendar, or TESSELA state.

## B. Enrollment / machine-auth automated gates

- [ ] Enrollment code has >=128 bits random entropy, is stored hashed, expires, and is single-use.
- [ ] Expired enrollment code is rejected.
- [ ] Redeemed code cannot be replayed.
- [ ] Cross-School Device enrollment fails closed.
- [ ] Ineligible Device type/lifecycle cannot enroll.
- [ ] At most one active installation exists per Device under PostgreSQL contention.
- [ ] Replacement/re-enrollment revokes the prior active installation atomically.
- [ ] Credential secret is returned only once and server storage contains only its hash.
- [ ] Revoked credential is rejected immediately for heartbeat, telemetry, and config.
- [ ] Machine scope is derived from credential; supplied/forged School/Device IDs cannot change scope.
- [ ] Machine endpoint is not authorized by browser session alone.
- [ ] Human enrollment/revoke endpoints require active SchoolMembership + exact permissions.
- [ ] Secrets are absent from application/audit logs and URLs.

## C. Telemetry ingestion automated gates

- [ ] CPU outside 0..100 fails validation.
- [ ] memory used > total fails validation.
- [ ] disk free > total fails validation.
- [ ] negative network/uptime values fail validation.
- [ ] future clock skew beyond policy fails validation.
- [ ] buffered sample older than accepted backfill window fails validation.
- [ ] request body/sample count limits fail closed.
- [ ] duplicate `(installation, sampleId)` replay is idempotent and creates no duplicate row.
- [ ] server, not agent, owns `received_at`.
- [ ] late replay cannot make a Device `online` historically/currently.
- [ ] hardware snapshot persists only when normalized inventory changes.
- [ ] retention cleanup removes expired raw samples without deleting enrollment/revocation evidence.
- [ ] telemetry ingestion changes no canonical Device/Asset versions.

## D. Connectivity-state gates

Using configured defaults:

- [ ] heartbeat <=150 seconds old => `online`.
- [ ] >150 and <=600 seconds => `stale`.
- [ ] >600 seconds => `offline`.
- [ ] no active installation => `not_enrolled`/`revoked` as applicable.
- [ ] changing the client clock cannot forge online status.
- [ ] Device Laboratory transfer changes monitoring Lab grouping through canonical Device state without re-enrollment.

## E. Go Windows-agent automated gates

- [ ] service installs/starts without interactive user session.
- [ ] credential storage abstraction uses DPAPI LocalMachine in production implementation.
- [ ] unencrypted credential is never written to config/log/queue.
- [ ] heartbeat schedule honors server policy.
- [ ] metric schedule honors server policy.
- [ ] local queue remains bounded to policy.
- [ ] queue overflow drops oldest samples deterministically and records dropped count.
- [ ] network retry uses bounded exponential backoff + jitter.
- [ ] restart preserves valid encrypted credential and pending queue safely.
- [ ] revoked credential response stops normal telemetry retries and surfaces operator-visible state.
- [ ] collectors return unavailable/null safely when a metric cannot be read; they never fabricate a value.

## F. Real Windows operational UAT — mandatory

Use at least one representative Windows 10/11 laboratory PC and, if supported, one Windows server/laptop profile.

### Enrollment

- [ ] authorized operator creates enrollment for exact Device.
- [ ] one-time code redeems successfully.
- [ ] canonical Device code/Laboratory shown in LARAS matches the machine chosen by operator.
- [ ] credential file is not plaintext-readable in the service directory.

### Normal operation

- [ ] service survives reboot and resumes automatically.
- [ ] heartbeat arrives near configured cadence.
- [ ] CPU/RAM/disk/network/uptime values are plausible when compared with Windows Task Manager/System Information.
- [ ] OS/hardware inventory is plausible but does not rewrite canonical Device profile.
- [ ] Monitoring page shows the exact Device and current Global Laboratory Context correctly.

### Network loss / buffering

- [ ] disconnect network for >=15 minutes.
- [ ] UI progresses from online -> stale -> offline based on server receive time.
- [ ] local metrics continue buffering within bound.
- [ ] reconnect restores current online state from a new heartbeat.
- [ ] buffered historical metrics replay exactly once.
- [ ] old replayed samples do not backdate online state.

### Revocation / replacement

- [ ] revoke active installation from authorized LARAS UI/API.
- [ ] next machine request is denied.
- [ ] UI no longer treats revoked installation as online.
- [ ] re-enrollment creates a new credential and the old credential remains unusable.

### Privacy inspection

- [ ] inspect local queue/config and captured API payloads.
- [ ] no username, typed text, clipboard, screenshot, browser URL/history, file/document content, process list, installed-app list, packet payload, or microphone/webcam data is present.
- [ ] application/server logs contain no enrollment code or credential secret.

## G. Browser / monitoring UAT

- [ ] `/monitoring` no longer displays placeholder/mock realtime values.
- [ ] Device without agent clearly shows `not_enrolled`/unavailable metrics.
- [ ] Device with current heartbeat shows real latest metrics + `online`.
- [ ] stale/offline states use explicit last-seen evidence.
- [ ] Global Laboratory Context filters by canonical Device Laboratory.
- [ ] search/type/lifecycle filters remain canonical Device filters.
- [ ] detail view shows bounded history only to `telemetry.view` users.
- [ ] enrollment/revoke actions appear only to `devices.manage-agent` users.
- [ ] direct protected routes/endpoints still enforce server RBAC when UI controls are bypassed.

## H. Load / retention UAT

Before production rollout, simulate at least the intended school scale and preferably 500 installations at normal cadence:

- 60-second heartbeat;
- 5-minute metrics;
- bounded batches;
- periodic offline replay.

Record, do not assume:

- accepted requests/sec;
- p50/p95 ingestion latency;
- DB growth/day;
- latest-read latency;
- history-query latency;
- API CPU/RAM;
- PostgreSQL CPU/RAM/storage/index growth;
- cleanup duration.

Do not set a fake performance PASS threshold before the actual deployment target and operational SLO are agreed. The purpose of the first load run is to establish evidence and identify whether ordinary PostgreSQL remains sufficient.

## I. Agent resource budget evidence

On representative hardware record:

- idle CPU average;
- sampling CPU spike;
- resident memory;
- local queue disk growth for 24h offline;
- network bytes/day at normal cadence.

Initial design target (not a claimed benchmark): the agent should remain operationally negligible during normal lab use. Exact acceptance thresholds must be set from measured representative PCs before production rollout.

## J. Security negative tests

- [ ] guessed installation ID without secret fails.
- [ ] valid secret paired with wrong credential ID fails.
- [ ] credential copied after server revocation fails.
- [ ] malformed/oversized batch fails before expensive processing.
- [ ] forged Device/School fields cannot redirect telemetry.
- [ ] sample replay produces no duplicate history.
- [ ] rate limit is enforced without affecting other School credentials globally.
- [ ] revoked/terminal Device state fails closed.
- [ ] logs/error responses reveal no credential hash/secret.

## K. Final S6 closure evidence

S6 may close only when:

1. S5.6 is merged and its production-domain/runtime/physical QR gates are complete;
2. ADR-004 and exact telemetry/OpenAPI contract are accepted;
3. persistence/machine-auth/ingestion/UI/agent tests pass on final exact head;
4. real Windows offline/reconnect/revoke/privacy UAT is recorded;
5. target-scale load evidence is recorded;
6. production security/deployment configuration is verified;
7. exact-head GitHub CI and deployment are green;
8. unresolved review threads are zero;
9. no prohibited collector or remote-control path was introduced.

Signed automatic update remains a separate explicit decision unless promoted into S6 scope before implementation lock.
