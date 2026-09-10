import { describe, expect, it } from 'vitest';
import { assetQrLabelsPerA4 } from '@/components/asset/AssetQrPrintSheet';

describe('Asset QR A4 layout capacities', () => {
  it('keeps every supported physical template within the locked A4 grid', () => {
    expect(assetQrLabelsPerA4('40x25')).toBe(44);
    expect(assetQrLabelsPerA4('50x30')).toBe(27);
    expect(assetQrLabelsPerA4('70x40')).toBe(12);
  });
});
