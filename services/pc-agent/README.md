# SmartLab PC Agent

Reserved for a Go-based Windows service that reports approved device-health telemetry.

Initial responsibilities:
- device registration and revocable credentials;
- heartbeat;
- CPU, RAM, disk, network, uptime;
- OS and hardware inventory;
- bounded offline queue and retry;
- signed update mechanism in a later phase.

Explicitly prohibited:
- keylogging;
- screenshots;
- browser-history collection;
- reading personal documents;
- covert surveillance.
