import { describe, expect, it } from 'vitest';
import { migrateLegacyDeviceCoordinates, validateLaboratoryLayout } from '../index';
import { migrationInput } from './fixtures';

describe('migrateLegacyDeviceCoordinates', () => {
  it('creates a complete 2x2 layout with empty cells', () => {
    const result = migrateLegacyDeviceCoordinates(migrationInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.layout.elements).toHaveLength(4);
    expect(result.layout.elements.filter((item) => item.type === 'empty')).toHaveLength(2);
    expect(validateLaboratoryLayout(result.layout).valid).toBe(true);
  });

  it('uses deterministic IDs and row-major ordering', () => {
    const result = migrateLegacyDeviceCoordinates(migrationInput());
    if (!result.ok) throw new Error('expected migration success');
    expect(result.layout.elements.map((item) => item.id)).toEqual(['layout-legacy:device:dev-1', 'layout-legacy:empty:1:2', 'layout-legacy:empty:2:1', 'layout-legacy:device:dev-2']);
  });

  it('preserves device references and labels', () => {
    const result = migrateLegacyDeviceCoordinates(migrationInput());
    if (!result.ok) throw new Error('expected migration success');
    expect(result.layout.elements.find((item) => item.referenceId === 'dev-1')).toMatchObject({ label: 'PC-01' });
  });

  it('does not mutate source devices', () => {
    const input = migrationInput();
    const before = JSON.stringify(input);
    migrateLegacyDeviceCoordinates(input);
    expect(JSON.stringify(input)).toBe(before);
  });

  it('rejects duplicate coordinates', () => {
    const input = migrationInput({ devices: [...migrationInput().devices, { id: 'dev-3', laboratoryId: 'lab-1', positionCode: 'PC-03', row: 1, col: 1 }] });
    expect(migrateLegacyDeviceCoordinates(input)).toMatchObject({ ok: false, issues: [{ code: 'duplicate-device-coordinate' }] });
  });

  it('rejects duplicate device IDs', () => {
    const input = migrationInput({ devices: [...migrationInput().devices, { id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-03', row: 1, col: 2 }] });
    expect(migrateLegacyDeviceCoordinates(input)).toMatchObject({ ok: false, issues: [{ code: 'duplicate-device-id' }] });
  });

  it('rejects out-of-bounds and non-integer coordinates', () => {
    expect(migrateLegacyDeviceCoordinates(migrationInput({ devices: [{ id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-01', row: 3, col: 1 }] }))).toMatchObject({ ok: false, issues: [{ code: 'invalid-device-coordinate' }] });
    expect(migrateLegacyDeviceCoordinates(migrationInput({ devices: [{ id: 'dev-1', laboratoryId: 'lab-1', positionCode: 'PC-01', row: 1.5, col: 1 }] }))).toMatchObject({ ok: false, issues: [{ code: 'invalid-device-coordinate' }] });
  });

  it('excludes other-laboratory devices', () => {
    const result = migrateLegacyDeviceCoordinates(migrationInput({ devices: [...migrationInput().devices, { id: 'foreign', laboratoryId: 'lab-2', positionCode: 'PC-99', row: 1, col: 2 }] }));
    if (!result.ok) throw new Error('expected migration success');
    expect(result.layout.elements.some((item) => item.referenceId === 'foreign')).toBe(false);
  });

  it('is equivalent when repeated with the same input', () => {
    const input = migrationInput();
    expect(migrateLegacyDeviceCoordinates(input)).toEqual(migrateLegacyDeviceCoordinates(input));
  });

  it('creates non-fixed empty elements', () => {
    const result = migrateLegacyDeviceCoordinates(migrationInput());
    if (!result.ok) throw new Error('expected migration success');
    expect(result.layout.elements.filter((item) => item.type === 'empty')).toEqual(expect.arrayContaining([expect.objectContaining({ movable: false, swappable: false, fixed: false })]));
  });
});
