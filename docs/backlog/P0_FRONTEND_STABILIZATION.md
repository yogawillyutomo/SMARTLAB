# Stabilisasi Frontend P0

Backlog ini mencatat stabilisasi frontend dan transisi menuju sumber data Laravel. Arah produk dan dependensi terperinci berada pada [Spesifikasi Workflow Operasional SmartLab](../product/SMARTLAB_OPERATIONAL_WORKFLOW_SPEC.md).

**Keterangan status:**

- **Selesai**: acceptance utama sudah tersedia pada implementasi saat ini.
- **Sebagian selesai**: sebagian acceptance sudah canonical, tetapi masih ada domain/route yang transitional.
- **Dalam perencanaan**: belum menjadi implementasi canonical.

## P0-01 Hidrasi autentikasi — Selesai

- Hidrasi autentikasi sebelum route guard mengarahkan pengguna.
- Status hidrasi/loading eksplisit.
- First-party authentication sekarang terintegrasi dengan Laravel/Sanctum.

## P0-02 Permission dinamis — Sebagian selesai

- Route yang sudah dimigrasikan memakai permission server sebagai authority.
- Users, Roles, Master Data, Laboratory, Device, Layout, dan Incident sudah mengikuti boundary server yang relevan.
- Compatibility permission state masih boleh hidup hanya pada route/domain yang belum dimigrasikan.
- Tenant-specific permission override editor masih ditunda sampai kontraknya dikunci.

## P0-03 CRUD nyata — Selesai

- Master Data tidak lagi bergantung pada CRUD browser-local; halaman memakai Academic Master API.
- Administrasi pengguna memakai Identity Administration API.
- Tombol utama pada domain canonical harus mengubah server state atau menyatakan keterbatasan secara eksplisit.

## P0-04 Integritas Device–Asset–Incident — Sebagian selesai

- Device dan Incident sudah memiliki stable server identity dan canonical API.
- Device transfer dan Incident workflow sudah server-backed.
- Fixed Asset sudah menjadi canonical melalui S4.2 dengan exact optional 1:1 Asset↔Device linkage, ETag concurrency, lifecycle terpisah, audit history, dan `/assets` server-authoritative.
- Pelaksanaan Lab tetap merekam observasi Device canonical dan explicit Observation→Incident linkage. Evidence Asset dari S3.5 tidak diretrofit otomatis; historical free-text evidence tidak difabrikasi menjadi canonical Asset reference.

## P0-05 Integritas inventaris — S4.3 implementation tranche

- S4.3 menyediakan `InventoryItem` canonical dan immutable `InventoryTransaction` dengan quantity precision tiga digit desimal.
- Movement mengunci row item, menghitung saldo di dalam transaksi, dan menolak hasil negatif di application layer serta PostgreSQL.
- Stable School-scoped `clientMutationId` mereplay retry identik dan menolak ID yang dipakai kembali untuk payload berbeda.
- Opening balance harus berupa transaksi `opening`; metadata create/PATCH tidak dapat menulis balance.
- `/stock` pada PR #80 sudah server-authoritative dan tidak menggunakan `db.stock` / browser mutation / hard delete.
- Cross-domain consumption oleh Preventive Maintenance dan Work Order belum menjadi authority S4.3; masing-masing tetap menunggu S4.5 dan S5.

## P0-06 Penomoran dokumen — Sebagian selesai

- Domain server yang sudah matang memisahkan internal stable ID dari human-readable identifier bila relevan.
- Penomoran untuk domain yang masih local/transitional belum dianggap selesai secara global.

## P0-07 Deep link — Sebagian selesai

- Detail canonical seperti Laboratory, Device, Incident, dan Pelaksanaan Lab sudah memakai route/server identity yang dapat direfresh/deep-link.
- `/sessions` sudah canonical dan `/journals` hanya compatibility/deep-link redirect. Work order, notifikasi, dan global search belum dianggap selesai sampai domain terkait canonical.

## P0-08 Filter dan pengaturan fungsional — Sebagian selesai

- Dukungan theme sudah berkembang melewati baseline awal.
- Filter/report/settings yang masih bergantung pada domain transitional belum dianggap final.
- Chart/reporting final mengikuti Phase S7 agar membaca sumber canonical.

