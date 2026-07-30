# Stabilisasi Frontend P0

Backlog ini mencatat stabilisasi sebelum integrasi Laravel. Arah produk dan dependensi terperinci berada pada [Spesifikasi Workflow Operasional SmartLab](../product/SMARTLAB_OPERATIONAL_WORKFLOW_SPEC.md); file ini sengaja ringkas.

**Keterangan status:** **Selesai** berarti sudah masuk `main`; **Dalam perencanaan** berarti disetujui/direncanakan tetapi belum tersedia pada frontend saat ini.

## P0-01 Hidrasi autentikasi — Selesai

- Hidrasi autentikasi sebelum route guard mengarahkan pengguna.
- Status hidrasi/loading eksplisit.
- Remember me memilih `localStorage` atau `sessionStorage`.

## P0-02 Permission dinamis — Selesai

- Satu sumber permission persisten untuk menu, guard halaman, dan guard aksi.
- Role view-only tidak dapat mengubah monitoring, inventaris, incident, atau maintenance.

## P0-03 CRUD nyata — Selesai

- Aksi Master Data memakai repository dan persistensi, bukan toast saja.
- Tombol utama mengubah state atau menyatakan keterbatasan dengan jelas.

## P0-04 Integritas Device–Asset–Incident — Dalam perencanaan

- Posisi PC mengarah ke ID perangkat dan aset.
- Pemilihan PC rusak berbasis ikon, bukan teks bebas.
- Simpan `brokenPCsBefore` dan buat tiket pada ID aset valid.

## P0-05 Integritas inventaris — Dalam perencanaan

- Tolak penggunaan spare part melebihi stok tersedia.
- Gunakan perilaku domain transaksional saat API Laravel tersedia.

## P0-06 Penomoran dokumen — Dalam perencanaan

- Sequence persisten dan tahun/pengaturan dinamis.
- Pisahkan ID internal dari nomor tampilan.

## P0-07 Deep link — Dalam perencanaan

- Parameter route untuk detail sesi, jurnal, perangkat monitoring, incident, dan work order.
- Global search/notifikasi membuka rekaman yang tepat.

## P0-08 Filter dan pengaturan fungsional — Dalam perencanaan

- Tampilan jadwal hari/minggu/daftar benar-benar bekerja.
- Filter tanggal/lab memengaruhi seluruh dataset laporan yang relevan.
- Format dokumen, aksen, dan pengaturan benar-benar persisten.
- Startup tidak boleh memaksa Dark.
- Mode System mendengarkan perubahan tema OS tanpa reload.
- Chart harus sadar tema; tidak ada warna hard-coded Dark untuk tooltip, grid, axis, atau label.
- Tidak ada flash tema yang salah saat aplikasi dimulai.

## P0-09 Arsitektur formulir — Dalam perencanaan

- React Hook Form dan Zod untuk formulir kompleks.
- Validasi kode ganda, urutan tanggal, kuantitas, kehadiran, dan batas file.

## P0-10 Pembersihan baseline — Dalam perencanaan

- Hapus dependency Supabase yang tidak digunakan.
- Bahasa dokumen Indonesia dan branding SmartLab.
- Lint, typecheck, dan build lulus di CI.

## Follow-up terfokus (bukan otomatis P0)

| Item | Cakupan | Dependensi/urutan |
| --- | --- | --- |
| WF-01 Kejelasan terminologi/workflow | Migrasi label dan navigasi aman. | Pertahankan route, deep link, sesi, dan jurnal. |
| THEME-01 Complete theme support | Light/Dark/System lengkap. | `feat/complete-theme-support`; mendahului chart/print sadar tema. |
| LAYOUT-01 Integritas koordinat denah | Posisi unik, collision, atomic swap. | Model perangkat/aset stabil. |
| LAYOUT-02 Editor denah multi-template | Grid Klasik, Perimeter, U-Shape, Facing Rows, Custom. | Sesudah LAYOUT-01. |
| MD-01 Master akademik stable ID | Guru, kelas, mapel, JP, tahun, semester. | Sebelum import jadwal. |
| IMP-01 Fondasi import Excel | Template, mapping, preview, validasi, audit. | Sesudah MD-01 untuk referensi akademik. |
| IMP-02 Import Master Data | Referensi sederhana, akademik, laboratorium. | Sesudah IMP-01. |
| IMP-03 Import jadwal | Kode stabil, validasi konflik. | Sesudah MD-01 dan IMP-01. |
| AV-01 Unified availability | Jadwal, reservasi, prioritas, closure, exception. | Sejalan dengan IMP-03. |
| OV-01 Override kegiatan prioritas | Exception bertanggal non-destruktif. | Sesudah AV-01 dan kebijakan approver. |
| EX-01 Pelaksanaan Lab/laporan terpadu | Satu UX, dua entitas terkait, laporan wajib. | Sesudah occurrence dan availability. |

Urutan utama: WF-01 → THEME-01 → LAYOUT-01 → LAYOUT-02 → MD-01 → IMP-01 → IMP-02 → IMP-03/AV-01 → OV-01 → EX-01. Setiap item memerlukan PR terfokus; pencantumannya tidak mengubah permission, kontrak backend, atau migrasi data.
