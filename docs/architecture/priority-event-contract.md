# Priority Event Contract

**Status:** Implemented in S2.8

Priority Event adalah permintaan penggunaan Laboratory untuk kegiatan yang secara bisnis memiliki prioritas tinggi, tetapi **priority tidak berarti force override**.

SmartLab tetap menjaga satu Unified Laboratory Availability dan satu audit trail. Konflik harus diselesaikan secara eksplisit sebelum Priority Event dapat menjadi occupancy operasional.

## Lifecycle

```text
submitted
  ├─ approved
  ├─ rejected
  └─ cancelled

approved
  └─ cancelled
```

Tidak ada state `forced` atau `overridden`.

## Submission may record a conflict

Berbeda dari Reservation, Priority Event boleh dibuat dalam status `submitted` walaupun preflight availability sedang:

- `scheduled`;
- `blocked`;
- `mixed`; atau
- `unknown`.

Tujuannya agar kebutuhan prioritas dapat masuk workflow resmi dan membawa evidence konflik yang harus direkonsiliasi.

Submission tidak mengubah ScheduleOccurrence, ScheduleException, Reservation, Calendar Event, atau Priority Event lain.

Audit `priority_event.submitted` menyimpan snapshot availability pada saat submission.

## Approval is fail-closed

Approval selalu menghitung ulang Unified Laboratory Availability di dalam mutation transaction.

Approval hanya berhasil jika:

```text
availability.available === true
```

Jika masih ada blocker atau schedule coverage belum dapat membuktikan slot aman, server mengembalikan:

```text
409 PRIORITY_EVENT_RECONCILIATION_REQUIRED
```

Operator kemudian menyelesaikan konflik melalui domain pemiliknya, misalnya:

- ScheduleOccurrence → buat/cabut Schedule Exception yang sah;
- Reservation → batalkan/tolak melalui lifecycle Reservation;
- Calendar blocker → ubah/batalkan Calendar Event yang berwenang;
- Priority Event lain → batalkan event yang sudah tidak berlaku;
- Laboratory inactive/capacity → selesaikan state Laboratory, bukan bypass.

Setelah itu approver mengulang approval.

## Approved Priority Event

Priority Event berstatus `approved` menjadi blocker canonical di Unified Laboratory Availability.

Evidence:

```text
type = priority_event
sourceId = PriorityEvent.id
eventNumber
category
requester
participants
PIC
```

Priority Event approved tidak menghapus atau menulis ulang timetable TESSELA.

## Authorization baseline

| Role | View | View all | Create | Approve/Reject | Cancel | Export |
| --- | --- | --- | --- | --- | --- | --- |
| Super Admin | yes | yes | yes | yes | yes | yes |
| Admin Lab | yes | yes | yes | yes | yes | yes |
| Kepala Lab | yes | yes | yes | yes | yes | yes |
| Teknisi | yes | yes | no | no | no | no |
| Guru | yes | no | yes | no | own only | no |
| Pimpinan | yes | yes | no | no | no | yes |
| Siswa / Ketua Kelas | no | no | no | no | no | no |

Requester identity selalu berasal dari authenticated User + active SchoolMembership. Client tidak boleh mengirim requester/approver identity.

## Versioning and audit

Mutation material memakai integer version dan optimistic precondition:

```http
If-Match: "<current-version>"
```

Missing/malformed precondition → HTTP 428.  
Stale version → HTTP 412.

Audit events:

- `priority_event.submitted`;
- `priority_event.approved`;
- `priority_event.rejected`;
- `priority_event.cancelled`.

## Concurrency

Priority Event mutations mengambil School-scoped operational write lock sebelum Laboratory/entity locks.

Tujuannya menyerialkan availability-changing writes terhadap:

- timetable publication activation;
- Reservation mutations;
- Schedule Exception mutations;
- Calendar mutations;
- Priority Event mutations;
- Laboratory state mutation.

Read paths tetap paralel.

## Non-goals

S2.8 Priority Event tidak:

- menjadi timetable solver;
- memindahkan guru/kelas/jam secara otomatis;
- membatalkan Reservation secara otomatis;
- membuat Schedule Exception otomatis;
- mem-bypass Calendar/Laboratory blockers;
- menyediakan force approval.
