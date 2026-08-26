import { ApiClientError } from '@/lib/apiClient';
import { DeviceTransferContractError, isTransferNetworkAmbiguity, type DeviceTransferDto } from '@/services/deviceTransferApi';
import type { DeviceDto, DeviceGateway } from '@/services/deviceApi';
import type { DeviceTransferGateway, DeviceTransferPage } from '@/services/deviceTransferApi';

export type TransferFormField = 'destinationLaboratoryId' | 'reason' | 'request';

export interface DeviceTransferPresentationIssue {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
  notFound: boolean;
  versionConflict: boolean;
  preconditionFailure: boolean;
  ambiguous: boolean;
  fieldErrors: Partial<Record<TransferFormField, string>>;
}

export function normalizeTransferReason(value: string): string | null {
  const normalized = value.trim();
  return normalized === '' ? null : normalized;
}

export function validateTransferForm(destinationLaboratoryId: string, reason: string): Partial<Record<TransferFormField, string>> {
  const errors: Partial<Record<TransferFormField, string>> = {};
  if (destinationLaboratoryId.trim() === '') errors.destinationLaboratoryId = 'Laboratorium tujuan wajib dipilih.';
  const normalizedReason = reason.trim();
  if (normalizedReason.length > 500) errors.reason = 'Alasan maksimal 500 karakter.';
  return errors;
}

export interface TransferReconciliationSnapshot {
  deviceId: string;
  submittedVersion: number;
  sourceLaboratoryId: string;
  destinationLaboratoryId: string;
  reason: string | null;
}

export type TransferHistoryEvidence =
  | { status: 'available'; page: DeviceTransferPage }
  | { status: 'unavailable'; issue: DeviceTransferPresentationIssue };

export type TransferReconciliationResult =
  | { status: 'confirmed'; device: DeviceDto; history?: TransferHistoryEvidence; knownSuccess: boolean }
  | { status: 'unconfirmed'; device: DeviceDto; history?: TransferHistoryEvidence }
  | { status: 'concurrent_change'; device: DeviceDto; history?: TransferHistoryEvidence }
  | { status: 'unavailable' }
  | { status: 'stale_route' };

interface ReconcileTransferOptions {
  deviceId: string;
  snapshot?: TransferReconciliationSnapshot;
  knownSuccess?: boolean;
  canViewHistory: boolean;
  deviceGateway: Pick<DeviceGateway, 'show'>;
  transferGateway: Pick<DeviceTransferGateway, 'history'>;
  isCurrent: () => boolean;
}

function classifyTransferEvidence(device: DeviceDto, snapshot: TransferReconciliationSnapshot | undefined, history: TransferHistoryEvidence | undefined, knownSuccess: boolean): TransferReconciliationResult['status'] {
  if (knownSuccess) return 'confirmed';
  if (!snapshot) return 'unconfirmed';
  if (history?.status === 'available' && history.page.data.some((item) => matchesTransferReconciliation(item, snapshot))) return 'confirmed';
  if (device.version === snapshot.submittedVersion + 1 && device.homeLaboratoryId === snapshot.destinationLaboratoryId) return 'confirmed';
  if (device.version === snapshot.submittedVersion && device.homeLaboratoryId === snapshot.sourceLaboratoryId
    && !(history?.status === 'available' && history.page.data.some((item) => matchesTransferReconciliation(item, snapshot)))) return 'unconfirmed';
  return 'concurrent_change';
}

