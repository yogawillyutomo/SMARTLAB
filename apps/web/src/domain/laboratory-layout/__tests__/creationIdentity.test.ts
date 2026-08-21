import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import { createInitialLaboratoryDevices, createLaboratoryWithInitialLayout } from '../index';
import { isValidQrPublicId, validateManagedDeviceInventory } from '@/domain/managed-device';

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
  it('creates schema-v4 desktop profiles and unique QR identities without Assets or Device coordinates', () => {
    const value = input();
    const beforeAssets = structuredClone(value.db.assets);
    const devices = value.devices;
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({
      deviceType: 'desktop_pc',
      lifecycleStatus: 'in_service',
      technicalProfile: { kind: 'desktop_pc', processor: 'Intel Core i5-11400' },
    });
    expect(isValidQrPublicId(devices[0].qrPublicId)).toBe(true);
    expect(devices[0].assetId).toBeUndefined();
    expect(devices.every((device) => !Object.prototype.hasOwnProperty.call(device, 'row') && !Object.prototype.hasOwnProperty.call(device, 'col'))).toBe(true);
    const created = createLaboratoryWithInitialLayout(value);
    if (!created.ok) throw new Error('expected laboratory creation');
    expect(created.db.assets).toEqual(beforeAssets);
    expect(validateManagedDeviceInventory(created.db).valid).toBe(true);
  });

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
