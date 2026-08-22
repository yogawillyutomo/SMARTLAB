# Device Domain Field Classification

Status: Proposed companion to [Device Domain Contract RFC](device-domain-contract.md)

Classification source: current frontend `Device`, technical profiles, monitoring behavior, Asset linkage, Layout references, and AppDB migration rules.

## Classification legend

| Code | Meaning |
| --- | --- |
| A | Backend canonical |
| B | Backend canonical but renamed/reframed |
| C | Future domain |
| D | Telemetry/runtime data |
| E | Frontend presentation/prototype field |
| F | Deprecated / should not survive |

Required and mutable values below describe the recommended backend destination, not the current TypeScript optionality. “Profile” means the validated type-specific `devices.technical_profile` JSONB object; its discriminator and version are root columns, not JSON properties. “Future” means no Device v1 field is created.

## Root Device fields

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `id` | Local AppDB Device identity | New server-generated internal Device ULID | A | Yes | No | Global PK | `devices.id` | Never reuse/import AppDB IDs; authenticated detail URL only, never QR payload |
| `deviceType` | Hardware type | Closed canonical hardware taxonomy and sole profile discriminator | A | Yes | No in PATCH v1 | None | `devices.device_type` | Immutable after create; future correction/migration is a separate administrative concern |
| `lifecycleStatus` | Service-life state | Canonical Device lifecycle | A | Yes | Generic PATCH only `in_service <-> spare` | None | `devices.lifecycle_status` | Create accepts active/spare; retire/decommission require future actions |
| `qrPublicId` | Opaque QR identity | Server-generated public Device identifier | A | Yes | No | Global unique | `devices.qr_public_id` | `devq_` + >=128 random bits; stable, never recycled, never accepted from client, and not authorization |
| `assetId` | Optional local Device-to-Asset link | Future canonical relation after Asset backend exists | C | No | Controlled link-only | At most one Asset per Device and vice versa | Future FK/link contract | Omit from Device API v1; never import AppDB Asset IDs |
| `positionCode` | Display label such as `PC-01` and implicit position identity | Future Layout slot/element label, not Device identity | C | No | Layout-controlled | Layout-defined | Future Layout/placement | Must not survive on `devices`; current values are migration hints only |
| `hostname` | Managed computer hostname | Optional declared hostname | A | No | Yes, audited | Not hard-unique | `devices.hostname` | Not universally applicable; agent-observed hostname later retains source/time separately |
| `laboratoryId` | Local Laboratory assignment and location | Nullable home/custodial Laboratory | B | No | Null-to-Lab initial assignment only in generic PATCH | None | `devices.home_laboratory_id` | Same-School canonical reference; established reassignment/removal requires future Transfer; never current location |
| `assetCode` | Duplicated Asset code used as Device display/link key | No Device field; separate required `deviceCode` is introduced | F | N/A | N/A | N/A | Not persisted on Device | Do not auto-promote or equate Device code and Asset code |
| `ipAddress` | Current IP shown in Monitoring | Runtime/network configuration observation | D | No | Telemetry/network-owned | None | Outside Device v1; future network observation | Dynamic and interface-specific; no nullable primary-IP Device column |
| `macAddress` | One current MAC string | Future interface identity/observation, not Device identity | C | No | Network/agent-controlled | No universal hard uniqueness | Outside Device v1; future network-interface model | A Device may have many, virtual, replaced, or randomized MACs; no primary-MAC Device column |
| `serialNumber` | Manufacturer serial | Optional declared manufacturer serial | A | No | Yes, audited | Duplicate warning within School; not hard unique | `devices.serial_number` | Blank becomes null; searchable but not QR/public URL identity |
| `brand` | Device manufacturer, duplicated on Asset | Optional declared manufacturer | A | No | Yes, audited | None | `devices.brand` | Asset may later own procurement model references; avoid silent cross-domain sync |
| `model` | Device model, duplicated on Asset | Optional declared model | A | No | Yes, audited | None | `devices.model` | May later reference canonical model catalog without changing Device identity |
| `yearAcquired` | Acquisition year duplicated on Asset | Procurement/acquisition fact | C | No | Asset-controlled | None | Future Asset domain | Exclude from Device v1; do not preserve duplicate ownership |
| `technicalProfile` | Discriminated hardware-specific specifications | Closed type-specific JSON object without duplicated discriminator/version | A | Yes; `{}` minimum | Atomic whole-object replace, audited | None | `devices.technical_profile` JSONB | Validated by root device type/version; no recursive/deep merge |
| `status` | Mixed Online/Offline/Warning/Critical/Maintenance/Reserved | No single canonical Device field | F | N/A | N/A | N/A | Split across telemetry, availability, Loan, and Maintenance | Must not become one backend enum |
| `cpuUsage` | Simulated/live CPU percent | Timestamped metric | D | No | Agent/telemetry-owned | Time-series key | Future device metrics | Never default/fabricate; not in Device DTO core |
| `ramUsage` | Simulated/live RAM percent | Timestamped metric | D | No | Agent/telemetry-owned | Time-series key | Future device metrics | Distinguish percentage from installed RAM specification |
| `diskUsage` | Simulated/live disk percent | Timestamped metric | D | No | Agent/telemetry-owned | Time-series key | Future device metrics | Not the same as nominal `storageGB` |
| `temperature` | Simulated/live temperature | Timestamped metric with sensor/source | D | No | Agent/telemetry-owned | Time-series key | Future device metrics | Units and sensor identity must be explicit later |
| `uptimeHours` | Simulated/live uptime | Timestamped observation, preferably seconds | D | No | Agent/telemetry-owned | Time-series key | Future heartbeat/metrics | Reframe unit in telemetry contract; no Device column |
| `network` | Connected/Disconnected/Limited presentation state | Derived network-health observation | D | No | Telemetry-owned | None | Future latest-health projection | Current English enum is presentation-only, not Device persistence |
| `lastHeartbeat` | Last simulated/agent contact time | Latest heartbeat projection from immutable observations | D | No | Telemetry-owned | One latest per agent projection | Future agent/heartbeat subsystem | Device may have zero/one/multiple agent installations over time |

