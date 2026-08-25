import { ApiClientError } from '@/lib/apiClient';
import { DeviceTransferContractError, isTransferNetworkAmbiguity, type DeviceTransferDto } from '@/services/deviceTransferApi';

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
  if (error.kind === 'invalid_response') return { ...fallback, message: 'Server mengembalikan respons Transfer yang tidak valid.', retryable: false };
  return fallback;
}
