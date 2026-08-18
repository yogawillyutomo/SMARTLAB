import { describe, expect, it } from 'vitest';
import { validateLaboratoryLayout } from '../index';
import { element, layout, validLayout } from './fixtures';

function codes(input: ReturnType<typeof validateLaboratoryLayout>): string[] {
  return input.issues.map((issue) => issue.code);
}

describe('validateLaboratoryLayout', () => {
  it('accepts a valid complete 2x2 grid', () => expect(validateLaboratoryLayout(validLayout()).valid).toBe(true));

  it('rejects duplicate element IDs', () => {
    const input = validLayout();
    input.elements[1].id = input.elements[0].id;
    expect(codes(validateLaboratoryLayout(input))).toContain('duplicate-element-id');
  });

  it('rejects duplicate non-empty reference IDs', () => {
    const input = validLayout();
    input.elements[1].referenceId = input.elements[0].referenceId;
    expect(codes(validateLaboratoryLayout(input))).toContain('duplicate-reference-id');
  });

  it('rejects an out-of-bounds element', () => {
    const input = validLayout();
    input.elements[0].row = 3;
    expect(codes(validateLaboratoryLayout(input))).toContain('element-out-of-bounds');
  });

  it('rejects overlapping footprints', () => {
    const input = validLayout();
    input.elements[1].column = 1;
    expect(codes(validateLaboratoryLayout(input))).toContain('duplicate-cell-occupancy');
  });

  it('rejects uncovered cells', () => {
    const input = validLayout();
    input.elements.pop();
    expect(codes(validateLaboratoryLayout(input))).toContain('incomplete-grid');
  });

  it('rejects an empty element with a reference ID', () => {
    const input = validLayout();
    input.elements[2].referenceId = 'device-empty';
    expect(codes(validateLaboratoryLayout(input))).toContain('empty-element-has-reference');
  });

  it('rejects a student PC without a reference ID', () => {
    const input = validLayout();
    input.elements[0].referenceId = undefined;
    expect(codes(validateLaboratoryLayout(input))).toContain('missing-device-reference');
  });

  it('rejects a teacher PC without a reference ID', () => {
    const input = layout([
      element('teacher', 'teacher_pc', 1, 1, { referenceId: undefined }),
      element('empty-1-2', 'empty', 1, 2), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2),
    ]);
    expect(codes(validateLaboratoryLayout(input))).toContain('missing-device-reference');
  });

  it('rejects a fixed element marked movable', () => {
    const input = validLayout();
    input.elements[2].fixed = true;
    input.elements[2].movable = true;
    expect(codes(validateLaboratoryLayout(input))).toContain('fixed-element-movable');
  });

  it('rejects an archived active layout', () => {
    expect(codes(validateLaboratoryLayout(validLayout() && { ...validLayout(), status: 'archived', isActive: true }))).toContain('archived-layout-active');
  });

  it('rejects active status with isActive false', () => {
    expect(codes(validateLaboratoryLayout({ ...validLayout(), status: 'active', isActive: false }))).toContain('active-layout-inactive');
  });

  it('rejects a draft layout marked active', () => {
    expect(codes(validateLaboratoryLayout({ ...validLayout(), status: 'draft', isActive: true }))).toContain('draft-layout-active');
  });

  it('accepts an intentional spanning element', () => {
    const input = layout([
      element('wall', 'wall', 1, 1, { rowSpan: 1, columnSpan: 2, movable: false, fixed: true }),
      element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2),
    ]);
    expect(validateLaboratoryLayout(input).valid).toBe(true);
  });

  it.each(['teacher_desk', 'door', 'window', 'wall', 'aisle', 'label'] as const)('accepts supported multi-cell %s geometry', (type) => {
    const input = layout([
      element('source', type, 1, 1, { rowSpan: 1, columnSpan: 2 }),
      element('empty-2-1', 'empty', 2, 1),
      element('empty-2-2', 'empty', 2, 2),
    ], { layoutType: 'custom' });
    expect(validateLaboratoryLayout(input).valid).toBe(true);
  });

  it.each(['student_pc', 'teacher_pc', 'printer', 'network_switch', 'access_point', 'empty', 'projector'] as const)('rejects persisted multi-cell %s geometry', (type) => {
    const input = layout([
      element('source', type, 1, 1, { rowSpan: 1, columnSpan: 2, ...(type === 'empty' ? { movable: false } : {}) }),
      element('empty-2-1', 'empty', 2, 1),
      element('empty-2-2', 'empty', 2, 2),
    ], { layoutType: 'custom' });
    expect(codes(validateLaboratoryLayout(input))).toContain('unsupported-element-span');
  });

  it('rejects an empty element overlapping a spanning element', () => {
    const input = layout([
      element('wall', 'wall', 1, 1, { rowSpan: 1, columnSpan: 2, movable: false, fixed: true }),
      element('empty-1-1', 'empty', 1, 1), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2),
    ]);
    expect(codes(validateLaboratoryLayout(input))).toContain('duplicate-cell-occupancy');
  });

  it('rejects an invalid rotation', () => {
    const input = validLayout();
    input.elements[0].rotation = 45 as never;
    expect(codes(validateLaboratoryLayout(input))).toContain('invalid-rotation');
  });

  it('rejects a foreign layout element', () => {
    const input = validLayout();
    input.elements[0].layoutId = 'other-layout';
    expect(codes(validateLaboratoryLayout(input))).toContain('layout-id-mismatch');
  });
});
