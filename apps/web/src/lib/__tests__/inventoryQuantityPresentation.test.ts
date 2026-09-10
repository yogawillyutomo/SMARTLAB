import { describe, expect, it } from 'vitest';
import { formatInventoryQuantity } from '@/lib/inventoryQuantityPresentation';

describe('inventory quantity presentation', () => {
  it('hides fixed decimal scale for whole discrete quantities', () => {
    expect(formatInventoryQuantity('1.000', 'pcs')).toBe('1');
    expect(formatInventoryQuantity(12, 'unit')).toBe('12');
  });

  it('uses Indonesian decimal notation for measurement quantities', () => {
    expect(formatInventoryQuantity('1.250', 'kg')).toBe('1,25');
    expect(formatInventoryQuantity('0.500', 'meter')).toBe('0,5');
  });

  it('does not hide anomalous fractional evidence on discrete units', () => {
    expect(formatInventoryQuantity('0.001', 'pcs')).toBe('0,001');
  });
});
