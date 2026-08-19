import { describe, expect, it } from 'vitest';
import {
  createGeometrySpanSubmission,
  validateGeometrySpanInput,
} from '../layoutGeometryInput';

describe('layout geometry span input validation', () => {
  it('accepts a valid row value', () => {
    expect(validateGeometrySpanInput('3', 10, 'row')).toEqual({ valid: true, value: 3 });
  });

  it('accepts a valid column value at its maximum', () => {
    expect(validateGeometrySpanInput('6', 6, 'column')).toEqual({ valid: true, value: 6 });
  });

  it('rejects an empty value', () => {
    expect(validateGeometrySpanInput('', 10, 'row')).toEqual({ valid: false, message: 'Rentang baris wajib diisi.' });
  });

  it('rejects zero with the minimum message', () => {
    expect(validateGeometrySpanInput('0', 10, 'row')).toEqual({ valid: false, message: 'Rentang baris minimal 1.' });
  });

  it('rejects a negative value with the minimum message', () => {
    expect(validateGeometrySpanInput('-1', 6, 'column')).toEqual({ valid: false, message: 'Rentang kolom minimal 1.' });
  });

  it('rejects a fractional value', () => {
    expect(validateGeometrySpanInput('1.5', 10, 'row')).toEqual({ valid: false, message: 'Rentang baris harus berupa bilangan bulat.' });
  });

  it('rejects text as an invalid number', () => {
    expect(validateGeometrySpanInput('abc', 6, 'column')).toEqual({ valid: false, message: 'Rentang kolom harus berupa bilangan bulat.' });
  });

  it('rejects a row above maximum and references the current maximum', () => {
    expect(validateGeometrySpanInput('11', 10, 'row')).toEqual({ valid: false, message: 'Maksimum rentang baris dari posisi ini adalah 10.' });
  });

  it('rejects a column above maximum and references the current maximum', () => {
    expect(validateGeometrySpanInput('7', 6, 'column')).toEqual({ valid: false, message: 'Maksimum rentang kolom dari posisi ini adalah 6.' });
  });

  it('does not clamp a large manually entered value', () => {
    const result = validateGeometrySpanInput('999', 6, 'column');
    expect(result).toEqual({ valid: false, message: 'Maksimum rentang kolom dari posisi ini adalah 6.' });
    expect('value' in result).toBe(false);
  });

  it('applies equivalent validity rules to row and column values', () => {
    for (const value of ['', '0', '-1', '1.5', 'abc', '6', '7']) {
      expect(validateGeometrySpanInput(value, 6, 'row').valid).toBe(validateGeometrySpanInput(value, 6, 'column').valid);
    }
  });

  it('creates the intended numeric geometry submission from two valid inputs', () => {
    expect(createGeometrySpanSubmission(
      validateGeometrySpanInput('3', 10, 'row'),
      validateGeometrySpanInput('4', 6, 'column'),
    )).toEqual({ rowSpan: 3, columnSpan: 4 });
  });

  it('guards geometry submission when either input is invalid', () => {
    const validRow = validateGeometrySpanInput('3', 10, 'row');
    const invalidRow = validateGeometrySpanInput('11', 10, 'row');
    const validColumn = validateGeometrySpanInput('4', 6, 'column');
    const invalidColumn = validateGeometrySpanInput('7', 6, 'column');
    expect(createGeometrySpanSubmission(invalidRow, validColumn)).toBeNull();
    expect(createGeometrySpanSubmission(validRow, invalidColumn)).toBeNull();
  });
});
