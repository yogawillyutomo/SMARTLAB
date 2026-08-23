import { describe, expect, it } from 'vitest';
import {
  addDevicePlacement,
  addStructuralElement,
  indexLayoutDeviceMetadata,
  layoutEditorStateFromServer,
  moveDevicePlacement,
  moveStructuralElement,
  reassignPlacementDevice,
  removeDevicePlacement,
  removeStructuralElement,
  replaceEditorStateWithServer,
  resizeDevicePlacement,
  resizeLayout,
  resizeStructuralElement,
  serializeLayoutEditorState,
  swapDevicePlacements,
  updateDevicePlacement,
  updateLayoutProperties,
  updateStructuralElement,
  validateLayoutEditorState,
  type CanonicalLayoutEditorState,
  type LayoutEditorResult,
} from '@/domain/server-layout';
import type { LayoutDto, UnplacedDeviceCandidateDto } from '@/services/layoutApi';

const ulid = (suffix: string) => `01ARZ3NDEKTSV4RRFFQ69G5FA${suffix}`;
const NOW = '2026-08-23T10:00:00.000Z';

function serverLayout(overrides: Partial<LayoutDto> = {}): LayoutDto {
  return {
    id: ulid('V'),
    schoolId: ulid('W'),
    laboratoryId: ulid('X'),
    name: 'Layout Draft',
    templateKey: null,
    rows: 8,
    columns: 8,
    status: 'draft',
    version: 3,
    structuralElements: [],
    devicePlacements: [],
    activatedAt: null,
    archivedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function state(overrides: Partial<CanonicalLayoutEditorState> = {}): CanonicalLayoutEditorState {
  return { ...layoutEditorStateFromServer(serverLayout()), ...overrides };
}

function candidate(
  suffix: string,
  deviceType: UnplacedDeviceCandidateDto['deviceType'] = 'desktop_pc',
): UnplacedDeviceCandidateDto {
  return {
    id: ulid(suffix),
    deviceCode: `DEV-${suffix}`,
    deviceType,
    lifecycleStatus: 'in_service',
    hostname: null,
    brand: null,
    model: null,
  };
}

function successful(result: LayoutEditorResult): CanonicalLayoutEditorState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.message);
  return result.state;
}

describe('canonical Layout editor state and serialization', () => {
  it('accepts sparse empty and maximum 50x50 grids', () => {
    expect(validateLayoutEditorState(state())).toEqual({ valid: true, issues: [] });
    expect(validateLayoutEditorState(state({ rows: 50, columns: 50 }))).toEqual({ valid: true, issues: [] });
  });

  it('preserves server child IDs, omits IDs for unsaved children, and strips all client-only state', () => {
    const existingStructureId = ulid('A');
    const existingPlacementId = ulid('B');
    const deviceId = ulid('C');
    const editor = state({
      structuralElements: [
        { id: existingStructureId, type: 'wall', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 },
        { clientKey: 'new-label', type: 'label', label: 'Baris A', row: 1, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0 },
      ],
      devicePlacements: [
        { id: existingPlacementId, deviceId, role: null, label: null, row: 2, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 },
        { clientKey: 'new-device', deviceId: ulid('D'), role: null, label: null, row: 2, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0 },
      ],
      serverPlacementDeviceIds: { [existingPlacementId]: deviceId },
    });

    const payload = serializeLayoutEditorState(editor);
    expect(payload.structuralElements[0]).toHaveProperty('id', existingStructureId);
    expect(payload.structuralElements[1]).not.toHaveProperty('id');
    expect(payload.devicePlacements[0]).toHaveProperty('id', existingPlacementId);
    expect(payload.devicePlacements[1]).not.toHaveProperty('id');
    expect(Object.keys(payload)).toEqual(['name', 'templateKey', 'rows', 'columns', 'structuralElements', 'devicePlacements']);
    expect(JSON.stringify(payload)).not.toContain('clientKey');
    expect(JSON.stringify(payload)).not.toContain('serverPlacementDeviceIds');
  });

  it('replaces optimistic editor state with the complete canonical response', () => {
    const optimistic = successful(addStructuralElement(state(), {
      clientKey: 'temporary-wall', type: 'wall', label: null,
      row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
    }));
    const canonical = serverLayout({
      version: 4,
      structuralElements: [{
        id: ulid('A'), type: 'wall', label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      }],
    });

    const replaced = replaceEditorStateWithServer(canonical);
    expect(optimistic.structuralElements[0]).toHaveProperty('clientKey', 'temporary-wall');
    expect(replaced.version).toBe(4);
    expect(replaced.structuralElements[0]).toEqual(canonical.structuralElements[0]);
    expect(replaced.structuralElements[0]).not.toHaveProperty('clientKey');
  });

  it('indexes candidate display metadata separately and never embeds it in placement state or payload', () => {
    const desktop = { ...candidate('D'), hostname: 'PC-01', brand: 'Acme' };
    const metadata = indexLayoutDeviceMetadata([desktop]);
    const next = successful(addDevicePlacement(state(), desktop, {
      clientKey: 'pc-1', role: 'student_station', label: 'Meja 1',
      row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
    }));

    expect(metadata[desktop.id]).toEqual(desktop);
    expect(next.devicePlacements[0]).not.toHaveProperty('hostname');
    expect(next.devicePlacements[0]).not.toHaveProperty('deviceCode');
    expect(JSON.stringify(serializeLayoutEditorState(next))).not.toContain('Acme');
  });
});

