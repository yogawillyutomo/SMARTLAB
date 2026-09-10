# S1–S5 UAT Fixture Seeder

## Purpose

`UatS1S5FixtureSeeder` menyediakan baseline canonical yang repeatable untuk exploratory/manual UAT SMARTLAB S1–S5.

Seeder ini **bukan pengganti lifecycle UAT**. Ia sengaja tidak membuat active Loan, Preventive Maintenance, atau Work Order custody dan tidak membuat Maintenance Campaign. Lifecycle kritis tetap dijalankan manual agar boundary authority benar-benar dibuktikan.

## Safety contract

Seeder hanya boleh berjalan pada environment `local` atau `testing`.

Target School tidak ditebak. Seeder memerlukan tepat satu active SchoolMembership untuk:

`uat.admin@smartlab.local`

yang **sudah** memiliki role `super-admin`. Seeder tidak membuat atau menaikkan UAT admin menjadi super-admin.

Seeder menolak berjalan bila School target sedang memiliki active custody pada:

- LoanItem;
- MaintenanceExecution;
- WorkOrder.

Gunakan disposable/fresh UAT database atau selesaikan lifecycle yang sedang aktif sebelum menjalankan seeder.

Password fixture tidak pernah hard-coded. Set:

`SMARTLAB_UAT_FIXTURE_PASSWORD`

dengan minimal 12 karakter.

Seeder tidak dipanggil oleh `DatabaseSeeder` sehingga tidak akan ikut production/default seed.

## Fixture accounts

| Email | Role | Intended UAT use |
| --- | --- | --- |
| `uat.labadmin@smartlab.local` | `admin-lab` | operational admin, checkout/return, inventory, maintenance |
| `uat.kalab@smartlab.local` | `kepala-lab` | approval/inspection/oversight |
| `uat.technician@smartlab.local` | `teknisi` | technical maintenance/work-order execution |
| `uat.teacher@smartlab.local` | `guru` | requester/teacher flows |
| `uat.student@smartlab.local` | `siswa` | low-privilege/negative-permission checks |

Role permissions remain authoritative from `RolePermissionSeeder`. Seeder tidak menambah permission ad-hoc ke akun.

Current baseline intentionally keeps `siswa` without `loans.create`; teacher is the positive Loan-requester fixture until student Loan policy is explicitly changed.

## Canonical operational fixtures

Laboratories:

- `UAT-RPL1` — Lab RPL 1 UAT;
- `UAT-RPL2` — Lab RPL 2 UAT.

Devices:

- `UAT-PC-001` — RPL1, Desktop PC, RAM 8 GB;
- `UAT-PC-002` — RPL1, Desktop PC, RAM 16 GB;
- `UAT-PC-101` — RPL2, Desktop PC, RAM 16 GB.

Assets:

- `UAT-AST-PC001` → exact 1:1 `UAT-PC-001`;
- `UAT-AST-PC002` → exact 1:1 `UAT-PC-002`;
- `UAT-AST-PC101` → exact 1:1 `UAT-PC-101`;
- `UAT-AST-MEJA01` — Asset-only fixture tanpa Device link.

Inventory:

- `UAT-RAM-16GB` — `pcs`, opening balance 6;
- `UAT-CABLE-LAN` — `meter`, opening balance 50.5.

Opening transaction hanya dibuat bila item belum memiliki ledger. Rerun tidak mengembalikan saldo ke angka baseline dan tidak menghapus/mengubah immutable InventoryTransaction history.

## Academic reference fixtures

- Tahun Ajaran `2026-2027`;
- Semester `GANJIL`;
- Academic Unit `PPLG`;
- Teacher `UAT-GURU` yang ditautkan ke membership `uat.teacher@smartlab.local`;
- Class `XI-PPLG-1`;
- Subject `PWEB` — Pemrograman Web dan Mobile;
- Lesson Period Set `REGULER` dengan JP1–JP10 dan dua break.

Seeder tidak membuat TESSELA timetable publication, reservation approval, LaboratorySession lifecycle, atau ActivityReport verification. Hal-hal tersebut tetap menjadi manual/API UAT evidence.

## Run

Pastikan base RBAC dan UAT admin sudah tersedia.

PowerShell example:

```powershell
cd D:\KODE\SmartLab\SMARTLAB\apps\api

$env:SMARTLAB_UAT_FIXTURE_PASSWORD = "your-local-uat-password"

php artisan db:seed --class=UatS1S5FixtureSeeder
```

Jangan commit password dan jangan masukkan password ke dokumentasi/log evidence.

## Idempotency

Rerun:

- tidak membuat duplikat account/Lab/Device/Asset/Inventory/master reference;
- tidak menambah opening transaction bila ledger sudah ada;
- tidak mereset version academic reference yang sudah berubah;
- tidak memindahkan Device home Laboratory;
- tidak menimpa linked Asset/Device identity yang bertentangan;
- berhenti fail-closed pada collision yang tidak aman.

## What manual UAT must still prove

- authentication and role boundaries;
- Loan submit → approve → checkout → return → close;
- Loan vs Maintenance custody exclusion;
- Preventive Maintenance checklist progress and Inventory consumption;
- Maintenance Campaign create/batch schedule and proof that Campaign owns no custody;
- Work Order assign/start/hold/wait/resume/parts/complete/verify;
- Asset condition authority;
- Device specification update after a real upgrade;
- storage-cleared persistence and deep links;
- cross-School/cross-Lab fail-closed scenarios where browser evidence is required.

Seeder presence must never be cited as proof that any of those lifecycle flows passed.
