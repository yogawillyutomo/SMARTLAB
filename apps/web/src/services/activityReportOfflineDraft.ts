import type { ActivityReportDto, ActivityReportType, UpdateActivityReportInput } from '@/services/activityReportApi';

export const OFFLINE_ACTIVITY_REPORT_DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const PREFIX = 'smartlab:activity-report-offline-draft:v1';

export interface OfflineDraftIdentity {
  userId: string;
  membershipId: string;
  schoolId: string;
}

export interface ActivityReportEditableSnapshot {
  reportType: ActivityReportType;
  presentCount: number | null;
  absentCount: number | null;
  attendanceNotes: string | null;
  externalAttendanceSystem: string | null;
  externalAttendanceReferenceId: string | null;
  commonContent: Record<string, string | null>;
  typeSpecificContent: Record<string, string | null>;
}

export interface OfflineActivityReportDraft {
  schemaVersion: 1;
  identity: OfflineDraftIdentity;
  reportId: string;
  baseVersion: number;
  clientMutationId: string;
  baseSnapshot: ActivityReportEditableSnapshot;
  draftSnapshot: ActivityReportEditableSnapshot;
  savedAt: string;
}

interface StorageLike {
  readonly length: number;
  key(index: number): string | null;
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class OfflineActivityReportDraftError extends Error {
  constructor(message = 'Draft offline ActivityReport tidak valid.') {
    super(message);
    this.name = 'OfflineActivityReportDraftError';
  }
}

function nonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

function uuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function positive(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nullableCount(value: unknown): value is number | null {
  return value === null || (Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 32767);
}

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function content(value: unknown): value is Record<string, string | null> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && Object.values(value).every(nullableString);
}

function snapshot(value: unknown): value is ActivityReportEditableSnapshot {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return ['practicum', 'exam', 'workshop', 'general'].includes(String(item.reportType))
    && nullableCount(item.presentCount)
    && nullableCount(item.absentCount)
    && nullableString(item.attendanceNotes)
    && nullableString(item.externalAttendanceSystem)
    && nullableString(item.externalAttendanceReferenceId)
    && content(item.commonContent)
    && content(item.typeSpecificContent);
}

function sameIdentity(a: OfflineDraftIdentity, b: OfflineDraftIdentity): boolean {
  return a.userId === b.userId && a.membershipId === b.membershipId && a.schoolId === b.schoolId;
}

function storageKey(identity: OfflineDraftIdentity, reportId: string): string {
  return [PREFIX, identity.schoolId, identity.membershipId, identity.userId, reportId]
    .map(encodeURIComponent)
    .join(':');
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, item]) => [key, stable(item)]));
}

function equal(a: unknown, b: unknown): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

export function createClientMutationId(): string {
  if (typeof globalThis.crypto?.randomUUID !== 'function') {
    throw new OfflineActivityReportDraftError('Browser tidak mendukung UUID aman untuk sinkronisasi draft.');
  }
  return globalThis.crypto.randomUUID();
}

export function editableSnapshotFromReport(report: ActivityReportDto): ActivityReportEditableSnapshot {
  return {
    reportType: report.reportType,
    presentCount: report.attendance.presentCount,
    absentCount: report.attendance.absentCount,
    attendanceNotes: report.attendance.notes,
    externalAttendanceSystem: report.attendance.externalSystem,
    externalAttendanceReferenceId: report.attendance.externalReferenceId,
    commonContent: { ...report.commonContent },
    typeSpecificContent: { ...report.typeSpecificContent },
  };
}

export function isEditableSnapshotEqual(a: ActivityReportEditableSnapshot, b: ActivityReportEditableSnapshot): boolean {
  return equal(a, b);
}

export function diffEditableSnapshot(
  base: ActivityReportEditableSnapshot,
  draft: ActivityReportEditableSnapshot,
): UpdateActivityReportInput {
  const patch: UpdateActivityReportInput = {};

  for (const key of [
    'reportType',
    'presentCount',
    'absentCount',
    'attendanceNotes',
    'externalAttendanceSystem',
    'externalAttendanceReferenceId',
  ] as const) {
    if (!equal(base[key], draft[key])) {
      Object.assign(patch, { [key]: draft[key] });
    }
  }

  if (!equal(base.commonContent, draft.commonContent)) {
    patch.commonContent = { ...draft.commonContent };
  }
  if (!equal(base.typeSpecificContent, draft.typeSpecificContent)) {
    patch.typeSpecificContent = { ...draft.typeSpecificContent };
  }

  return patch;
}

function mergeContent(
  base: Record<string, string | null>,
  local: Record<string, string | null>,
  server: Record<string, string | null>,
): Record<string, string | null> {
  const result = { ...server };
  for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(server)])) {
    if (!equal(base[key] ?? null, local[key] ?? null)) {
      result[key] = local[key] ?? null;
    }
  }
  return result;
}

export function rebaseEditableSnapshot(
  base: ActivityReportEditableSnapshot,
  local: ActivityReportEditableSnapshot,
  server: ActivityReportEditableSnapshot,
): ActivityReportEditableSnapshot {
  const scalar = <K extends keyof Omit<ActivityReportEditableSnapshot, 'commonContent' | 'typeSpecificContent'>>(key: K): ActivityReportEditableSnapshot[K] =>
    (!equal(base[key], local[key]) ? local[key] : server[key]);

  const reportType = scalar('reportType');

  return {
    reportType,
    presentCount: scalar('presentCount'),
    absentCount: scalar('absentCount'),
    attendanceNotes: scalar('attendanceNotes'),
    externalAttendanceSystem: scalar('externalAttendanceSystem'),
    externalAttendanceReferenceId: scalar('externalAttendanceReferenceId'),
    commonContent: mergeContent(base.commonContent, local.commonContent, server.commonContent),
    typeSpecificContent: reportType !== server.reportType && reportType === local.reportType
      ? { ...local.typeSpecificContent }
      : mergeContent(base.typeSpecificContent, local.typeSpecificContent, server.typeSpecificContent),
  };
}

