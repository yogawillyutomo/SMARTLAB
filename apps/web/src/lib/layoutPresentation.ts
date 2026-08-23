import { ApiClientError } from '@/lib/apiClient';
import { hasServerPermission } from '@/lib/authIdentity';
import { LayoutContractError } from '@/services/layoutApi';
import type { AuthenticatedUser } from '@/types';

export interface LayoutCapabilities {
  view: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  viewUnplacedDevices: boolean;
}

export interface LayoutPresentationIssue {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
  notFound: boolean;
  versionConflict: boolean;
  preconditionFailure: boolean;
  contractFailure: boolean;
  fieldErrors: Record<string, string>;
}

export function layoutCapabilities(user: AuthenticatedUser | null): LayoutCapabilities {
  const view = hasServerPermission(user, 'layouts.view');
  return {
    view,
    create: hasServerPermission(user, 'layouts.create'),
    update: hasServerPermission(user, 'layouts.update'),
    delete: hasServerPermission(user, 'layouts.delete'),
    viewUnplacedDevices: view && hasServerPermission(user, 'devices.view'),
  };
}

function firstValidationErrors(error: ApiClientError): Record<string, string> {
  return Object.fromEntries(
    Object.entries(error.errors ?? {})
      .filter(([, messages]) => messages.length > 0)
      .map(([field, messages]) => [field, messages[0]]),
  );
}

function baseIssue(): LayoutPresentationIssue {
  return {
    message: 'Data Layout tidak dapat diproses. Silakan coba lagi.',
    retryable: true,
    authBoundary: false,
    notFound: false,
    versionConflict: false,
    preconditionFailure: false,
    contractFailure: false,
    fieldErrors: {},
  };
}

const LAYOUT_CONFLICT_MESSAGES: Record<string, string> = {
  LAYOUT_DRAFT_ALREADY_EXISTS: 'Laboratorium ini sudah memiliki satu draft Layout.',
  LAYOUT_STATUS_CONFLICT: 'Tindakan ini tidak sesuai dengan status Layout saat ini.',
  LAYOUT_LABORATORY_INACTIVE: 'Laboratorium harus aktif untuk mengubah atau mengaktifkan Layout.',
  LAYOUT_DEVICE_ALREADY_PLACED: 'Satu Device tidak dapat ditempatkan lebih dari sekali dalam Layout.',
  LAYOUT_DEVICE_HOME_MISMATCH: 'Device tidak memiliki laboratorium asal yang sesuai dengan Layout ini.',
  LAYOUT_DEVICE_NOT_ELIGIBLE: 'Lifecycle Device tidak memenuhi syarat untuk ditempatkan.',
  LAYOUT_POSITION_OCCUPIED: 'Satu atau lebih footprint bertabrakan pada grid Layout.',
};

export function layoutPresentationIssue(error: unknown): LayoutPresentationIssue {
  const fallback = baseIssue();
  if (error instanceof LayoutContractError) {
    return {
      ...fallback,
      message: 'Respons Layout dari server tidak sesuai kontrak yang diharapkan.',
      retryable: false,
      contractFailure: true,
    };
  }
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return { ...fallback, message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.code === 'ACTIVE_MEMBERSHIP_REQUIRED' || error.code === 'SCHOOL_CONTEXT_REQUIRED') {
    return { ...fallback, message: 'Konteks sekolah aktif tidak tersedia. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk melakukan tindakan Layout ini.', retryable: false };
  }
  if (error.code === 'LAYOUT_NOT_FOUND') {
    return { ...fallback, message: 'Layout tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.code === 'LABORATORY_NOT_FOUND') {
    return { ...fallback, message: 'Laboratorium tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.status === 404) {
    return { ...fallback, message: 'Data yang diminta tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.status === 412 || error.code === 'LAYOUT_VERSION_CONFLICT') {
    return {
      ...fallback,
      message: 'Draft Layout telah berubah di server. Muat ulang lalu rekonsiliasi perubahan; perubahan lama tidak dikirim ulang otomatis.',
      retryable: false,
      versionConflict: true,
    };
  }
  if (error.status === 428 || error.code === 'PRECONDITION_REQUIRED') {
    return {
      ...fallback,
      message: 'Versi Layout tidak dikirim sesuai kontrak. Muat ulang halaman sebelum mencoba lagi.',
      retryable: false,
      preconditionFailure: true,
      contractFailure: true,
    };
  }
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    return {
      ...fallback,
      message: 'Periksa kembali data dan geometry Layout.',
      retryable: false,
      fieldErrors: firstValidationErrors(error),
    };
  }
  if (error.status === 409 && error.code && LAYOUT_CONFLICT_MESSAGES[error.code]) {
    return { ...fallback, message: LAYOUT_CONFLICT_MESSAGES[error.code], retryable: false };
  }
  if (error.kind === 'configuration') {
    return { ...fallback, message: 'Konfigurasi API Layout tidak valid.', retryable: false, contractFailure: true };
  }
  if (error.kind === 'invalid_response') {
    return {
      ...fallback,
      message: 'Server mengembalikan respons Layout yang tidak valid.',
      retryable: false,
      contractFailure: true,
    };
  }
  if (error.kind === 'network') {
    return { ...fallback, message: 'Layanan Layout tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' };
  }
  if (error.status !== undefined && error.status >= 500) {
    return { ...fallback, message: 'Server Layout sedang bermasalah. Silakan coba lagi.' };
  }
  return fallback;
}
