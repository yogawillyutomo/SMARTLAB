import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { createInitialLaboratoryDevices, createLaboratoryWithInitialLayout } from '../index';

const CREATED_AT = '2026-08-06T00:00:00.000Z';

function input() {
  const db = generateSeedData();
  const laboratory = { ...db.labs[0], id: 'lab-created', code: 'NEW', name: 'Lab Baru', pcCount: 1, layoutRows: 2, layoutCols: 2 };
  return {
    db,
    laboratory,
    devices: createInitialLaboratoryDevices(laboratory, CREATED_AT),
    createdAt: CREATED_AT,
    layoutId: 'layout:lab-created:v1',
  };
}

function failureCode(result: ReturnType<typeof createLaboratoryWithInitialLayout>): string | undefined {
  return result.ok ? undefined : result.issues[0]?.code;
}

describe('laboratory creation identity taxonomy', () => {
  it('returns exact identity issue codes without mutating the source database', () => {
    const cases = [
      () => { const value = input(); value.laboratory.id = ''; return { value, code: 'invalid-laboratory-id' }; },
      () => { const value = input(); value.laboratory.id = value.db.labs[0].id; return { value, code: 'duplicate-laboratory-id' }; },
      () => { const value = input(); value.layoutId = ''; return { value, code: 'invalid-layout-id' }; },
      () => { const value = input(); value.layoutId = value.db.layouts[0].id; return { value, code: 'duplicate-layout-id' }; },
      () => { const value = input(); value.devices[0].id = ''; return { value, code: 'invalid-device-id' }; },
      () => {
        const value = input();
        value.laboratory.pcCount = 2;
        value.devices = createInitialLaboratoryDevices(value.laboratory, CREATED_AT);
        value.devices[1].id = value.devices[0].id;
        return { value, code: 'duplicate-device-id' };
      },
      () => { const value = input(); value.devices[0].id = value.db.devices[0].id; return { value, code: 'duplicate-device-id' }; },
    ] as const;

    cases.forEach((makeCase) => {
      const { value, code } = makeCase();
      const before = JSON.stringify(value.db);
      const result = createLaboratoryWithInitialLayout(value);
      expect(failureCode(result)).toBe(code);
      expect(JSON.stringify(value.db)).toBe(before);
    });
  });
});
