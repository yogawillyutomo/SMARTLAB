import { apiClient, type ApiClient } from '@/lib/apiClient';

export const IDENTITY_ROLE_KEYS = [
  'super-admin',
  'admin-lab',
  'kepala-lab',
  'teknisi',
  'guru',
  'ketua-kelas',
  'siswa',
  'pimpinan',
] as const;

export const IDENTITY_STATUSES = ['active', 'inactive'] as const;

export type IdentityRoleKey = (typeof IDENTITY_ROLE_KEYS)[number];
export type IdentityStatus = (typeof IDENTITY_STATUSES)[number];

export interface IdentityRoleSummary {
  key: IdentityRoleKey;
  name: string;
}

export interface IdentityUserDto {
  id: string;
  name: string;
  email: string;
  nip: string | null;
  nis: string | null;
  phone: string | null;
  status: IdentityStatus;
  lastLoginAt: string | null;
}

export interface IdentityMembershipDto {
  id: string;
  status: IdentityStatus;
  user: IdentityUserDto;
  roles: IdentityRoleSummary[];
  createdAt: string;
  updatedAt: string;
}

export interface IdentityMembershipPage {
  data: IdentityMembershipDto[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    lastPage: number;
  };
}

export interface IdentityRoleDto {
  key: IdentityRoleKey;
  name: string;
  permissions: string[];
  membershipCount: number;
  activeMembershipCount: number;
}

export interface IdentityMembershipFilters {
  search?: string;
  status?: IdentityStatus;
  roleKey?: IdentityRoleKey;
  page?: number;
  perPage?: number;
}

export interface CreateIdentityMembershipInput {
  name: string;
  email: string;
  password: string;
  nip?: string | null;
  nis?: string | null;
  phone?: string | null;
  roleKeys: IdentityRoleKey[];
}

export interface UpdateIdentityMembershipInput {
  name?: string;
  email?: string;
  nip?: string | null;
  nis?: string | null;
  phone?: string | null;
  userStatus?: IdentityStatus;
  membershipStatus?: IdentityStatus;
  roleKeys?: IdentityRoleKey[];
}

export interface IdentityAdminGateway {
  listMemberships: (filters?: IdentityMembershipFilters) => Promise<IdentityMembershipPage>;
  showMembership: (membershipId: string) => Promise<IdentityMembershipDto>;
  createMembership: (input: CreateIdentityMembershipInput) => Promise<IdentityMembershipDto>;
  updateMembership: (membershipId: string, input: UpdateIdentityMembershipInput) => Promise<IdentityMembershipDto>;
  listRoles: () => Promise<IdentityRoleDto[]>;
}

export class IdentityAdminContractError extends Error {
  constructor(message = 'Respons administrasi identitas tidak sesuai kontrak API.') {
    super(message);
    this.name = 'IdentityAdminContractError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(record).sort();
  const required = [...expected].sort();
  if (actual.length !== required.length || actual.some((key, index) => key !== required[index])) {
    throw new IdentityAdminContractError();
  }
}

function requiredString(record: Record<string, unknown>, field: string): string {
  const value = record[field];
  if (typeof value !== 'string' || value.trim() === '') throw new IdentityAdminContractError();
  return value;
}

function nullableString(record: Record<string, unknown>, field: string): string | null {
  const value = record[field];
  if (value === null) return null;
  if (typeof value !== 'string') throw new IdentityAdminContractError();
  return value;
}

function dateTime(value: unknown): string {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new IdentityAdminContractError();
  return value;
}

function nullableDateTime(value: unknown): string | null {
  if (value === null) return null;
  return dateTime(value);
}

function identityStatus(value: unknown): IdentityStatus {
  if (typeof value !== 'string' || !(IDENTITY_STATUSES as readonly string[]).includes(value)) {
    throw new IdentityAdminContractError();
  }
  return value as IdentityStatus;
}

function roleKey(value: unknown): IdentityRoleKey {
  if (typeof value !== 'string' || !(IDENTITY_ROLE_KEYS as readonly string[]).includes(value)) {
    throw new IdentityAdminContractError();
  }
  return value as IdentityRoleKey;
}

function nonNegativeInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new IdentityAdminContractError();
  return value as number;
}

function positiveInteger(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new IdentityAdminContractError();
  return value as number;
}

function parseRoleSummary(value: unknown): IdentityRoleSummary {
  if (!isRecord(value)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['key', 'name']);
  return {
    key: roleKey(value.key),
    name: requiredString(value, 'name'),
  };
}

