import { describe, expect, it } from 'vitest';
import {
  OFFLINE_ACTIVITY_REPORT_DRAFT_TTL_MS,
  clearOfflineActivityReportDraftsForIdentity,
  conflictingEditableFields,
  diffEditableSnapshot,
  loadOfflineActivityReportDraft,
  makeOfflineActivityReportDraft,
  rebaseEditableSnapshot,
  saveOfflineActivityReportDraft,
  type ActivityReportEditableSnapshot,
  type OfflineDraftIdentity,
} from '@/services/activityReportOfflineDraft';

class MemoryStorage {
  private readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

const identity: OfflineDraftIdentity = {
  userId: '01USER',
  membershipId: '01MEMBERSHIP',
  schoolId: '01SCHOOL',
};

const base: ActivityReportEditableSnapshot = {
  reportType: 'practicum',
  presentCount: 30,
  absentCount: 2,
  attendanceNotes: null,
  externalAttendanceSystem: 'HADIRA',
  externalAttendanceReferenceId: 'ATT-1',
  commonContent: {
    objective: 'Tujuan awal',
    material: 'DOM',
    resources: null,
    issues: null,
    followUp: null,
    outcomeReflection: null,
  },
  typeSpecificContent: {
    topic: 'DOM',
    steps: null,
    softwareTools: 'Browser',
    learningOutcome: null,
  },
};

describe('offline ActivityReport draft cache', () => {
  it('persists only inside the matching identity scope and expires stale cache', () => {
    const storage = new MemoryStorage();
    const savedAt = '2026-09-05T00:00:00.000Z';
    const draft = makeOfflineActivityReportDraft(
      identity,
      '01REPORT',
      3,
      base,
      { ...base, attendanceNotes: 'Lokal' },
      '550e8400-e29b-41d4-a716-446655440000',
      savedAt,
    );
    saveOfflineActivityReportDraft(draft, storage);

    expect(loadOfflineActivityReportDraft(identity, '01REPORT', storage, Date.parse(savedAt) + 1_000))
      .toEqual(draft);
    expect(loadOfflineActivityReportDraft(
      { ...identity, userId: '01OTHER' },
      '01REPORT',
      storage,
      Date.parse(savedAt) + 1_000,
    )).toBeNull();
    expect(loadOfflineActivityReportDraft(
      identity,
      '01REPORT',
      storage,
      Date.parse(savedAt) + OFFLINE_ACTIVITY_REPORT_DRAFT_TTL_MS + 1,
    )).toBeNull();
  });

  it('builds a minimal top-level patch and tracks nested content changes', () => {
    const local = {
      ...base,
      attendanceNotes: 'Catatan lokal',
      commonContent: { ...base.commonContent, outcomeReflection: 'Refleksi lokal' },
    };

    expect(diffEditableSnapshot(base, local)).toEqual({
      attendanceNotes: 'Catatan lokal',
      commonContent: { ...base.commonContent, outcomeReflection: 'Refleksi lokal' },
    });
  });

  it('rebases only local changes over newer server values', () => {
    const local = {
      ...base,
      attendanceNotes: 'Lokal',
      commonContent: { ...base.commonContent, outcomeReflection: 'Refleksi lokal' },
    };
    const server = {
      ...base,
      presentCount: 31,
      commonContent: { ...base.commonContent, material: 'DOM + Event', objective: 'Tujuan server' },
    };

    expect(rebaseEditableSnapshot(base, local, server)).toEqual({
      ...server,
      attendanceNotes: 'Lokal',
      commonContent: {
        ...server.commonContent,
        outcomeReflection: 'Refleksi lokal',
      },
    });
  });

  it('reports only fields concurrently changed to different values', () => {
    const local = {
      ...base,
      attendanceNotes: 'Lokal',
      commonContent: { ...base.commonContent, objective: 'Tujuan lokal' },
    };
    const server = {
      ...base,
      attendanceNotes: 'Server',
      presentCount: 31,
      commonContent: { ...base.commonContent, objective: 'Tujuan server', material: 'Materi server' },
    };

    expect(conflictingEditableFields(base, local, server)).toEqual([
      'attendanceNotes',
      'commonContent.objective',
    ]);
  });

  it('clears every draft belonging to one account context without touching another identity', () => {
    const storage = new MemoryStorage();
    const other = { ...identity, membershipId: '01OTHER' };
    const mutation = '550e8400-e29b-41d4-a716-446655440000';
    saveOfflineActivityReportDraft(makeOfflineActivityReportDraft(identity, '01R1', 1, base, base, mutation), storage);
    saveOfflineActivityReportDraft(makeOfflineActivityReportDraft(identity, '01R2', 1, base, base, mutation), storage);
    saveOfflineActivityReportDraft(makeOfflineActivityReportDraft(other, '01R3', 1, base, base, mutation), storage);

    clearOfflineActivityReportDraftsForIdentity(identity, storage);

    expect(loadOfflineActivityReportDraft(identity, '01R1', storage)).toBeNull();
    expect(loadOfflineActivityReportDraft(identity, '01R2', storage)).toBeNull();
    expect(loadOfflineActivityReportDraft(other, '01R3', storage)).not.toBeNull();
  });
});
