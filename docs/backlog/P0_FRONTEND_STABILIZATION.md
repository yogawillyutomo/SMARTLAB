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
- Fixed Asset masih transitional; penyatuan identity Device ↔ Asset pada workflow aset belum selesai.
- Pelaksanaan Lab yang menautkan kondisi perangkat/aset tetap mengikuti Phase S3/S4.

## P0-05 Integritas inventaris — Dalam perencanaan

- Tolak penggunaan spare part melebihi stok tersedia.
- Gunakan perilaku domain transaksional saat Inventory API Laravel tersedia.
- Browser-local stock tidak boleh dijadikan final business invariant.

## P0-06 Penomoran dokumen — Sebagian selesai

- Domain server yang sudah matang memisahkan internal stable ID dari human-readable identifier bila relevan.
- Penomoran untuk domain yang masih local/transitional belum dianggap selesai secara global.

## P0-07 Deep link — Sebagian selesai

- Detail canonical seperti Laboratory, Device, dan Incident sudah memakai route identity yang dapat direfresh/deep-link.
- Sesi, jurnal, work order, notifikasi, dan global search belum dianggap selesai sampai domain terkait canonical.

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
| IMP-03 Integrasi published timetable | backend selesai, frontend pending | Full snapshot TESSELA, stable refs, version/hash/idempotency, occurrence materialization, activation/audit. | S2.2 backend delivered; S2.3 read API + `/schedules` cutover berikutnya. Excel/file bila diperlukan hanya adapter, bukan authority. |
| AV-01 Unified availability | belum | Published occurrences, reservasi, prioritas, closure, exception. | Sesudah S2.2–S2.4 canonical schedule/closure foundation. |
| OV-01 Override kegiatan prioritas | belum | Exception bertanggal non-destruktif. | Sesudah AV-01 dan kebijakan approver. |
| EX-01 Pelaksanaan Lab/laporan terpadu | belum | Satu UX, dua entitas terkait, laporan wajib. | Phase S3 sesudah occurrence/availability. |

Urutan produk berikutnya tidak lagi mengikuti urutan baseline frontend lama secara literal. Ownership dan kontrak S2.1 sudah terkunci, S2.2 backend sudah delivered; pekerjaan berikutnya adalah S2.3 occurrence read API + frontend `/schedules` cutover, bukan solver dan bukan CRUD jadwal browser-local baru.
