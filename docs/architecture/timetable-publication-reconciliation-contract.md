# Timetable Publication Impact & Reconciliation Contract

**Status:** Implemented in S2.8

Kontrak ini mengatur bagaimana SmartLab menerima revisi published timetable TESSELA ketika sudah ada komitmen operasional di SmartLab.

## Problem

Validasi saat ingestion hanya membuktikan bahwa payload TESSELA valid pada saat diterima. Antara ingestion dan activation, kondisi operasional dapat berubah:

- Reservation dibuat/approved;
- Schedule Exception aktif;
- Priority Event approved;
- Calendar blocker dibuat;
- Laboratory dinonaktifkan;
- kapasitas Laboratory diturunkan.

Karena itu `validated` tidak otomatis berarti `safe to activate now`.

## Required flow

```text
TESSELA vN+1
    ↓
ingest + structural validation
    ↓
validated
    ↓
GET impact preview
    ↓
resolve blockers explicitly
    ↓
GET impact preview again
    ↓
POST activate
    ↓
impact recalculated inside activation transaction
    ↓
atomic supersede + activate
```

Tidak ada `forceActivate`.

## Future-only impact window

Impact operasional hanya dievaluasi untuk:

```text
from = max(School-local today, candidate.effectiveFrom)
to   = candidate.effectiveTo
```

Historical completed operation tidak ditulis ulang oleh revisi timetable.

## Schedule diff

Candidate dan current plan dicocokkan menggunakan:

```text
sourceScheduleId + occurrenceDate
```

Setiap occurrence diklasifikasikan menjadi:

- `added`;
- `removed`;
- `changed`;
- `unchanged`.

Structural signature untuk `changed`:

- teacher;
- academic class;
- subject;
- planned Laboratory;
- start/end time;
- activity type.

SmartLab hanya melaporkan diff. SmartLab tidak menyelesaikan konflik akademik atau mengoptimasi timetable.

## Activation blockers

### Active Schedule Exception

Setiap active future Schedule Exception yang masih terikat ke current publication menjadi blocker.

Alasan: exception tidak boleh diam-diam dipindahkan ke occurrence dari source version baru, walaupun `sourceScheduleId + date` masih ada dan signature sama.

Operator harus secara eksplisit:

1. menilai apakah exception masih diperlukan;
2. membatalkan/reconcile exception lama;
3. mengaktifkan publication baru;
4. bila masih diperlukan, membuat exception baru terhadap occurrence baru.

### Reservation conflict

Reservation `submitted` atau `approved` yang overlap candidate Laboratory/date/time memblokir activation.

Resolution harus melalui lifecycle Reservation yang sudah canonical.

### Approved Priority Event conflict

Priority Event approved yang overlap candidate occurrence memblokir activation.

Priority Event tidak dibatalkan otomatis untuk memberi jalan kepada timetable.

### Calendar blocker conflict

Active blocked Calendar Event yang mengenai candidate occurrence menjadi impact blocker.

Ini memaksa operator meninjau publikasi baru terhadap closure/maintenance operasional yang masih berlaku.

### Laboratory status drift

Candidate occurrence yang menunjuk Laboratory yang sekarang inactive memblokir activation, walaupun Laboratory masih active saat ingestion.

### Laboratory capacity drift

Jika current AcademicClass student count diketahui dan sekarang melebihi current Laboratory capacity, activation diblokir.

Ini menutup drift antara validation dan activation.

## Deterministic impact fingerprint

Preview mengembalikan SHA-256 fingerprint atas:

- candidate/current publication identity;
- future impact window;
- schedule diff;
- seluruh blocker canonical.

Daftar blocker response dibatasi untuk menjaga response size, tetapi blocker count dan fingerprint tetap menghitung seluruh evidence yang ditemukan.

Fingerprint berguna untuk audit/diagnostics, **bukan approval token**.

Activation selalu menghitung impact ulang dan tidak mempercayai preview lama.

## Atomic activation

Activation mengambil School row lock sebelum mengevaluasi impact.

Mutation operasional yang dapat mengubah availability juga menggunakan School-scoped write lock. Karena itu supported write paths tidak dapat menyisipkan komitmen baru di antara impact check dan atomic activation.

Jika impact tidak clear:

```text
409 TIMETABLE_PUBLICATION_RECONCILIATION_REQUIRED
```

Current publication tetap `active`. Candidate tetap `validated`.

Jika clear:

1. current publication → `superseded`;
2. candidate → `active`;
3. activation audit menyimpan impact fingerprint, schedule diff, dan blocker count.

Semua berada dalam satu database transaction.

## First publication

Walaupun belum ada current publication, candidate tetap menjalani impact gate untuk current Laboratory status/capacity dan Calendar/operational evidence yang relevan.

## No silent repair

SmartLab tidak:

- memindahkan room;
- mengubah teacher/class/subject;
- menggeser period;
- menghapus Reservation;
- menghapus Priority Event;
- memigrasikan Schedule Exception;
- memilih “best alternative”.

Tugas itu tetap berada pada domain pemilik atau TESSELA.

## Scale note

Impact scan sengaja bersifat explainable dan correctness-first untuk skala sekolah. Jika volume publication/occurrence bertambah jauh di atas target sekolah, indexing dan incremental diff dapat dioptimalkan tanpa mengubah semantic contract.