## New canonical fields not present on the frontend Device

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `schoolId` / `school_id` | Implicit in local single-AppDB data | Exact tenant owner derived from active membership | A | Yes | No | None | `devices.school_id` | Prohibited in mutation payloads; same-School invariant for all relations |
| `deviceCode` | No independent Device code; frontend reuses Asset code | Stable human-readable Device identity supplied under strict normalization | A | Yes | No in ordinary PATCH v1 | Case-insensitive School-scoped unique | `devices.device_code` | Client supplies create value; server trim/uppercase + 3-32 pattern; location-neutral; future audited correction may change it without changing ULID |
| `technicalProfileVersion` | Absent | Server-selected validation schema for technical profile | A | Yes | Server migration only | None | `devices.technical_profile_version` | Integer >=1, returned in DTO, prohibited in create/PATCH |
| `version` | No optimistic concurrency token | Integer optimistic-lock version | A | Yes | Server increments | None | `devices.version` | Returned in DTO; PATCH requires strong `If-Match` and atomically increments |
| `createdAt` | Absent | Server creation timestamp | A | Yes | No | None | `devices.created_at` | Read-only API field |
| `updatedAt` | Absent | Last durable Device mutation timestamp | A | Yes | Server-only | None | `devices.updated_at` | Read-only; not the concurrency token itself |

## Combined status value decomposition

| Current value | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `Online` | Heartbeat/healthy display | Derived latest telemetry health | D | No | Derived | N/A | Future health projection | Unknown without evidence; never default Online |
| `Offline` | No heartbeat/manual status | Derived from heartbeat threshold or explicit observation | D | No | Derived | N/A | Future health projection | Threshold belongs to telemetry policy |
| `Warning` | One or more warning indicators | Derived alert/health severity | D | No | Derived | N/A | Future alert/health projection | Must include evidence/source |
| `Critical` | Severe operational problem | Derived alert/incident/health severity | D | No | Derived | N/A | Future alert/health projection | Not equivalent to Asset physical condition |
| `Maintenance` | Maintenance mode/work in progress | Active Maintenance/repair workflow or custody | C | No | Workflow-controlled | N/A | Future Maintenance projection | Must not rewrite lifecycle or home Laboratory |
| `Reserved` | Temporarily allocated | Availability/reservation/Loan projection | C | No | Workflow-controlled | N/A | Future availability/Loan domain | Not a Device lifecycle value |

## Technical profile discriminator migration

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `technicalProfile.kind` | Local discriminator mirroring Device type | Migrates to/validates root canonical `deviceType`; not retained inside JSONB | B | No profile property | No | None | Migration validation plus `devices.device_type` | Type/profile mismatch blocks migration; backend profile contains no `kind` |

