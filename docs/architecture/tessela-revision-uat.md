# TESSELA Revision Integration UAT

**Status:** Automated in S2.8

Tujuan UAT ini adalah membuktikan bahwa revisi timetable di tengah semester tidak merusak komitmen operasional SmartLab.

## UAT-01 — New occurrence vs Reservation

Given:
- TESSELA v1 active;
- Reservation dibuat pada slot yang bebas di v1;
- TESSELA v2 menambahkan occurrence pada slot Reservation tersebut.

Expected:
- impact preview = not clear;
- blocker = `reservation_conflict`;
- activation v2 = rejected;
- v1 tetap active;
- Reservation harus direconcile lewat Reservation lifecycle;
- setelah blocker selesai, v2 dapat diaktifkan atomically.

## UAT-02 — New occurrence vs approved Priority Event

Given:
- TESSELA v1 active;
- Priority Event telah approved pada slot bebas;
- TESSELA v2 menambahkan occurrence yang overlap.

Expected:
- blocker = `priority_event_conflict`;
- v2 tidak dapat diaktifkan;
- event tidak dibatalkan otomatis;
- setelah event direconcile/cancelled, v2 dapat diaktifkan.

## UAT-03 — Existing Schedule Exception across source version

Given:
- TESSELA v1 active;
- occurrence v1 memiliki active Schedule Exception;
- TESSELA v2 masih memiliki sourceScheduleId/date yang sama.

Expected:
- blocker = `active_schedule_exception`;
- exception tidak dipindahkan otomatis ke occurrence v2;
- operator harus reconcile exception v1 terlebih dahulu;
- history exception v1 tetap tersimpan.

## UAT-04 — Calendar/Laboratory drift

Given:
- candidate sudah validated;
- sesudah validation muncul Calendar blocker atau Laboratory menjadi inactive.

Expected:
- impact preview menangkap drift saat ini;
- activation fails closed.

## UAT-05 — Capacity drift

Given:
- candidate validated ketika Laboratory capacity cukup;
- sebelum activation capacity diturunkan di bawah current class student count.

Expected:
- blocker = `laboratory_capacity_conflict`;
- activation fails closed.

## Acceptance

S2.8 integration gate dianggap lulus bila seluruh automated scenarios di atas berjalan pada portable API suite dan PostgreSQL migration/seeder gate.