export function parseIdentityMembership(value: unknown): IdentityMembershipDto {
  if (!isRecord(value)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['id', 'status', 'user', 'roles', 'createdAt', 'updatedAt']);
  if (!isRecord(value.user) || !Array.isArray(value.roles)) throw new IdentityAdminContractError();
  assertExactKeys(value.user, ['id', 'name', 'email', 'nip', 'nis', 'phone', 'status', 'lastLoginAt']);

  const roles = value.roles.map(parseRoleSummary);
  const uniqueKeys = new Set(roles.map((role) => role.key));
  if (uniqueKeys.size !== roles.length) throw new IdentityAdminContractError();

  return {
    id: requiredString(value, 'id'),
    status: identityStatus(value.status),
    user: {
      id: requiredString(value.user, 'id'),
      name: requiredString(value.user, 'name'),
      email: requiredString(value.user, 'email'),
      nip: nullableString(value.user, 'nip'),
      nis: nullableString(value.user, 'nis'),
      phone: nullableString(value.user, 'phone'),
      status: identityStatus(value.user.status),
      lastLoginAt: nullableDateTime(value.user.lastLoginAt),
    },
    roles,
    createdAt: dateTime(value.createdAt),
    updatedAt: dateTime(value.updatedAt),
  };
}

function parseMeta(value: unknown): IdentityMembershipPage['meta'] {
  if (!isRecord(value)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['page', 'perPage', 'total', 'lastPage']);
  return {
    page: positiveInteger(value.page),
    perPage: positiveInteger(value.perPage),
    total: nonNegativeInteger(value.total),
    lastPage: positiveInteger(value.lastPage),
  };
}

export function parseIdentityMembershipResponse(value: unknown): IdentityMembershipDto {
  if (!isRecord(value)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['data']);
  return parseIdentityMembership(value.data);
}

export function parseIdentityMembershipPage(value: unknown): IdentityMembershipPage {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['data', 'meta']);
  return {
    data: value.data.map(parseIdentityMembership),
    meta: parseMeta(value.meta),
  };
}

export function parseIdentityRole(value: unknown): IdentityRoleDto {
  if (!isRecord(value) || !Array.isArray(value.permissions)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['key', 'name', 'permissions', 'membershipCount', 'activeMembershipCount']);
  if (!value.permissions.every((permission) => typeof permission === 'string' && permission.trim() !== '')) {
    throw new IdentityAdminContractError();
  }
  const permissions = [...value.permissions] as string[];
  if (new Set(permissions).size !== permissions.length || [...permissions].sort().some((key, index) => key !== permissions[index])) {
    throw new IdentityAdminContractError();
  }
  return {
    key: roleKey(value.key),
    name: requiredString(value, 'name'),
    permissions,
    membershipCount: nonNegativeInteger(value.membershipCount),
    activeMembershipCount: nonNegativeInteger(value.activeMembershipCount),
  };
}

export function parseIdentityRoleCollection(value: unknown): IdentityRoleDto[] {
  if (!isRecord(value) || !Array.isArray(value.data)) throw new IdentityAdminContractError();
  assertExactKeys(value, ['data']);
  return value.data.map(parseIdentityRole);
}

function appendQuery(path: string, filters: IdentityMembershipFilters): string {
  const query = new URLSearchParams();
  if (filters.search?.trim()) query.set('search', filters.search.trim());
  if (filters.status) query.set('status', filters.status);
  if (filters.roleKey) query.set('roleKey', filters.roleKey);
  if (filters.page !== undefined) query.set('page', String(filters.page));
  if (filters.perPage !== undefined) query.set('perPage', String(filters.perPage));
  const suffix = query.toString();
  return suffix ? `${path}?${suffix}` : path;
}

function membershipPath(membershipId: string): string {
  const normalized = membershipId.trim();
  if (!normalized) throw new IdentityAdminContractError('ID membership tidak valid.');
  return `/identity/memberships/${encodeURIComponent(normalized)}`;
}

export function createIdentityAdminGateway(client: ApiClient): IdentityAdminGateway {
  return {
    async listMemberships(filters = {}) {
      return parseIdentityMembershipPage(await client.get<unknown>(appendQuery('/identity/memberships', filters)));
    },
    async showMembership(membershipId) {
      return parseIdentityMembershipResponse(await client.get<unknown>(membershipPath(membershipId)));
    },
    async createMembership(input) {
      return parseIdentityMembershipResponse(await client.post<unknown>('/identity/memberships', input));
    },
    async updateMembership(membershipId, input) {
      if (Object.keys(input).length === 0) throw new IdentityAdminContractError('Tidak ada perubahan pengguna yang dikirim.');
      return parseIdentityMembershipResponse(await client.patch<unknown>(membershipPath(membershipId), input));
    },
    async listRoles() {
      return parseIdentityRoleCollection(await client.get<unknown>('/identity/roles'));
    },
  };
}

export const identityAdminGateway = createIdentityAdminGateway(apiClient);
