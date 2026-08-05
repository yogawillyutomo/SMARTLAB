import type { LaboratoryLayout, LayoutElement } from '@/types';
import type { LaboratoryDependencySource, LegacyLayoutMigrationInput } from '../index';

export const UPDATED_AT = '2026-08-05T10:00:00.000Z';

export function element(
  id: string,
  type: LayoutElement['type'],
  row: number,
  column: number,
  overrides: Partial<LayoutElement> = {},
): LayoutElement {
  const referenceId = type === 'student_pc' || type === 'teacher_pc' ? `device-${id}` : undefined;
  return {
    id,
    layoutId: 'layout-1',
    type,
    referenceId,
    row,
    column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: type !== 'empty',
    swappable: type === 'student_pc',
    fixed: false,
    ...overrides,
  };
}

export function layout(elements: LayoutElement[], overrides: Partial<LaboratoryLayout> = {}): LaboratoryLayout {
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
    createdAt: '2026-08-05T09:00:00.000Z',
    updatedAt: '2026-08-05T09:00:00.000Z',
    ...overrides,
  };
}

export function validLayout(): LaboratoryLayout {
  return layout([
    element('pc-1', 'student_pc', 1, 1),
    element('pc-2', 'student_pc', 1, 2),
    element('empty-2-1', 'empty', 2, 1, { movable: false, swappable: false }),
    element('empty-2-2', 'empty', 2, 2, { movable: false, swappable: false }),
  ]);
}

export function migrationInput(overrides: Partial<LegacyLayoutMigrationInput> = {}): LegacyLayoutMigrationInput {
  return {
    layoutId: 'layout-legacy',
    laboratory: { id: 'lab-1', layoutRows: 2, layoutCols: 2 },
    devices: [
      { id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-01', row: 1, col: 1 },
      { id: 'dev-2', laboratoryId: 'lab-1', positionCode: 'PC-02', row: 2, col: 2 },
    ],
    name: 'Migrasi Lab 1',
    createdAt: '2026-08-05T09:00:00.000Z',
    ...overrides,
  };
}

export function emptyDependencies(): LaboratoryDependencySource {
  return {
    devices: [], assets: [], schedules: [], bookings: [], sessions: [], journals: [], incidents: [], workOrders: [],
    maintenance: { plans: [], executions: [] },
  };
}
