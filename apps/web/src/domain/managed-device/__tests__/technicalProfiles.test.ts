import { describe, expect, it } from 'vitest';
import { generateSeedData } from '@/data/seed';
import type { DeviceTechnicalProfile, ManagedDeviceType } from '@/types';
import {
  applyDeviceOperationalStatus,
  formatOptionalTelemetry,
  getDesktopPcTechnicalProfile,
  getDeviceOperatingSystem,
  getDeviceTechnicalProfileDisplayRows,
  simulateDeviceHeartbeat,
  validateDeviceTechnicalProfile,
  validateManagedDeviceInventory,
} from '../index';

const MINIMAL_PROFILES = [
  ['desktop_pc', { kind: 'desktop_pc' }],
  ['laptop', { kind: 'laptop' }],
  ['server', { kind: 'server' }],
  ['network_switch', { kind: 'network_switch' }],
  ['router', { kind: 'router' }],
  ['access_point', { kind: 'access_point' }],
  ['printer', { kind: 'printer' }],
  ['projector', { kind: 'projector' }],
  ['ups', { kind: 'ups' }],
  ['other', { kind: 'other' }],
] as const satisfies readonly (readonly [ManagedDeviceType, DeviceTechnicalProfile])[];

describe('Device technical-profile validation', () => {
  it('generates canonical desktop seed Devices without legacy root specification duplicates', () => {
    const devices = generateSeedData().devices;
    expect(devices.every((device) => device.technicalProfile.kind === 'desktop_pc')).toBe(true);
    expect(devices.every((device) => ['processor', 'ramGB', 'storageGB', 'gpu', 'monitor', 'os', 'peripherals']
      .every((field) => !Object.prototype.hasOwnProperty.call(device, field)))).toBe(true);
  });

  it.each(MINIMAL_PROFILES)('accepts an incomplete but valid %s profile', (deviceType, profile) => {
    expect(validateDeviceTechnicalProfile(deviceType, profile)).toEqual({ valid: true, issues: [] });
    const db = generateSeedData();
    db.devices[0].deviceType = deviceType;
    db.devices[0].technicalProfile = profile;
    expect(validateManagedDeviceInventory(db).issues.filter((issue) => issue.deviceId === db.devices[0].id)).toEqual([]);
  });

  it('rejects a mismatched Device type and profile kind', () => {
    expect(validateDeviceTechnicalProfile('router', { kind: 'printer' }).issues.map((issue) => issue.code)).toContain('device-profile-kind-mismatch');
  });

  it('rejects an unknown or missing profile kind', () => {
    expect(validateDeviceTechnicalProfile('router', { kind: 'modem' }).issues.map((issue) => issue.code)).toContain('invalid-technical-profile-kind');
    expect(validateDeviceTechnicalProfile('router', undefined).issues.map((issue) => issue.code)).toContain('missing-technical-profile');
  });

  it('rejects negative or non-finite numeric quantities', () => {
    expect(validateDeviceTechnicalProfile('server', { kind: 'server', cpuCores: -1 }).valid).toBe(false);
    expect(validateDeviceTechnicalProfile('ups', { kind: 'ups', capacityVA: Number.POSITIVE_INFINITY }).valid).toBe(false);
  });

  it('rejects invalid laptop battery percentage, access-point band, printer technology, and other scalar', () => {
    expect(validateDeviceTechnicalProfile('laptop', { kind: 'laptop', batteryHealthPercent: 101 }).valid).toBe(false);
    expect(validateDeviceTechnicalProfile('access_point', { kind: 'access_point', bands: ['7GHz'] }).valid).toBe(false);
    expect(validateDeviceTechnicalProfile('printer', { kind: 'printer', technology: '3d' }).valid).toBe(false);
    expect(validateDeviceTechnicalProfile('other', { kind: 'other', specifications: { nested: { invalid: true } } }).valid).toBe(false);
  });

  it.each(['processor', 'ramGB', 'storageGB', 'gpu', 'monitor', 'os', 'peripherals'] as const)('rejects stale root %s in a canonical v4 Device', (field) => {
    const db = generateSeedData();
    (db.devices[0] as unknown as Record<string, unknown>)[field] = 'stale duplicate';
    expect(validateManagedDeviceInventory(db).issues.map((issue) => issue.code)).toContain('legacy-device-technical-field');
  });
});

describe('technical-profile accessors and optional telemetry', () => {
  it('resolves desktop specifications, peripherals, and OS centrally', () => {
    const device = generateSeedData().devices[0];
    const profile = getDesktopPcTechnicalProfile(device.technicalProfile);
    expect(profile?.peripherals).toBeDefined();
    expect(getDeviceOperatingSystem(device.technicalProfile)).toBe(profile?.os);
    expect(getDeviceTechnicalProfileDisplayRows(device.technicalProfile).map((row) => row.key)).toEqual([
      'processor', 'ramGB', 'storageGB', 'gpu', 'monitor', 'os',
    ]);
  });

  it('formats missing or invalid telemetry without undefined or NaN output', () => {
    expect(formatOptionalTelemetry(undefined, '%')).toBe('Tidak tersedia');
    expect(formatOptionalTelemetry(Number.NaN, ' °C')).toBe('Tidak tersedia');
    expect(formatOptionalTelemetry(42.4, '%')).toBe('42%');
  });

  it('preserves existing desktop heartbeat behavior', () => {
    const device = { ...generateSeedData().devices[0], status: 'Online' as const, cpuUsage: 20, ramUsage: 30, lastHeartbeat: 'old' };
    expect(simulateDeviceHeartbeat(device, { at: 'new', cpuDelta: 5, ramDelta: 7 })).toMatchObject({ cpuUsage: 25, ramUsage: 37, lastHeartbeat: 'new' });
  });

  it('does not fabricate absent CPU, RAM, network, or heartbeat telemetry', () => {
    const source = generateSeedData().devices[0];
    const device = { ...source, technicalProfile: { kind: 'router' } as const, deviceType: 'router' as const };
    delete device.cpuUsage;
    delete device.ramUsage;
    delete device.network;
    delete device.lastHeartbeat;
    const heartbeat = simulateDeviceHeartbeat(device, { at: 'new', cpuDelta: 5, ramDelta: 7 });
    const status = applyDeviceOperationalStatus(device, 'Online', 'new');
    expect(heartbeat).not.toHaveProperty('cpuUsage');
    expect(heartbeat).not.toHaveProperty('ramUsage');
    expect(heartbeat).not.toHaveProperty('lastHeartbeat');
    expect(status).not.toHaveProperty('cpuUsage');
    expect(status).not.toHaveProperty('ramUsage');
    expect(status).not.toHaveProperty('network');
    expect(status).not.toHaveProperty('lastHeartbeat');
  });
});
