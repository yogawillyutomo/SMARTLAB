import { describe, expect, it, vi } from 'vitest';
import type { ApiClient } from '@/lib/apiClient';
import {
  LayoutContractError,
  buildCreateLayoutDraftPayload,
  buildLayoutListPath,
  buildReplaceLayoutPayload,
  buildUnplacedDevicesPath,
  createLayoutGateway,
  laboratoryLayoutsPath,
  layoutIfMatch,
  layoutPath,
  parseLayoutCollectionResponse,
  parseLayoutResponse,
  parseUnplacedDeviceCollectionResponse,
  type LayoutDto,
  type LayoutStatus,
  type ReplaceLayoutInput,
  type UnplacedDeviceCandidateDto,
} from '@/services/layoutApi';

const ulid = (suffix: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`;
const NOW = '2026-08-23T10:00:00.000Z';
const LATER = '2026-08-23T11:00:00.000Z';

function layout(overrides: Partial<LayoutDto> = {}): LayoutDto {
  const status: LayoutStatus = overrides.status ?? 'draft';
  return {
    id: ulid('V'),
    schoolId: ulid('W'),
    laboratoryId: ulid('X'),
    name: 'Layout Utama',
    templateKey: null,
    rows: 8,
    columns: 8,
    status,
    version: 1,
    structuralElements: [],
    devicePlacements: [],
    activatedAt: status === 'draft' ? null : NOW,
    archivedAt: status === 'archived' ? LATER : null,
    createdAt: NOW,
    updatedAt: LATER,
    ...overrides,
  };
}

const candidate: UnplacedDeviceCandidateDto = {
  id: ulid('Y'),
  deviceCode: 'DEV-0001',
  deviceType: 'desktop_pc',
  lifecycleStatus: 'in_service',
  hostname: 'PC-01',
  brand: null,
  model: null,
};

function pageMeta() {
  return { page: 1, perPage: 25, total: 1, lastPage: 1 };
}

function clientWith(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    ensureCsrfCookie: vi.fn(async () => undefined),
    get: vi.fn(async () => ({ data: layout() })) as ApiClient['get'],
    post: vi.fn(async () => ({ data: layout() })) as ApiClient['post'],
    put: vi.fn(async () => ({ data: layout() })) as ApiClient['put'],
    patch: vi.fn(async () => ({ data: layout() })) as ApiClient['patch'],
    delete: vi.fn(async () => undefined) as ApiClient['delete'],
    ...overrides,
  };
}

describe('Layout strict response parsing', () => {
  it.each(['draft', 'active', 'archived'] as const)('accepts a canonical sparse %s Layout', (status) => {
    expect(parseLayoutResponse({ data: layout({ status }) })).toEqual(layout({ status }));
  });

  it('accepts all structural types, placement roles, and rotations on one shared valid plane', () => {
    const structuralTypes = ['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'] as const;
    const structuralElements = structuralTypes.map((type, index) => ({
      id: ulid(['A', 'B', 'C', 'D', 'E', 'F'][index]),
      type,
      label: type === 'label' ? 'Area A' : null,
      row: 1,
      column: index + 1,
      rowSpan: 1,
      columnSpan: 1,
      rotation: [0, 90, 180, 270, 0, 90][index] as 0 | 90 | 180 | 270,
    }));
    const devicePlacements = (['student_station', 'teacher_station', null] as const).map((role, index) => ({
      id: ulid(['G', 'H', 'J'][index]),
      deviceId: ulid(['K', 'M', 'N'][index]),
      role,
      label: null,
      row: 2,
      column: index + 1,
      rowSpan: 1,
      columnSpan: 1,
      rotation: [180, 270, 0][index] as 0 | 90 | 180 | 270,
    }));

    const parsed = parseLayoutResponse({ data: layout({ structuralElements, devicePlacements }) });
    expect(parsed.structuralElements.map((element) => element.type)).toEqual(structuralTypes);
    expect(parsed.devicePlacements.map((placement) => placement.role)).toEqual(['student_station', 'teacher_station', null]);
  });

  it.each([
    ['unknown root field', () => ({ data: { ...layout(), futureField: true } })],
    ['missing root field', () => {
      const incomplete: Partial<LayoutDto> = { ...layout() };
      delete incomplete.version;
      return { data: incomplete };
    }],
    ['invalid status', () => ({ data: { ...layout(), status: 'published' } })],
    ['invalid nullable field', () => ({ data: { ...layout(), templateKey: 42 } })],
    ['malformed ULID', () => ({ data: { ...layout(), id: 'layout-1' } })],
    ['invalid version', () => ({ data: { ...layout(), version: 0 } })],
    ['invalid dimensions', () => ({ data: { ...layout(), rows: 51 } })],
    ['invalid timestamp', () => ({ data: { ...layout(), updatedAt: 'yesterday' } })],
    ['invalid lifecycle timestamps', () => ({ data: { ...layout({ status: 'active' }), activatedAt: null } })],
    ['unknown child field', () => ({
      data: layout({ structuralElements: [{
        id: ulid('A'), type: 'wall', label: null, row: 1, column: 1,
        rowSpan: 1, columnSpan: 1, rotation: 0, fixed: true,
      } as never] }),
    })],
    ['invalid child enum', () => ({
      data: layout({ structuralElements: [{
        id: ulid('A'), type: 'empty', label: null, row: 1, column: 1,
        rowSpan: 1, columnSpan: 1, rotation: 0,
      } as never] }),
    })],
    ['invalid child rotation', () => ({
      data: layout({ structuralElements: [{
        id: ulid('A'), type: 'wall', label: null, row: 1, column: 1,
        rowSpan: 1, columnSpan: 1, rotation: 45 as never,
      }] }),
    })],
    ['structurally invalid child collection', () => ({
      data: { ...layout(), structuralElements: {} },
    })],
    ['invalid child geometry', () => ({
      data: layout({ structuralElements: [{
        id: ulid('A'), type: 'wall', label: null, row: 8, column: 8,
        rowSpan: 2, columnSpan: 1, rotation: 0,
      }] }),
    })],
    ['shared-plane collision', () => ({
      data: layout({
        structuralElements: [{ id: ulid('A'), type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 }],
        devicePlacements: [{ id: ulid('B'), deviceId: ulid('C'), role: null, label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 }],
      }),
    })],
  ])('fails closed for %s', (_name, response) => {
    expect(() => parseLayoutResponse(response())).toThrow(LayoutContractError);
  });

  it('parses exact summary pagination and rejects malformed or extended metadata', () => {
    const summary = layout();
    const summaryDto: Partial<LayoutDto> = { ...summary };
    delete summaryDto.structuralElements;
    delete summaryDto.devicePlacements;
    expect(parseLayoutCollectionResponse({ data: [summaryDto], meta: pageMeta() })).toEqual({ data: [summaryDto], meta: pageMeta() });
    expect(() => parseLayoutCollectionResponse({ data: [summaryDto], meta: { ...pageMeta(), page: 0 } })).toThrow(LayoutContractError);
    expect(() => parseLayoutCollectionResponse({ data: [summaryDto], meta: { ...pageMeta(), cursor: 'next' } })).toThrow(LayoutContractError);
    expect(() => parseLayoutCollectionResponse({ data: [summaryDto], meta: pageMeta(), links: {} })).toThrow(LayoutContractError);
  });

  it('parses exact unplaced candidates and rejects invalid candidates or unknown fields', () => {
    expect(parseUnplacedDeviceCollectionResponse({ data: [candidate], meta: pageMeta() })).toEqual({ data: [candidate], meta: pageMeta() });
    expect(() => parseUnplacedDeviceCollectionResponse({
      data: [{ ...candidate, lifecycleStatus: 'retired' }], meta: pageMeta(),
    })).toThrow(LayoutContractError);
    expect(() => parseUnplacedDeviceCollectionResponse({
      data: [{ ...candidate, qrPublicId: 'forbidden' }], meta: pageMeta(),
    })).toThrow(LayoutContractError);
  });
});

describe('Layout paths, payloads, and If-Match', () => {
  it('builds encoded paths and validated list/unplaced filters', () => {
    expect(laboratoryLayoutsPath('lab/id with spaces')).toBe('/laboratories/lab%2Fid%20with%20spaces/layouts');
    expect(layoutPath('layout/id with spaces')).toBe('/layouts/layout%2Fid%20with%20spaces');
    expect(buildLayoutListPath('lab/id', { status: 'active', page: 2, perPage: 50 }))
      .toBe('/laboratories/lab%2Fid/layouts?status=active&page=2&perPage=50');
    expect(buildUnplacedDevicesPath('layout/id', { page: 3, perPage: 10, search: '  PC Lab  ' }))
      .toBe('/layouts/layout%2Fid/unplaced-devices?page=3&perPage=10&search=PC+Lab');
  });

  it.each([
    () => buildLayoutListPath(ulid('X'), { status: 'published' as never }),
    () => buildLayoutListPath(ulid('X'), { page: 0 }),
    () => buildLayoutListPath(ulid('X'), { perPage: 101 }),
    () => buildUnplacedDevicesPath(ulid('V'), { search: '   ' }),
    () => buildUnplacedDevicesPath(ulid('V'), { search: 'x'.repeat(101) }),
  ])('rejects invalid client filters before a request can be sent', (build) => {
    expect(build).toThrow(LayoutContractError);
  });

  it('keeps empty and active-clone create modes disjoint', () => {
    expect(buildCreateLayoutDraftPayload({ mode: 'empty', name: 'Layout Baru', rows: 6, columns: 7 }))
      .toEqual({ name: 'Layout Baru', rows: 6, columns: 7 });
    expect(buildCreateLayoutDraftPayload({ mode: 'empty', name: 'Layout Baru', rows: 6, columns: 7, templateKey: null }))
      .toEqual({ name: 'Layout Baru', rows: 6, columns: 7, templateKey: null });
    expect(buildCreateLayoutDraftPayload({ mode: 'clone' })).toEqual({});
    expect(buildCreateLayoutDraftPayload({ mode: 'clone', name: 'Salinan Aktif' })).toEqual({ name: 'Salinan Aktif' });
  });

  it('builds the exact full PUT allowlist, strips client-only fields, and omits IDs for new children', () => {
    const source = {
      name: 'Draft',
      templateKey: null,
      rows: 4,
      columns: 4,
      structuralElements: [{
        id: ulid('A'), clientKey: 'must-not-leak', type: 'wall' as const, label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 as const,
      }, {
        clientKey: 'new-structure', type: 'label' as const, label: 'A',
        row: 1, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0 as const,
      }],
      devicePlacements: [{
        id: ulid('B'), clientKey: 'must-not-leak', deviceId: ulid('C'), role: 'student_station' as const, label: 'PC-01',
        row: 2, column: 1, rowSpan: 1, columnSpan: 1, rotation: 90 as const,
      }, {
        clientKey: 'new-placement', deviceId: ulid('D'), role: null, label: null,
        row: 2, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0 as const,
      }],
      id: ulid('V'),
      schoolId: ulid('W'),
      laboratoryId: ulid('X'),
      status: 'draft',
      version: 9,
    };

    const payload = buildReplaceLayoutPayload(source);
    expect(Object.keys(payload)).toEqual(['name', 'templateKey', 'rows', 'columns', 'structuralElements', 'devicePlacements']);
    expect(payload.structuralElements[0]).toHaveProperty('id', ulid('A'));
    expect(payload.structuralElements[1]).not.toHaveProperty('id');
    expect(payload.devicePlacements[0]).toHaveProperty('id', ulid('B'));
    expect(payload.devicePlacements[1]).not.toHaveProperty('id');
    expect(JSON.stringify(payload)).not.toContain('clientKey');
    expect(JSON.stringify(payload)).not.toContain('schoolId');
  });

  it('never accepts null as a child id and builds If-Match only from positive integer versions', () => {
    const invalid = {
      name: 'Draft', templateKey: null, rows: 2, columns: 2, structuralElements: [{
        id: null, type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      }], devicePlacements: [],
    } as unknown as ReplaceLayoutInput;
    expect(() => buildReplaceLayoutPayload(invalid)).toThrow(LayoutContractError);
    expect(layoutIfMatch(7)).toBe('"7"');
    [0, -1, 1.5, Number.NaN].forEach((version) => expect(() => layoutIfMatch(version)).toThrow(LayoutContractError));
  });

  it('rejects invalid geometry in full PUT input before transport', () => {
    const invalid: ReplaceLayoutInput = {
      name: 'Draft', templateKey: null, rows: 2, columns: 2,
      structuralElements: [{
        type: 'wall', label: null, row: Number.NaN, column: 1,
        rowSpan: 1, columnSpan: 1, rotation: 0,
      }],
      devicePlacements: [],
    };
    expect(() => buildReplaceLayoutPayload(invalid)).toThrow(LayoutContractError);
  });
});

describe('Layout gateway', () => {
  it('uses all seven exact endpoints, mutation versions, and server-authoritative responses', async () => {
    const canonical = layout();
    const summary = { ...canonical };
    delete (summary as Partial<LayoutDto>).structuralElements;
    delete (summary as Partial<LayoutDto>).devicePlacements;
    const get = vi.fn(async (path: string) => path.includes('unplaced-devices')
      ? { data: [candidate], meta: pageMeta() }
      : path.includes('/laboratories/')
        ? { data: [summary], meta: pageMeta() }
        : { data: canonical });
    const post = vi.fn(async () => ({ data: canonical }));
    const put = vi.fn(async () => ({ data: { ...canonical, version: 1 } }));
    const remove = vi.fn(async () => undefined);
    const gateway = createLayoutGateway(clientWith({
      get: get as ApiClient['get'], post: post as ApiClient['post'], put: put as ApiClient['put'], delete: remove as ApiClient['delete'],
    }));
    const replacement: ReplaceLayoutInput = {
      name: canonical.name,
      templateKey: canonical.templateKey,
      rows: canonical.rows,
      columns: canonical.columns,
      structuralElements: [],
      devicePlacements: [],
    };

    await gateway.list('lab/id', { status: 'draft' });
    await gateway.createDraft('lab/id', { mode: 'clone', name: 'Draft' });
    await gateway.show('layout/id');
    await expect(gateway.replace('layout/id', 4, replacement)).resolves.toMatchObject({ version: 1 });
    await gateway.activate('layout/id', 5);
    await gateway.deleteDraft('layout/id', 6);
    await gateway.unplacedDevices('layout/id', { search: 'PC' });

    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/laboratories/lab%2Fid/layouts?status=draft',
      '/layouts/layout%2Fid',
      '/layouts/layout%2Fid/unplaced-devices?search=PC',
    ]);
    expect(post).toHaveBeenNthCalledWith(1, '/laboratories/lab%2Fid/layouts', { name: 'Draft' });
    expect(post).toHaveBeenNthCalledWith(2, '/layouts/layout%2Fid/activate', undefined, { ifMatch: '"5"' });
    expect(put).toHaveBeenCalledWith('/layouts/layout%2Fid', replacement, { ifMatch: '"4"' });
    expect(remove).toHaveBeenCalledWith('/layouts/layout%2Fid', { ifMatch: '"6"' });
  });

  it('rejects malformed server data instead of merging speculative client state', async () => {
    const gateway = createLayoutGateway(clientWith({
      put: vi.fn(async () => ({ data: { ...layout(), version: 2, unexpected: true } })) as ApiClient['put'],
    }));
    const input: ReplaceLayoutInput = {
      name: 'Client Draft', templateKey: null, rows: 8, columns: 8,
      structuralElements: [], devicePlacements: [],
    };
    await expect(gateway.replace(ulid('V'), 1, input)).rejects.toBeInstanceOf(LayoutContractError);
  });
});