export async function reconcileDeviceTransfer(options: ReconcileTransferOptions): Promise<TransferReconciliationResult> {
  if (!options.isCurrent()) return { status: 'stale_route' };
  let device: DeviceDto;
  try {
    device = await options.deviceGateway.show(options.deviceId);
  } catch {
    return options.isCurrent() ? { status: 'unavailable' } : { status: 'stale_route' };
  }
  if (!options.isCurrent()) return { status: 'stale_route' };

  let history: TransferHistoryEvidence | undefined;
  if (options.canViewHistory) {
    try {
      const page = await options.transferGateway.history(options.deviceId, { page: 1, perPage: 10 });
      if (!options.isCurrent()) return { status: 'stale_route' };
      history = { status: 'available', page };
    } catch (error) {
      if (!options.isCurrent()) return { status: 'stale_route' };
      history = { status: 'unavailable', issue: deviceTransferPresentationIssue(error, 'history') };
    }
  }
  if (!options.isCurrent()) return { status: 'stale_route' };
  const status = classifyTransferEvidence(device, options.snapshot, history, options.knownSuccess === true);
  if (status === 'confirmed') return { status, device, history, knownSuccess: options.knownSuccess === true };
  return { status, device, history };
}

export type TransferMutationResult =
  | { status: 'confirmed'; reconciliation: TransferReconciliationResult }
  | { status: 'unconfirmed' | 'concurrent_change' | 'stale_route'; reconciliation: TransferReconciliationResult }
  | { status: 'unavailable'; reconciliation: TransferReconciliationResult; knownSuccess: boolean }
  | { status: 'rejected'; issue: DeviceTransferPresentationIssue; reconciliation?: TransferReconciliationResult }
  | { status: 'stale_route' };

interface ExecuteTransferMutationOptions {
  deviceId: string;
  expectedVersion: number;
  input: { destinationLaboratoryId: string; reason: string | null };
  snapshot: TransferReconciliationSnapshot;
  create: (deviceId: string, expectedVersion: number, input: { destinationLaboratoryId: string; reason: string | null }) => Promise<unknown>;
  reconcile: (snapshot?: TransferReconciliationSnapshot, knownSuccess?: boolean) => Promise<TransferReconciliationResult>;
  isCurrent: () => boolean;
}

export async function executeTransferMutation(options: ExecuteTransferMutationOptions): Promise<TransferMutationResult> {
  if (!options.isCurrent()) return { status: 'stale_route' };
  try {
    await options.create(options.deviceId, options.expectedVersion, options.input);
    if (!options.isCurrent()) return { status: 'stale_route' };
    const reconciliation = await options.reconcile(undefined, true);
    if (!options.isCurrent() || reconciliation.status === 'stale_route') return { status: 'stale_route' };
    if (reconciliation.status === 'confirmed') return { status: 'confirmed', reconciliation };
    if (reconciliation.status === 'unavailable') return { status: 'unavailable', reconciliation, knownSuccess: true };
    return { status: reconciliation.status, reconciliation };
  } catch (error) {
    if (!options.isCurrent()) return { status: 'stale_route' };
    const issue = deviceTransferPresentationIssue(error, 'mutation');
    if (issue.authBoundary || (!issue.ambiguous && !issue.versionConflict)) return { status: 'rejected', issue };
    const reconciliation = await options.reconcile(issue.ambiguous ? options.snapshot : undefined, false);
    if (!options.isCurrent() || reconciliation.status === 'stale_route') return { status: 'stale_route' };
    if (issue.versionConflict) return { status: 'rejected', issue, reconciliation };
    if (reconciliation.status === 'confirmed') return { status: 'confirmed', reconciliation };
    if (reconciliation.status === 'unavailable') return { status: 'unavailable', reconciliation, knownSuccess: false };
    return { status: reconciliation.status, reconciliation };
  }
}

export function matchesTransferReconciliation(transfer: DeviceTransferDto, snapshot: TransferReconciliationSnapshot): boolean {
  return transfer.deviceId === snapshot.deviceId
    && transfer.deviceVersionBefore === snapshot.submittedVersion
    && transfer.sourceLaboratory.id === snapshot.sourceLaboratoryId
    && transfer.destinationLaboratory.id === snapshot.destinationLaboratoryId
    && (snapshot.reason === null || transfer.reason === snapshot.reason);
}

