import { describe, expect, it } from 'vitest';
import { moveLayoutElement, swapLayoutElements, validateLaboratoryLayout } from '../index';
import { UPDATED_AT, element, layout, validLayout } from './fixtures';

const options = { updatedAt: UPDATED_AT };

describe('layout operations', () => {
  it('moves a student PC to empty with an immutable result and reports moved', () => {
    const input = validLayout();
    const result = moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options);
    expect(result).toMatchObject({ ok: true, operation: 'moved', sourceElementId: 'pc-1', targetElementId: 'empty-2-1' });
    if (!result.ok) return;
    expect(input.elements.find((item) => item.id === 'pc-1')?.row).toBe(1);
    expect(result.layout.elements.find((item) => item.id === 'pc-1')?.row).toBe(2);
    expect(result.layout.elements.find((item) => item.id === 'empty-2-1')?.row).toBe(1);
    expect(result.layout.updatedAt).toBe(UPDATED_AT);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('swaps student PCs atomically and keeps reference IDs stable', () => {
    const input = validLayout();
    const before = input.elements.map((item) => [item.id, item.referenceId]);
    const result = moveLayoutElement(input, 'pc-1', { row: 1, column: 2 }, options);
    expect(result).toMatchObject({ ok: true, operation: 'swapped', sourceElementId: 'pc-1', targetElementId: 'pc-2' });
    if (!result.ok) return;
    expect(result.layout.elements.find((item) => item.id === 'pc-1')?.column).toBe(2);
    expect(result.layout.elements.find((item) => item.id === 'pc-2')?.column).toBe(1);
    expect(result.layout.elements.map((item) => [item.id, item.referenceId])).toEqual(before);
  });

  it('rejects a fixed source', () => {
    const input = validLayout();
    input.elements[0] = { ...input.elements[0], fixed: true, movable: false };
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('rejects a non-movable source', () => {
    const input = validLayout();
    input.elements[0] = { ...input.elements[0], movable: false };
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_not_movable' });
  });

  it('rejects an empty source', () => expect(moveLayoutElement(validLayout(), 'empty-2-1', { row: 1, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_is_empty' }));

  it('rejects an empty source dropped onto its own coordinate', () => {
    expect(moveLayoutElement(validLayout(), 'empty-2-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_is_empty' });
  });

  it('rejects a fixed source dropped onto its own coordinate', () => {
    const input = validLayout();
    input.elements[0] = { ...input.elements[0], fixed: true, movable: false };
    expect(moveLayoutElement(input, 'pc-1', { row: 1, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_fixed' });
  });

  it('rejects a non-movable source dropped onto its own coordinate', () => {
    const input = validLayout();
    input.elements[0] = { ...input.elements[0], movable: false };
    expect(moveLayoutElement(input, 'pc-1', { row: 1, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_not_movable' });
  });

  it('rejects student PC to teacher desk', () => {
    const input = layout([element('pc-1', 'student_pc', 1, 1), element('empty-1-2', 'empty', 1, 2), element('desk', 'teacher_desk', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'incompatible_target' });
  });

  it('moves a printer to empty', () => {
    const input = layout([element('printer', 'printer', 1, 1), element('empty-1-2', 'empty', 1, 2), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'printer', { row: 1, column: 2 }, options)).toMatchObject({ ok: true, operation: 'moved' });
  });

  it('reports a missing source separately', () => {
    expect(moveLayoutElement(validLayout(), 'missing', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'source_not_found' });
  });

  it('rejects a printer to an occupied PC with occupied_target', () => {
    const input = layout([element('printer', 'printer', 1, 1), element('pc-2', 'student_pc', 1, 2), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'printer', { row: 1, column: 2 }, options)).toMatchObject({ ok: false, reason: 'occupied_target' });
  });

  it('moves a teacher PC to empty', () => {
    const input = layout([element('teacher', 'teacher_pc', 1, 1), element('empty-1-2', 'empty', 1, 2), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'teacher', { row: 2, column: 1 }, options)).toMatchObject({ ok: true, operation: 'moved' });
  });

  it('rejects a teacher PC to a student PC', () => {
    const input = layout([element('teacher', 'teacher_pc', 1, 1), element('pc-2', 'student_pc', 1, 2), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'teacher', { row: 1, column: 2 }, options)).toMatchObject({ ok: false, reason: 'occupied_target' });
  });

  it('rejects an out-of-grid target', () => expect(moveLayoutElement(validLayout(), 'pc-1', { row: 3, column: 1 }, options)).toMatchObject({ ok: false, reason: 'invalid_target_coordinate' }));
  it('rejects a non-integer target', () => expect(moveLayoutElement(validLayout(), 'pc-1', { row: 1.5, column: 1 }, options)).toMatchObject({ ok: false, reason: 'invalid_target_coordinate' }));

  it('reports noop only for an eligible source, with an immutable clone and unchanged updatedAt', () => {
    const input = validLayout();
    const result = moveLayoutElement(input, 'pc-1', { row: 1, column: 1 }, { updatedAt: 'not-a-timestamp' });
    expect(result).toMatchObject({ ok: true, operation: 'noop', sourceElementId: 'pc-1', targetElementId: 'pc-1' });
    if (!result.ok) return;
    expect(result.layout).not.toBe(input);
    expect(result.layout.elements).not.toBe(input.elements);
    expect(result.layout.elements[0]).not.toBe(input.elements[0]);
    expect(result.layout.updatedAt).toBe(input.updatedAt);
  });

  it('rejects an invalid source layout', () => {
    const input = validLayout();
    input.elements[0].referenceId = undefined;
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'invalid_layout' });
  });

  it('rejects a spanning source move', () => {
    const input = layout([element('pc-1', 'student_pc', 1, 1, { columnSpan: 2 }), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'spanning_move_not_supported' });
  });

  it('rejects a spanning source dropped onto its own coordinate', () => {
    const input = layout([element('pc-1', 'student_pc', 1, 1, { columnSpan: 2 }), element('empty-2-1', 'empty', 2, 1), element('empty-2-2', 'empty', 2, 2)]);
    expect(moveLayoutElement(input, 'pc-1', { row: 1, column: 1 }, options)).toMatchObject({ ok: false, reason: 'spanning_move_not_supported' });
  });

  it('rejects a spanning target move', () => {
    const input = layout([element('pc-1', 'student_pc', 1, 1), element('empty-1-2', 'empty', 1, 2), element('empty-row-2', 'empty', 2, 1, { columnSpan: 2 })]);
    expect(moveLayoutElement(input, 'pc-1', { row: 2, column: 1 }, options)).toMatchObject({ ok: false, reason: 'spanning_move_not_supported' });
  });

  it('rejects an invalid mutation timestamp', () => expect(moveLayoutElement(validLayout(), 'pc-1', { row: 2, column: 1 }, { updatedAt: 'not-a-timestamp' })).toMatchObject({ ok: false, reason: 'invalid_timestamp' }));

  it('supports direct student-PC swap with deterministic updatedAt', () => {
    const result = swapLayoutElements(validLayout(), 'pc-1', 'pc-2', options);
    expect(result).toMatchObject({ ok: true, operation: 'swapped' });
    if (result.ok) expect(result.layout.updatedAt).toBe(UPDATED_AT);
  });

  it('reports a missing direct-swap source separately', () => {
    expect(swapLayoutElements(validLayout(), 'missing', 'pc-2', options)).toMatchObject({ ok: false, reason: 'source_not_found' });
  });

  it('reports a missing direct-swap target separately', () => {
    expect(swapLayoutElements(validLayout(), 'pc-1', 'missing', options)).toMatchObject({ ok: false, reason: 'target_not_found' });
  });

  it('does not allow an ineligible direct same-ID swap to return noop', () => {
    const input = validLayout();
    input.elements[0] = { ...input.elements[0], fixed: true, movable: false };
    expect(swapLayoutElements(input, 'pc-1', 'pc-1', options)).toMatchObject({ ok: false, reason: 'swap_not_allowed' });
  });
});
