import { describe, expect, it } from 'vitest';
import { statusDisplayLabel } from '@/lib/statusPresentation';

describe('status presentation labels', () => {
  it('localizes laboratory active states without changing persisted values', () => {
    expect(statusDisplayLabel('active')).toBe('Aktif');
    expect(statusDisplayLabel('inactive')).toBe('Nonaktif');
  });

  it('preserves statuses without a presentation override', () => {
    expect(statusDisplayLabel('Online')).toBe('Online');
  });
});