## Computer profile fields

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `processor` | CPU description | Declared processor specification | A | No | Yes | None | Profile JSONB | Applicable to desktop/laptop/server only |
| `ramGB` | Installed memory capacity | Declared installed RAM in GB | A | No | Yes | None | Profile JSONB | Non-negative finite number; distinct from `ramUsage` |
| `storageGB` | Nominal storage capacity | Declared aggregate capacity in GB | A | No | Yes | None | Profile JSONB | Later storage-component detail may supersede aggregate |
| `gpu` | GPU description | Declared GPU specification | A | No | Yes | None | Profile JSONB | Desktop/laptop only in audited v1 catalog |
| `monitor` | Free-text monitor bundled with desktop | Candidate separate Device/Asset/accessory relation | E | No | No canonical Device-profile owner | None | Migration note/future Asset | Do not blindly store bundled equipment ownership as text |
| `os` | Declared OS string | Declared/expected OS configuration | B | No | Yes | None | Profile JSONB | Agent-detected OS is separate observed inventory with time/source |
| `display` | Laptop display description | Declared integrated display specification | A | No | Yes | None | Profile JSONB | Not a separate monitor Asset unless physically separate |
| `batteryHealthPercent` | Current laptop battery health | Inspection/telemetry observation | D | No | Observation-owned | None | Future metrics/inspection | Do not persist as timeless technical specification |
| `cpuSockets` | Server socket count | Declared server hardware specification | A | No | Yes | None | Profile JSONB | Non-negative integer |
| `cpuCores` | Server core count | Declared server hardware specification | A | No | Yes | None | Profile JSONB | Non-negative integer |
| `raidLevel` | Server RAID description | Declared storage configuration | A | No | Yes | None | Profile JSONB | Observed controller state remains telemetry/inventory |

## Desktop peripheral fields

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `peripherals.monitor` | Boolean equipment presence | Future Device/Asset/accessory or inspection relation | C | No | Workflow/inspection-owned | None | Future Asset/inspection | A boolean cannot identify which monitor |
| `peripherals.keyboard` | Boolean equipment presence | Future accessory/custody/inspection relation | C | No | Workflow/inspection-owned | None | Future Asset/inspection | Do not copy required six-boolean shape into Device v1 |
| `peripherals.mouse` | Boolean equipment presence | Future accessory/custody/inspection relation | C | No | Workflow/inspection-owned | None | Future Asset/inspection | Same boundary as keyboard |
| `peripherals.headset` | Boolean equipment presence | Future accessory/custody/inspection relation | C | No | Workflow/inspection-owned | None | Future Asset/inspection | May be quantity stock rather than serialized Device |
| `peripherals.network` | Boolean network availability | Derived network observation/capability | D | No | Derived | None | Future telemetry/profile-specific capability | Current meaning is ambiguous; do not migrate automatically |
| `peripherals.ups` | Boolean UPS presence | Future Device/Layout/Asset relation | C | No | Workflow/Layout-owned | None | Future relation | UPS is already a Device type and needs identity if managed |

## Network equipment profile fields

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `portCount` | Switch physical port count | Declared specification | A | No | Yes | None | Profile JSONB | Non-negative integer |
| `managed` | Managed-switch capability | Declared capability | A | No | Yes | None | Profile JSONB | Boolean, switch only |
| `poe` | PoE capability | Declared capability | A | No | Yes | None | Profile JSONB | Switch/AP context only |
| `poeBudgetWatts` | Switch PoE budget | Declared capacity | A | No | Yes | None | Profile JSONB | Non-negative finite number |
| `switchingCapacityGbps` | Switch fabric capacity | Declared capacity | A | No | Yes | None | Profile JSONB | Units fixed in contract |
| `uplinkSpeedGbps` | Switch uplink speed | Declared capacity | A | No | Yes | None | Profile JSONB | Aggregate/single-port semantics must be documented |
| `firmwareVersion` | Current firmware string | Declared/configured firmware | B | No | Yes | None | Profile JSONB | Agent-observed version later retains time/source separately |
| `wanPortCount` | Router WAN port count | Declared specification | A | No | Yes | None | Profile JSONB | Non-negative integer |
| `lanPortCount` | Router LAN port count | Declared specification | A | No | Yes | None | Profile JSONB | Non-negative integer |
| `throughputMbps` | Router nominal throughput | Declared capacity | A | No | Yes | None | Profile JSONB | Not live throughput telemetry |
| `wifiCapable` | Router Wi-Fi capability | Declared capability | A | No | Yes | None | Profile JSONB | Boolean |
| `wifiStandard` | AP Wi-Fi standard | Declared capability | A | No | Yes | None | Profile JSONB | Prefer documented normalized values later |
| `bands` | AP frequency bands | Declared closed list | A | No | Yes | None | Profile JSONB | Current `2.4GHz`, `5GHz`, `6GHz` catalog is acceptable |
| `maxClients` | AP nominal client capacity | Declared capacity | A | No | Yes | None | Profile JSONB | Not current connected-client telemetry |