## P0-09 Arsitektur formulir — Sebagian selesai

- React Hook Form dan Zod tersedia untuk formulir non-trivial.
- Validasi final tetap harus berada di server untuk setiap domain canonical.
- Form pada domain yang belum dimigrasikan akan dirapikan bersama vertical slice masing-masing.

## P0-10 Pembersihan baseline — Selesai

- Dependency Supabase yang tidak digunakan sudah dihapus.
- Branding dan dokumentasi utama menggunakan SmartLab.
- Local repository checks sekarang mencakup lint, typecheck, test, dan build seperti `web-ci`.
- API tetap divalidasi melalui Laravel test suite; CI menambah validasi PostgreSQL migration/seeder dan Composer metadata.

## Follow-up terfokus

| Item | Status | Cakupan | Dependensi/urutan |
| --- | --- | --- | --- |
| WF-01 Kejelasan terminologi/workflow | sebagian selesai | Migrasi label dan navigasi aman. | Pertahankan route, deep link, sesi, dan jurnal. |
| THEME-01 Complete theme support | selesai baseline | Light/Dark/System dan accent support. | Final chart/print awareness mengikuti reporting. |
| LAYOUT-01 Integritas koordinat denah | selesai | Posisi unik, collision, persistence integrity. | Device identity stabil. |
| LAYOUT-02 Editor denah multi-template | selesai | Template fisik, custom layout, properties, advanced geometry. | LAYOUT-01. |
| MD-01 Master akademik stable ID | selesai | Guru, kelas, mapel, JP, tahun, semester. | Menjadi entry dependency untuk schedule integration. |
| IMP-01 Fondasi import Excel | belum | Template, mapping, preview, validasi, audit. | Ownership sudah dikunci oleh ADR-001; implementasi tetap perlu contract import terfokus. |
| IMP-02 Import Master Data | belum | Referensi sederhana, akademik, laboratorium. | Sesudah IMP-01; academic authority mengikuti ADR-001 dan Laboratory tetap domain SmartLab. |
| IMP-03 Integrasi published timetable | selesai | Full snapshot TESSELA, stable refs, version/hash/idempotency, occurrence materialization, activation/audit, current-plan read API, canonical `/schedules`. | S2.2–S2.8 delivered, termasuk Calendar, Availability, Reservation, Schedule Exception, Priority Event, dan publication reconciliation. Excel/file bila diperlukan hanya adapter, bukan authority. |
| AV-01 Unified availability | canonical lengkap untuk S2 | Laboratory status + active ScheduleOccurrence + dated Schedule Exception + schedule coverage + Calendar + submitted/approved Reservation + approved Priority Event sudah unified. | S2.5–S2.8 delivered. |
| OV-01 Override kegiatan prioritas | canonical baseline | Schedule Exception cancel/relocate + Priority Event request/approval sudah canonical; tidak ada force override. | S2.7 + S2.8 delivered. |
| EX-01 Pelaksanaan Lab/laporan terpadu | implementation-complete melalui S3.6 | LaboratorySession + ActivityReport + `/sessions` server-authoritative; `/journals` compatibility redirect; S3.5 execution evidence; S3.6 controlled offline draft sync dengan account-scoped cache, idempotent receipts, dan fail-closed conflict/rebase. | Operator/browser offline UX matrix tetap menjadi production-rollout UAT; tidak menghalangi perencanaan S4. |

Urutan produk berikutnya tidak lagi mengikuti urutan baseline frontend lama secara literal. Ownership + kontrak S2.1 terkunci; seluruh S2.2–S2.8 delivered; S3.1–S3.6 implementation-complete dengan server authority tetap fail-closed. Operator/browser S3.6 UAT tetap wajib sebelum production rollout, dan S4.1 contract lock sudah accepted. S4.2 fixed Assets sudah merged sebagai PR #79 dan exact merged-head CI hijau. S4.3 Inventory adalah implementation tranche PR #80; setelah explicit merge + exact merged-head verification, fase berikutnya S4.4 Loan custody. Roadmap current dirangkum di [SMARTLAB Documentation](../README.md).