export function deviceTransferPresentationIssue(error: unknown, context: 'mutation' | 'history' = 'mutation'): DeviceTransferPresentationIssue {
  const fallback: DeviceTransferPresentationIssue = {
    message: 'Data Transfer tidak dapat diproses. Silakan coba lagi.',
    retryable: context === 'history',
    authBoundary: false,
    notFound: false,
    versionConflict: false,
    preconditionFailure: false,
    ambiguous: false,
    fieldErrors: {},
  };
  if (error instanceof DeviceTransferContractError) {
    return { ...fallback, message: 'Respons Transfer dari server tidak sesuai kontrak yang diharapkan.', retryable: false, ambiguous: context === 'mutation' };
  }
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return { ...fallback, message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk alur Transfer ini.', retryable: false };
  }
  if (error.status === 404 || error.code === 'DEVICE_NOT_FOUND') {
    return { ...fallback, message: 'Perangkat tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.code === 'LABORATORY_NOT_FOUND') {
    return { ...fallback, message: 'Laboratorium tujuan tidak ditemukan pada konteks sekolah aktif.', retryable: false };
  }
  if (error.status === 412 || error.code === 'DEVICE_VERSION_CONFLICT') {
    return { ...fallback, message: 'Data perangkat berubah di server. Periksa kembali laboratorium asal dan tujuan sebelum mencoba lagi.', retryable: false, versionConflict: true };
  }
  if (error.status === 428 || error.code === 'PRECONDITION_REQUIRED') {
    return { ...fallback, message: 'Versi perangkat tidak terkirim dengan benar. Muat ulang data sebelum mencoba lagi.', retryable: false, preconditionFailure: true };
  }
  const domainMessages: Record<string, string> = {
    TRANSFER_SOURCE_UNASSIGNED: 'Perangkat belum memiliki laboratorium asal yang mapan.',
    TRANSFER_SAME_LABORATORY: 'Laboratorium tujuan harus berbeda dari laboratorium asal.',
    TRANSFER_ACTIVE_PLACEMENT_EXISTS: 'Transfer tidak dapat dilakukan karena perangkat masih ditempatkan pada Layout aktif.',
    TRANSFER_DRAFT_REFERENCE_EXISTS: 'Transfer tidak dapat dilakukan karena perangkat direferensikan oleh draft Layout.',
    TRANSFER_DESTINATION_INELIGIBLE: 'Laboratorium tujuan harus aktif.',
    TRANSFER_DEVICE_NOT_ELIGIBLE: 'Lifecycle perangkat ini tidak mengizinkan Transfer.',
  };
  if (error.code && domainMessages[error.code]) return { ...fallback, message: domainMessages[error.code], retryable: false };
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    const fieldErrors: Partial<Record<TransferFormField, string>> = {};
    Object.entries(error.errors ?? {}).forEach(([field, messages]) => {
      if (messages[0] && (field === 'destinationLaboratoryId' || field === 'reason')) fieldErrors[field] = messages[0];
    });
    return { ...fallback, message: 'Periksa kembali data Transfer yang dimasukkan.', retryable: false, fieldErrors };
  }
  if (isTransferNetworkAmbiguity(error)) {
    return context === 'history'
      ? { ...fallback, message: 'Riwayat Transfer tidak dapat dimuat. Silakan coba lagi.' }
      : { ...fallback, message: 'Respons Transfer belum dapat dipastikan. Memeriksa data kanonik...', retryable: false, ambiguous: true };
  }
  if (error.kind === 'network') return { ...fallback, message: 'Layanan Transfer tidak dapat dijangkau. Periksa koneksi lalu coba lagi.', retryable: context === 'history' };
  if (error.kind === 'invalid_response') {
    const ambiguous = context === 'mutation' && error.status !== undefined && error.status >= 200 && error.status < 300;
    return { ...fallback, message: ambiguous ? 'Respons Transfer belum dapat dipastikan. Memeriksa data kanonik...' : 'Server mengembalikan respons Transfer yang tidak valid.', retryable: false, ambiguous };
  }
  return fallback;
}