describe('immutable structural editing operations', () => {
  it('adds, updates, moves, resizes, and removes a structural element without mutating prior states', () => {
    const original = state();
    const addedResult = addStructuralElement(original, {
      clientKey: 'wall-1', type: 'wall', label: null,
      row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
    });
    const added = successful(addedResult);
    expect(original.structuralElements).toEqual([]);
    expect(addedResult).toMatchObject({ operation: 'added' });

    const updated = successful(updateStructuralElement(added, 'wall-1', { type: 'label', label: 'Area A', rotation: 90 }));
    const moved = successful(moveStructuralElement(updated, 'wall-1', { row: 2, column: 2 }));
    const resized = successful(resizeStructuralElement(moved, 'wall-1', { rowSpan: 2, columnSpan: 2 }));
    const removed = successful(removeStructuralElement(resized, 'wall-1'));

    expect(added.structuralElements[0]).toMatchObject({ type: 'wall', row: 1, column: 1, rowSpan: 1, columnSpan: 1 });
    expect(resized.structuralElements[0]).toMatchObject({ type: 'label', label: 'Area A', rotation: 90, row: 2, column: 2, rowSpan: 2, columnSpan: 2 });
    expect(removed.structuralElements).toEqual([]);
  });

  it('updates root metadata immutably and blocks active Layout editing', () => {
    const original = state();
    const updated = successful(updateLayoutProperties(original, { name: 'Draft Revisi', templateKey: 'computer-lab' }));
    expect(original.name).toBe('Layout Draft');
    expect(updated).toMatchObject({ name: 'Draft Revisi', templateKey: 'computer-lab' });
    expect(updateLayoutProperties(state({ status: 'active', activatedAt: NOW }), { name: 'Forbidden' }))
      .toMatchObject({ ok: false, code: 'not_editable' });
  });
});

