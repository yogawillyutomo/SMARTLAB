import { ApiClientError } from '@/lib/apiClient';
import {
  INCIDENT_CATEGORIES,
  INCIDENT_PRIORITIES,
  INCIDENT_STATUSES,
  IncidentContractError,
  type CreateIncidentInput,
  type IncidentCategory,
  type IncidentPriority,
  type IncidentStatus,
} from '@/services/incidentApi';

export const INCIDENT_CATEGORY_LABELS: Record<IncidentCategory, string> = {
  hardware: 'Perangkat Keras',
  software: 'Perangkat Lunak',
  network: 'Jaringan',
  electrical: 'Kelistrikan',
  peripheral: 'Periferal',
  facility: 'Fasilitas',
  cleanliness: 'Kebersihan',
  security: 'Keamanan',
  other: 'Lainnya',
};

export const INCIDENT_PRIORITY_LABELS: Record<IncidentPriority, string> = {
  low: 'Rendah',
  normal: 'Normal',
  high: 'Tinggi',
  critical: 'Kritis',
};

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  reported: 'Dilaporkan',
  triaged: 'Diverifikasi',
  assigned: 'Ditugaskan',
  in_progress: 'Diproses',
  resolved: 'Selesai',
  verified: 'Diuji',
  closed: 'Ditutup',
  rejected: 'Ditolak',
};

export function incidentStatusTone(status: IncidentStatus): 'neutral' | 'info' | 'accent' | 'warning' | 'success' | 'danger' | 'muted' {
  if (status === 'reported') return 'warning';
  if (status === 'triaged') return 'info';
  if (status === 'assigned') return 'accent';
  if (status === 'in_progress') return 'warning';
  if (status === 'resolved' || status === 'verified' || status === 'closed') return 'success';
  if (status === 'rejected') return 'danger';
  return 'neutral';
}

export function incidentPriorityTone(priority: IncidentPriority): 'neutral' | 'info' | 'warning' | 'danger' {
  if (priority === 'low') return 'neutral';
  if (priority === 'normal') return 'info';
  if (priority === 'high') return 'warning';
  return 'danger';
}

export interface IncidentCreateFormValues {
  laboratoryId: string;
  deviceId: string;
  category: IncidentCategory;
  priority: IncidentPriority;
  title: string;
  description: string;
  impact: string;
  blocksLaboratoryOperation: boolean;
  stepsTaken: string;
  occurredAt: string;
}

export type IncidentFormField = keyof IncidentCreateFormValues | 'request';
export type IncidentFormErrors = Partial<Record<IncidentFormField, string>>;

export type IncidentPresentationIssue = {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
  notFound: boolean;
  versionConflict: boolean;
  preconditionFailure: boolean;
  assigneeIneligible: boolean;
  fieldErrors: IncidentFormErrors;
};