export function conflictingEditableFields(
  base: ActivityReportEditableSnapshot,
  local: ActivityReportEditableSnapshot,
  server: ActivityReportEditableSnapshot,
): string[] {
  const conflicts: string[] = [];

  for (const key of [
    'reportType',
    'presentCount',
    'absentCount',
    'attendanceNotes',
    'externalAttendanceSystem',
    'externalAttendanceReferenceId',
  ] as const) {
    const localChanged = !equal(base[key], local[key]);
    const serverChanged = !equal(base[key], server[key]);
    if (localChanged && serverChanged && !equal(local[key], server[key])) conflicts.push(key);
  }

  for (const [prefix, baseContent, localContent, serverContent] of [
    ['commonContent', base.commonContent, local.commonContent, server.commonContent],
    ['typeSpecificContent', base.typeSpecificContent, local.typeSpecificContent, server.typeSpecificContent],
  ] as const) {
    for (const key of new Set([...Object.keys(baseContent), ...Object.keys(localContent), ...Object.keys(serverContent)])) {
      const baseValue = baseContent[key] ?? null;
      const localValue = localContent[key] ?? null;
      const serverValue = serverContent[key] ?? null;
      if (!equal(baseValue, localValue) && !equal(baseValue, serverValue) && !equal(localValue, serverValue)) {
        conflicts.push(`${prefix}.${key}`);
      }
    }
  }

  return conflicts.sort();
}

export function makeOfflineActivityReportDraft(
  identity: OfflineDraftIdentity,
  reportId: string,
  baseVersion: number,
  baseSnapshot: ActivityReportEditableSnapshot,
  draftSnapshot: ActivityReportEditableSnapshot,
  clientMutationId = createClientMutationId(),
  savedAt = new Date().toISOString(),
): OfflineActivityReportDraft {
  if (!nonEmpty(identity.userId) || !nonEmpty(identity.membershipId) || !nonEmpty(identity.schoolId)
    || !nonEmpty(reportId) || !positive(baseVersion) || !uuid(clientMutationId)
    || Number.isNaN(Date.parse(savedAt))) {
    throw new OfflineActivityReportDraftError();
  }

  return {
    schemaVersion: 1,
    identity: { ...identity },
    reportId,
    baseVersion,
    clientMutationId,
    baseSnapshot: {
      ...baseSnapshot,
      commonContent: { ...baseSnapshot.commonContent },
      typeSpecificContent: { ...baseSnapshot.typeSpecificContent },
    },
    draftSnapshot: {
      ...draftSnapshot,
      commonContent: { ...draftSnapshot.commonContent },
      typeSpecificContent: { ...draftSnapshot.typeSpecificContent },
    },
    savedAt,
  };
}

export function saveOfflineActivityReportDraft(
  draft: OfflineActivityReportDraft,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  storage.setItem(storageKey(draft.identity, draft.reportId), JSON.stringify(draft));
}

export function loadOfflineActivityReportDraft(
  identity: OfflineDraftIdentity,
  reportId: string,
  storage: StorageLike | null = browserStorage(),
  now = Date.now(),
): OfflineActivityReportDraft | null {
  if (!storage) return null;
  const key = storageKey(identity, reportId);
  const raw = storage.getItem(key);
  if (!raw) return null;

  try {
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid');
    const item = value as Record<string, unknown>;
    if (item.schemaVersion !== 1
      || typeof item.identity !== 'object' || item.identity === null || Array.isArray(item.identity)
      || !nonEmpty(item.reportId) || item.reportId !== reportId
      || !positive(item.baseVersion) || !uuid(item.clientMutationId)
      || !snapshot(item.baseSnapshot) || !snapshot(item.draftSnapshot)
      || !nonEmpty(item.savedAt) || Number.isNaN(Date.parse(item.savedAt))) {
      throw new Error('invalid');
    }

    const storedIdentity = item.identity as Record<string, unknown>;
    const parsedIdentity: OfflineDraftIdentity = {
      userId: String(storedIdentity.userId ?? ''),
      membershipId: String(storedIdentity.membershipId ?? ''),
      schoolId: String(storedIdentity.schoolId ?? ''),
    };
    if (!sameIdentity(identity, parsedIdentity)) throw new Error('identity');

    if (now - Date.parse(item.savedAt) > OFFLINE_ACTIVITY_REPORT_DRAFT_TTL_MS) {
      storage.removeItem(key);
      return null;
    }

    return {
      schemaVersion: 1,
      identity: parsedIdentity,
      reportId: item.reportId,
      baseVersion: item.baseVersion,
      clientMutationId: item.clientMutationId,
      baseSnapshot: item.baseSnapshot,
      draftSnapshot: item.draftSnapshot,
      savedAt: item.savedAt,
    };
  } catch {
    storage.removeItem(key);
    return null;
  }
}

export function clearOfflineActivityReportDraft(
  identity: OfflineDraftIdentity,
  reportId: string,
  storage: StorageLike | null = browserStorage(),
): void {
  storage?.removeItem(storageKey(identity, reportId));
}

export function clearOfflineActivityReportDraftsForIdentity(
  identity: OfflineDraftIdentity,
  storage: StorageLike | null = browserStorage(),
): void {
  if (!storage) return;
  const prefix = [PREFIX, identity.schoolId, identity.membershipId, identity.userId]
    .map(encodeURIComponent)
    .join(':') + ':';
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(prefix)) keys.push(key);
  }
  keys.forEach((key) => storage.removeItem(key));
}