describe('immutable Device placement operations and identity', () => {
  it('adds, updates, moves, resizes, swaps, and removes placements without mutating earlier states', () => {
    const original = state();
    const first = successful(addDevicePlacement(original, candidate('D'), {
      clientKey: 'pc-1', role: 'student_station', label: null,
      row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
    }));
    const second = successful(addDevicePlacement(first, candidate('E', 'laptop'), {
      clientKey: 'pc-2', role: 'teacher_station', label: null,
      row: 1, column: 3, rowSpan: 1, columnSpan: 1, rotation: 0,
    }));
    const updated = successful(updateDevicePlacement(second, 'pc-1', { label: 'Siswa 1', rotation: 90 }, 'desktop_pc'));
    const moved = successful(moveDevicePlacement(updated, 'pc-1', { row: 2, column: 1 }));
    const resized = successful(resizeDevicePlacement(moved, 'pc-1', { rowSpan: 1, columnSpan: 2 }));
    const swapped = successful(swapDevicePlacements(resized, 'pc-1', 'pc-2'));
    const removed = successful(removeDevicePlacement(swapped, 'pc-2'));

    expect(original.devicePlacements).toEqual([]);
    expect(first.devicePlacements[0]).toMatchObject({ row: 1, column: 1, label: null });
    expect(resized.devicePlacements[0]).toMatchObject({ row: 2, column: 1, columnSpan: 2, label: 'Siswa 1', rotation: 90 });
    expect(swapped.devicePlacements[0]).toMatchObject({ row: 1, column: 3 });
    expect(swapped.devicePlacements[1]).toMatchObject({ row: 2, column: 1 });
    expect(removed.devicePlacements).toHaveLength(1);
  });

  it('allows station roles only for desktop/laptop and permits null role for other Device types', () => {
    for (const deviceType of ['desktop_pc', 'laptop'] as const) {
      expect(addDevicePlacement(state(), candidate('D', deviceType), {
        clientKey: deviceType, role: 'student_station', label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      })).toMatchObject({ ok: true });
    }
    for (const deviceType of ['printer', 'router'] as const) {
      expect(addDevicePlacement(state(), candidate('D', deviceType), {
        clientKey: deviceType, role: 'teacher_station', label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      })).toMatchObject({ ok: false, code: 'invalid_role' });
      expect(addDevicePlacement(state(), candidate('D', deviceType), {
        clientKey: `${deviceType}-null`, role: null, label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      })).toMatchObject({ ok: true });
    }
  });

  it('rejects duplicate Devices and any same-placement Device reassignment', () => {
    const first = successful(addDevicePlacement(state(), candidate('D'), {
      clientKey: 'pc-1', role: null, label: null,
      row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
    }));
    expect(addDevicePlacement(first, candidate('D'), {
      clientKey: 'pc-2', role: null, label: null,
      row: 1, column: 2, rowSpan: 1, columnSpan: 1, rotation: 0,
    })).toMatchObject({ ok: false, code: 'duplicate_device' });
    expect(reassignPlacementDevice(first, 'pc-1', ulid('E')))
      .toMatchObject({ ok: false, code: 'device_identity_immutable' });
  });

  it('detects direct mutation of an existing placement Device identity before serialization', () => {
    const placementId = ulid('A');
    const originalDeviceId = ulid('D');
    const invalid = state({
      devicePlacements: [{
        id: placementId, deviceId: ulid('E'), role: null, label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      }],
      serverPlacementDeviceIds: { [placementId]: originalDeviceId },
    });
    expect(validateLayoutEditorState(invalid).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'device_identity_immutable', childKey: placementId }),
    ]));
    expect(() => serializeLayoutEditorState(invalid)).toThrow();
  });
});

describe('shared sparse grid safety', () => {
  it('rejects structure-structure, placement-placement, and cross-kind collisions', () => {
    const structure = { clientKey: 'wall-1', type: 'wall' as const, label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 as const };
    const placement = { clientKey: 'pc-1', deviceId: ulid('D'), role: null, label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0 as const };

    expect(validateLayoutEditorState(state({ structuralElements: [structure, { ...structure, clientKey: 'wall-2' }] })).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'collision' })]));
    expect(validateLayoutEditorState(state({ devicePlacements: [placement, { ...placement, clientKey: 'pc-2', deviceId: ulid('E') }] })).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'collision' })]));
    expect(validateLayoutEditorState(state({ structuralElements: [structure], devicePlacements: [placement] })).issues)
      .toEqual(expect.arrayContaining([expect.objectContaining({ code: 'collision' })]));
  });

  it('rejects out-of-bounds moves and Layout resizing that would clip content', () => {
    const occupied = successful(addStructuralElement(state(), {
      clientKey: 'wall-1', type: 'wall', label: null,
      row: 7, column: 7, rowSpan: 2, columnSpan: 2, rotation: 0,
    }));
    expect(moveStructuralElement(occupied, 'wall-1', { row: 8, column: 8 }))
      .toMatchObject({ ok: false, code: 'out_of_bounds' });
    expect(resizeLayout(occupied, { rows: 7, columns: 7 }))
      .toMatchObject({ ok: false, code: 'resize_clips_content' });
    expect(resizeLayout(occupied, { rows: 50, columns: 50 }))
      .toMatchObject({ ok: true, operation: 'resized' });
  });

  it('rejects empty records instead of representing unused cells as children', () => {
    const invalid = state({
      structuralElements: [{
        clientKey: 'empty', type: 'empty' as never, label: null,
        row: 1, column: 1, rowSpan: 1, columnSpan: 1, rotation: 0,
      }],
    });
    expect(validateLayoutEditorState(invalid).issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'invalid_state' }),
    ]));
  });
});
