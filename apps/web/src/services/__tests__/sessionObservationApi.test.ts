import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  createSessionObservationGateway,
  parseSessionIssueObservation,
  SessionObservationContractError,
} from '@/services/sessionObservationApi';

const ids = {
  observation: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
  session: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
  device: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  incident: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
};

const observation = {
  id: ids.observation,
  sessionId: ids.session,
  subjectType: 'device' as const,
  referenceId: ids.device,
  referenceCode: 'PC-RPL1-12',
  summary: 'PC mati mendadak.',
  severity: 'high' as const,
  observedAt: '2026-09-14T00:30:00.000Z',
  observedBy: { userId: ids.session, membershipId: ids.device, name: 'Guru A' },
  incident: null,
  incidentLinkedAt: null,
  version: 1,
  createdAt: '2026-09-14T00:30:00.000Z',
};

function client(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn() as ApiClient['get'],
    post: vi.fn() as ApiClient['post'],
    put: vi.fn() as ApiClient['put'],
    patch: vi.fn() as ApiClient['patch'],
    delete: vi.fn() as ApiClient['delete'],
    ...overrides,
  };
}

describe('session observation API contract', () => {
  it('parses canonical observation and rejects non-device fabricated references', () => {
    expect(parseSessionIssueObservation(observation)).toEqual(observation);
    expect(() => parseSessionIssueObservation({ ...observation, subjectType: 'facility', referenceId: ids.device }))
      .toThrow(SessionObservationContractError);
  });

  it('uses explicit create and promote endpoints', async () => {
    const get = vi.fn(async () => ({ data: [observation] })) as ApiClient['get'];
    const post = vi.fn(async (path: string) => path.includes('promote-incident')
      ? { data: { ...observation, incident: { id: ids.incident, ticketNumber: 'INC-2026-0001', status: 'reported' }, incidentLinkedAt: '2026-09-14T00:31:00.000Z', version: 2 } }
      : { data: observation }) as ApiClient['post'];
    const gateway = createSessionObservationGateway(client({ get, post }));

    await gateway.list(ids.session);
    await gateway.create(ids.session, {
      subjectType: 'device',
      referenceId: ids.device,
      summary: 'PC mati',
      severity: 'high',
      observedAt: '2026-09-14T00:30:00.000Z',
    });
    const promoted = await gateway.promote(ids.observation, {
      category: 'hardware',
      priority: 'high',
      title: 'PC mati',
      description: 'Perlu pemeriksaan teknisi.',
      blocksLaboratoryOperation: false,
    });

    expect(promoted.incident?.id).toBe(ids.incident);
    expect(get).toHaveBeenCalledWith(`/laboratory-sessions/${ids.session}/observations`);
    expect(post).toHaveBeenCalledWith(
      `/session-observations/${ids.observation}/promote-incident`,
      expect.objectContaining({ category: 'hardware', priority: 'high', title: 'PC mati' }),
    );
  });
});
