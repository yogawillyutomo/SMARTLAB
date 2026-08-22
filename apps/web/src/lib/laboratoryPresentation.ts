import { ApiClientError } from '@/lib/apiClient';
import { LaboratoryContractError, type CreateLaboratoryInput, type LaboratoryDto, type LaboratoryStatus, type UpdateLaboratoryInput } from '@/services/laboratoryApi';

export interface LaboratoryFormValues {
  code: string;
  name: string;
  location: string;
  capacity: string;
  status: LaboratoryStatus;
}

export type LaboratoryFormField = keyof LaboratoryFormValues | 'request';
export type LaboratoryFormErrors = Partial<Record<LaboratoryFormField, string>>;

export type LaboratoryPresentationIssue = {
  message: string;
  retryable: boolean;
  authBoundary: boolean;
  notFound: boolean;
  fieldErrors: LaboratoryFormErrors;
};

export function emptyLaboratoryForm(): LaboratoryFormValues {
  return { code: '', name: '', location: '', capacity: '36', status: 'active' };
}

export function laboratoryFormFromDto(laboratory: LaboratoryDto): LaboratoryFormValues {
  return {
    code: laboratory.code,
    name: laboratory.name,
    location: laboratory.location,
    capacity: String(laboratory.capacity),
    status: laboratory.status,
  };
}

export function validateLaboratoryForm(values: LaboratoryFormValues):
  | { ok: true; input: CreateLaboratoryInput }
  | { ok: false; errors: LaboratoryFormErrors } {
  const errors: LaboratoryFormErrors = {};
  const code = values.code.trim();
  const name = values.name.trim();
  const location = values.location.trim();
  const capacity = Number(values.capacity);

  if (code === '') errors.code = 'Kode laboratorium wajib diisi.';
  else if (code.length > 50) errors.code = 'Kode laboratorium maksimal 50 karakter.';
  if (name === '') errors.name = 'Nama laboratorium wajib diisi.';
  else if (name.length > 255) errors.name = 'Nama laboratorium maksimal 255 karakter.';
  if (location === '') errors.location = 'Lokasi laboratorium wajib diisi.';
  else if (location.length > 255) errors.location = 'Lokasi laboratorium maksimal 255 karakter.';
  if (!Number.isInteger(capacity) || capacity < 1) errors.capacity = 'Kapasitas harus berupa bilangan bulat minimal 1.';
  if (values.status !== 'active' && values.status !== 'inactive') errors.status = 'Status laboratorium tidak valid.';

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, input: { code, name, location, capacity, status: values.status } };
}

export function changedLaboratoryFields(current: LaboratoryDto, next: CreateLaboratoryInput): UpdateLaboratoryInput {
  const changes: UpdateLaboratoryInput = {};
  if (current.code !== next.code) changes.code = next.code;
  if (current.name !== next.name) changes.name = next.name;
  if (current.location !== next.location) changes.location = next.location;
  if (current.capacity !== next.capacity) changes.capacity = next.capacity;
  if (current.status !== next.status) changes.status = next.status;
  return changes;
}

export function sortLaboratories(laboratories: LaboratoryDto[]): LaboratoryDto[] {
  return [...laboratories].sort((left, right) => left.code.localeCompare(right.code) || left.id.localeCompare(right.id));
}

function firstValidationErrors(error: ApiClientError): LaboratoryFormErrors {
  const allowed = new Set<LaboratoryFormField>(['code', 'name', 'location', 'capacity', 'status', 'request']);
  const entries = Object.entries(error.errors ?? {})
    .filter(([field, messages]) => allowed.has(field as LaboratoryFormField) && messages.length > 0)
    .map(([field, messages]) => [field, messages[0]] as const);
  return Object.fromEntries(entries) as LaboratoryFormErrors;
}

export function laboratoryPresentationIssue(error: unknown): LaboratoryPresentationIssue {
  const fallback: LaboratoryPresentationIssue = {
    message: 'Data laboratorium tidak dapat diproses. Silakan coba lagi.',
    retryable: true,
    authBoundary: false,
    notFound: false,
    fieldErrors: {},
  };

  if (error instanceof LaboratoryContractError) {
    return { ...fallback, message: 'Respons Laboratory dari server tidak sesuai kontrak yang diharapkan.' };
  }
  if (!(error instanceof ApiClientError)) return fallback;

  if (error.status === 401 || error.code === 'UNAUTHENTICATED') {
    return { ...fallback, message: 'Sesi Anda telah berakhir. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 403 || error.code === 'FORBIDDEN') {
    return { ...fallback, message: 'Anda tidak memiliki izin untuk melakukan tindakan ini.', retryable: false };
  }
  if (error.status === 404 || error.code === 'LABORATORY_NOT_FOUND') {
    return { ...fallback, message: 'Laboratorium tidak ditemukan pada konteks sekolah aktif.', retryable: false, notFound: true };
  }
  if (error.code === 'ACTIVE_MEMBERSHIP_REQUIRED' || error.code === 'SCHOOL_CONTEXT_REQUIRED') {
    return { ...fallback, message: 'Konteks sekolah aktif tidak tersedia. Memeriksa ulang sesi...', retryable: false, authBoundary: true };
  }
  if (error.status === 422 || error.code === 'VALIDATION_FAILED') {
    return {
      ...fallback,
      message: 'Periksa kembali data laboratorium yang dimasukkan.',
      retryable: false,
      fieldErrors: firstValidationErrors(error),
    };
  }
  if (error.kind === 'configuration') {
    return { ...fallback, message: 'Konfigurasi API Laboratory tidak valid.', retryable: false };
  }
  if (error.kind === 'network') {
    return { ...fallback, message: 'Layanan Laboratory tidak dapat dijangkau. Periksa koneksi lalu coba lagi.' };
  }
  if (error.status !== undefined && error.status >= 500) {
    return { ...fallback, message: 'Server Laboratory sedang bermasalah. Silakan coba lagi.' };
  }
  if (error.kind === 'invalid_response') {
    return { ...fallback, message: 'Server mengembalikan respons Laboratory yang tidak valid.' };
  }
  return fallback;
}

export class SubmissionGate {
  private active = false;

  begin(): boolean {
    if (this.active) return false;
    this.active = true;
    return true;
  }

  end(): void {
    this.active = false;
  }
}