## Printer, projector, UPS, and other profile fields

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `printer.technology` | Inkjet/laser/dot-matrix/thermal/other | Closed declared printer technology | A | No | Yes | None | Profile JSONB | Preserve existing enum |
| `printer.color` | Color-print capability | Declared capability | A | No | Yes | None | Profile JSONB | Boolean |
| `printer.duplex` | Duplex capability | Declared capability | A | No | Yes | None | Profile JSONB | Boolean |
| `printer.networkCapable` | Network capability | Declared capability | A | No | Yes | None | Profile JSONB | Actual connection state remains telemetry |
| `printer.paperSize` | Supported/default paper size free text | Declared specification | A | No | Yes | None | Profile JSONB | Normalize only after real reporting need |
| `projector.technology` | Projector technology | Declared specification | A | No | Yes | None | Profile JSONB | Optional string in v1 |
| `brightnessLumens` | Nominal brightness | Declared capacity | A | No | Yes | None | Profile JSONB | Non-negative finite number |
| `nativeResolution` | Projector native resolution | Declared specification | A | No | Yes | None | Profile JSONB | Optional normalized string later |
| `lampHours` | Current accumulated lamp use | Maintenance/telemetry observation | D | No | Observation-owned | None | Future metrics/maintenance inspection | Do not persist as timeless profile value |
| `capacityVA` | UPS apparent power capacity | Declared capacity | A | No | Yes | None | Profile JSONB | Non-negative finite number |
| `powerWatts` | UPS real-power capacity | Declared capacity | A | No | Yes | None | Profile JSONB | Non-negative finite number |
| `batteryCount` | UPS battery count | Declared configuration | A | No | Yes | None | Profile JSONB | Battery replacements need maintenance history later |
| `batteryVoltage` | UPS battery voltage | Declared specification | A | No | Yes | None | Profile JSONB | Units fixed in contract |
| `runtimeMinutes` | Nominal UPS runtime | Declared nominal capacity | A | No | Yes | None | Profile JSONB | Measured runtime is telemetry/test result |
| `other.specifications` | Nested arbitrary scalar key/value map | Flat controlled escape-hatch profile properties | B | No | Atomic whole-profile replace | None | Top-level Profile JSONB properties | Migration lifts each local entry to the profile root; max 32 bounded keys, primitive values only, no nested object |

## Related local fields that must not become Device columns

| Field | Current meaning | Recommended backend meaning | Class | Required? | Mutable? | Unique scope | Persistence location | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `LayoutElement.referenceId` | Local binding to AppDB Device ID | Future binding to canonical backend Device ULID | C | Placement only | Layout-controlled | One active home placement per Device | Future Layout domain | Requires explicit ID remap; no Device coordinates |
| `LayoutElement.row/column/span/rotation` | Physical geometry | Layout-owned geometry | C | Layout-defined | Layout-controlled | Cell/placement invariants | Future Layout domain | Never persist on Device |
| `Asset.id` / `Device.assetId` | Local optional one-to-one relation | Canonical FK only after Asset backend exists | C | No | Controlled link-only | One-to-one | Future Asset/Device relationship | Local IDs are untrusted |
| `Asset.assetCode` | Administrative inventory code | Asset identity, separate from Device code | C | Asset-defined | Asset policy | School-scoped recommendation | Future Asset domain | Matching text is not proof of identity |
| `Loan.itemName` | Free-text borrowed item | Future Loan request line description or catalog reference | E | No | Loan-owned | None | Loan domain | Not sufficient for Device custody |
| `Loan.quantity` | Aggregate borrowed quantity | Future requested quantity before Device selection | C | Request-dependent | Loan-owned | None | Loan request line | Checkout requires per-Device Loan items |
| `Incident.assetCode` | Free-text Asset association | Future canonical `deviceId` plus optional `assetId` and snapshots | B | Context-dependent | Incident-owned | None | Future Incident domain | Preserve historical display snapshots separately |
| `WorkOrder.assetCode` | Free-text work target | Future canonical Device/Asset reference | B | Context-dependent | Work Order-owned | None | Future Work Order domain | Work Order identity/history must not depend on mutable text |
| `MaintenanceExecution.assetCode` | Free-text maintained item | Future canonical Device/Asset reference | B | Context-dependent | Maintenance-owned | None | Future Maintenance domain | Repair custody does not change home Laboratory |

## Migration disposition summary

- Import candidates: validated type, permitted lifecycle, declared hostname/serial/brand/model, and normalized type-specific profile fields; local `technicalProfile.kind` validates/maps to root `deviceType`.
- New canonical values required: backend ULID, School ownership, reviewed client-supplied location-neutral Device code, server-generated QR, server-controlled technical-profile version, optimistic version, and timestamps.
- Mapping required: local Laboratory ID to canonical Laboratory and local Device ID to backend Device ULID.
- Never import into Device core: local QR as canonical identity, combined status, metrics, heartbeat, IP/MAC, current network state, coordinates, position code, local Asset ID, or free-text transaction links.
- Block or review: duplicate/ambiguous local QR-to-label evidence, ambiguous Asset candidates, type/profile mismatch, duplicate normalized Device code, cross-Laboratory mapping ambiguity, and peripheral fields that actually represent separate equipment.
