import { apiClient, type ApiClient } from '@/lib/apiClient';

export interface CurrentUserPayload {
  id: string;
  name: string;
  email: string;
  school: {
    id: string;
    code: string;
    name: string;
  };
  membership: {
    id: string;
    status: 'active';
    roles: string[];
  };
  permissions: string[];
}

export interface AuthGateway {
  getCurrentUser: () => Promise<CurrentUserPayload>;
  login: (email: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function parseCurrentUserResponse(value: unknown): CurrentUserPayload {
  if (!isRecord(value) || !isRecord(value.data)) throw new Error('Current-user response is missing data.');
  const data = value.data;
  const school = data.school;
  const membership = data.membership;

  if (
    typeof data.id !== 'string'
    || typeof data.name !== 'string'
    || typeof data.email !== 'string'
    || !isRecord(school)
    || typeof school.id !== 'string'
    || typeof school.code !== 'string'
    || typeof school.name !== 'string'
    || !isRecord(membership)
    || typeof membership.id !== 'string'
    || membership.status !== 'active'
    || !isStringArray(membership.roles)
    || !isStringArray(data.permissions)
  ) {
    throw new Error('Current-user response does not match the API contract.');
  }

  return {
    id: data.id,
    name: data.name,
    email: data.email,
    school: { id: school.id, code: school.code, name: school.name },
    membership: { id: membership.id, status: 'active', roles: [...membership.roles] },
    permissions: [...data.permissions],
  };
}

export function createAuthGateway(client: ApiClient): AuthGateway {
  return {
    async getCurrentUser() {
      return parseCurrentUserResponse(await client.get<unknown>('/me'));
    },
    async login(email, password, remember) {
      await client.ensureCsrfCookie();
      await client.post('/auth/login', { email, password, remember });
    },
    async logout() {
      await client.post('/auth/logout');
    },
  };
}

export const authGateway = createAuthGateway(apiClient);