export function emptyIncidentCreateForm(): IncidentCreateFormValues {
  const local = new Date(Date.now() - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  return {
    laboratoryId: '',
    deviceId: '',
    category: 'hardware',
    priority: 'normal',
    title: '',
    description: '',
    impact: '',
    blocksLaboratoryOperation: false,
    stepsTaken: '',
    occurredAt: local,
  };
}

function normalizedNullable(value: string, maximum: number, field: IncidentFormField, errors: IncidentFormErrors): string | null {
  const normalized = value.trim();
  if (normalized.length > maximum) errors[field] = `Maksimal ${maximum.toLocaleString('id-ID')} karakter.`;
  return normalized === '' ? null : normalized;
}

export function validateIncidentCreateForm(
  values: IncidentCreateFormValues,
  submissionId: string,
): { ok: true; value: CreateIncidentInput } | { ok: false; errors: IncidentFormErrors } {
  const errors: IncidentFormErrors = {};
  const laboratoryId = values.laboratoryId.trim();
  const deviceId = values.deviceId.trim();
  const title = values.title.trim();
  const description = values.description.trim();
  const impact = normalizedNullable(values.impact, 2000, 'impact', errors);
  const stepsTaken = normalizedNullable(values.stepsTaken, 2000, 'stepsTaken', errors);

  if (laboratoryId === '') errors.laboratoryId = 'Laboratorium wajib dipilih.';
  if (!(INCIDENT_CATEGORIES as readonly string[]).includes(values.category)) errors.category = 'Kategori tidak valid.';
  if (!(INCIDENT_PRIORITIES as readonly string[]).includes(values.priority)) errors.priority = 'Prioritas tidak valid.';
  if (title.length < 5 || title.length > 200) errors.title = 'Judul wajib 5–200 karakter.';
  if (description.length < 10 || description.length > 4000) errors.description = 'Deskripsi wajib 10–4.000 karakter.';

  const occurredAtDate = new Date(values.occurredAt);
  if (values.occurredAt.trim() === '' || Number.isNaN(occurredAtDate.getTime())) {
    errors.occurredAt = 'Waktu kejadian tidak valid.';
  } else if (occurredAtDate.getTime() > Date.now() + 5 * 60_000) {
    errors.occurredAt = 'Waktu kejadian tidak boleh lebih dari lima menit di masa depan.';
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(submissionId)) {
    errors.request = 'Correlation ID pembuatan tiket tidak valid. Tutup dialog lalu coba lagi.';
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return {
    ok: true,
    value: {
      submissionId,
      laboratoryId,
      deviceId: deviceId === '' ? null : deviceId,
      category: values.category,
      priority: values.priority,
      title,
      description,
      impact,
      blocksLaboratoryOperation: values.blocksLaboratoryOperation,
      stepsTaken,
      occurredAt: occurredAtDate.toISOString(),
    },
  };
}

function firstValidationErrors(error: ApiClientError): IncidentFormErrors {
  const result: IncidentFormErrors = {};
  const allowed = new Set<IncidentFormField>([
    'laboratoryId', 'deviceId', 'category', 'priority', 'title', 'description', 'impact',
    'blocksLaboratoryOperation', 'stepsTaken', 'occurredAt', 'request',
  ]);
  for (const [field, messages] of Object.entries(error.errors ?? {})) {
    if (messages.length > 0 && allowed.has(field as IncidentFormField)) result[field as IncidentFormField] = messages[0];
  }
  return result;
}

/**
 * Creation is ambiguous only when the POST may have reached the server but the client
 * cannot prove whether the committed Incident response was received. These failures
 * must be resolved through E4 recovery before any new POST is allowed.
 */
export function incidentCreateOutcomeIsAmbiguous(error: unknown): boolean {
  if (error instanceof IncidentContractError) return true;
  if (!(error instanceof ApiClientError)) return false;
  return error.kind === 'network'
    || error.kind === 'invalid_response'
    || (error.status !== undefined && error.status >= 500);
}

export function incidentPresentationIssue(error: unknown): IncidentPresentationIssue {
  const fallback: IncidentPresentationIssue = {
    message: 'Data tiket kerusakan tidak dapat diproses. Silakan coba lagi.',
    retryable: true,
    authBoundary: false,
    notFound: false,
    versionConflict: false,
    preconditionFailure: false,
    assigneeIneligible: false,
    fieldErrors: {},
  };
  if (error instanceof IncidentContractError) {
    return { ...fallback, message: 'Respons Incident dari server tidak sesuai kontrak yang diharapkan.' };
  }
  if (!(error instanceof ApiClientError)) return fallback;
  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return { ...fallback, message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.', retryable: false };
  }
  if (error.status === 404 || error.code === 'INCIDENT_NOT_FOUND') {
    return { ...fallback, message: 'Tiket tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.code === 'ACTIVE_MEMBERSHIP_REQUIRED' || error.code === 'SCHOOL_CONTEXT_REQUIRED') {
    return { ...fallback, message: 'Konteks sekolah aktif tidak tersedia. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 412 || error.code === 'INCIDENT_VERSION_CONFLICT') {
    return {
      ...fallback,
      message: 'Tiket telah berubah di server. Muat data terbaru sebelum melanjutkan.',
      retryable: false,
      versionConflict: true,
    };
  }
  if (error.status === 428 || error.code === 'PRECONDITION_REQUIRED') {
    return {
      ...fallback,
      message: 'Versi tiket tidak terkirim dengan benar. Muat ulang data sebelum mencoba lagi.',
      retryable: false,
      preconditionFailure: true,
    };
  }
  if (error.code === 'INCIDENT_ASSIGNEE_INELIGIBLE') {
    return {
      ...fallback,
      message: 'Teknisi aktif pada tiket ini tidak lagi memenuhi syarat. Lakukan penugasan ulang terlebih dahulu.',
      retryable: false,
      assigneeIneligible: true,
    };
  }
  if (error.code === 'INCIDENT_INVALID_TRANSITION' || error.code === 'INCIDENT_STATUS_CONFLICT') {
    return { ...fallback, message: 'Aksi tidak tersedia pada status tiket saat ini. Muat data terbaru.', retryable: false };
  }
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    return {
      ...fallback,
      message: 'Periksa kembali data tiket yang dimasukkan.',
      retryable: false,
      fieldErrors: firstValidationErrors(error),
    };
  }
  if (error.kind === 'configuration') return { ...fallback, message: 'Konfigurasi API Incident tidak valid.', retryable: false };
  if (error.kind === 'network') return { ...fallback, message: 'Layanan Incident tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' };
  if (error.status !== undefined && error.status >= 500) return { ...fallback, message: 'Server Incident sedang bermasalah. Silakan coba lagi.' };
  if (error.kind === 'invalid_response') return { ...fallback, message: 'Server mengembalikan respons Incident yang tidak valid.' };
  return fallback;
}

export function isTerminalIncidentStatus(status: IncidentStatus): boolean {
  return status === 'closed' || status === 'rejected';
}

export { INCIDENT_CATEGORIES, INCIDENT_PRIORITIES, INCIDENT_STATUSES };
