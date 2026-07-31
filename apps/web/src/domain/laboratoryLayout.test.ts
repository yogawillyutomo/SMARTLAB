import { describe, expect, it } from 'vitest';
import type { LaboratoryLayout, LayoutElement } from '@/types';
import {
  inspectLaboratoryDependencies,
  migrateLegacyDeviceCoordinates,
  moveLayoutElement,
  swapLayoutElements,
  validateLaboratoryLayout,
} from './laboratoryLayout';

function element(id: string, type: LayoutElement['type'], row: number, column: number): LayoutElement {
  return {
    id,
    layoutId: 'layout-1',
    type,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: type !== 'empty',
    swappable: type === 'student_pc',
    fixed: type === 'empty',
  };
}

function completeLayout(elements: LayoutElement[]): LaboratoryLayout {
  return {
    id: 'layout-1',
    laboratoryId: 'lab-1',
    name: 'Denah Lab 1',
    layoutType: 'grid-classic',
    rows: 2,
    columns: 2,
    version: 1,
    status: 'draft',
    isActive: false,
    elements,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

describe('laboratory layout domain', () => {
  it('requires a complete grid and rejects colliding cells', () => {
    const layout = completeLayout([
      element('pc-1', 'student_pc', 1, 1),
      element('pc-2', 'student_pc', 1, 1),
      element('empty-2-1', 'empty', 2, 1),
    ]);

    const result = validateLaboratoryLayout(layout);

    expect(result.valid).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain('duplicate-cell-occupancy');
    expect(result.issues.map((issue) => issue.code)).toContain('incomplete-grid');
  });

  it('moves a student PC immutably into an empty cell', () => {
    const layout = completeLayout([
      element('pc-1', 'student_pc', 1, 1),
      element('empty-1-2', 'empty', 1, 2),
      element('empty-2-1', 'empty', 2, 1),
      element('empty-2-2', 'empty', 2, 2),
    ]);

    const result = moveLayoutElement(layout, 'pc-1', { row: 1, column: 2 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(layout.elements.find((item) => item.id === 'pc-1')?.column).toBe(1);
    expect(result.layout.elements.find((item) => item.id === 'pc-1')?.column).toBe(2);
    expect(result.layout.elements.find((item) => item.id === 'empty-1-2')?.column).toBe(1);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('atomically swaps two student PCs and rejects a non-PC target', () => {
    const layout = completeLayout([
      element('pc-1', 'student_pc', 1, 1),
      element('pc-2', 'student_pc', 1, 2),
      element('desk', 'teacher_desk', 2, 1),
      element('empty-2-2', 'empty', 2, 2),
    ]);

    const swap = swapLayoutElements(layout, 'pc-1', 'pc-2');
    expect(swap.ok).toBe(true);
    if (swap.ok) {
      expect(swap.layout.elements.find((item) => item.id === 'pc-1')?.column).toBe(2);
      expect(swap.layout.elements.find((item) => item.id === 'pc-2')?.column).toBe(1);
    }

    const rejected = moveLayoutElement(layout, 'pc-1', { row: 2, column: 1 });
    expect(rejected).toMatchObject({ ok: false, code: 'incompatible-target' });
  });

  it('migrates valid legacy coordinates without mutating devices or persisting a layout', () => {
    const devices = [
      { id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-01', row: 1, col: 1 },
      { id: 'dev-2', laboratoryId: 'lab-1', positionCode: 'PC-02', row: 2, col: 2 },
      { id: 'dev-other', laboratoryId: 'lab-other', positionCode: 'PC-99', row: 1, col: 1 },
    ];
    const before = JSON.stringify(devices);

    const result = migrateLegacyDeviceCoordinates({
      layoutId: 'layout-legacy',
      laboratory: { id: 'lab-1', layoutRows: 2, layoutCols: 2 },
      devices,
      name: 'Migrasi Lab 1',
      createdAt: '2026-07-31T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.elements.filter((item) => item.type === 'student_pc')).toHaveLength(2);
    expect(result.layout.elements.filter((item) => item.type === 'empty')).toHaveLength(2);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
    expect(JSON.stringify(devices)).toBe(before);
  });

  it('rejects duplicate legacy coordinates before creating a layout', () => {
    const result = migrateLegacyDeviceCoordinates({
      layoutId: 'layout-legacy',
      laboratory: { id: 'lab-1', layoutRows: 2, layoutCols: 2 },
      devices: [
        { id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-01', row: 1, col: 1 },
        { id: 'dev-2', laboratoryId: 'lab-1', positionCode: 'PC-02', row: 1, col: 1 },
      ],
      name: 'Migrasi Lab 1',
      createdAt: '2026-07-31T00:00:00.000Z',
    });

    expect(result).toMatchObject({ ok: false, issues: [{ code: 'duplicate-device-coordinate' }] });
  });

  it('inspects every current laboratory-bound collection without mutation', () => {
    const result = inspectLaboratoryDependencies({
      devices: [{ laboratoryId: 'lab-1' }],
      assets: [{ laboratoryId: 'lab-1' }],
      schedules: [],
      bookings: [{ laboratoryId: 'lab-other' }],
      sessions: [{ laboratoryId: 'lab-1' }],
      journals: [{ laboratoryId: 'lab-1' }],
      incidents: [],
      workOrders: [{ laboratoryId: 'lab-1' }],
      maintenance: { plans: [{ laboratoryId: 'lab-1' }], executions: [] },
    }, 'lab-1');

    expect(result.total).toBe(6);
    expect(result.hasDependencies).toBe(true);
    expect(result.canDelete).toBe(false);
    expect(result.dependencies.map((dependency) => dependency.kind)).toEqual([
      'devices', 'assets', 'sessions', 'journals', 'workOrders', 'maintenancePlans',
    ]);
  });
});
