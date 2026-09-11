import type { AssetQrLabelTemplate } from '@/services/assetQrApi';

export interface AssetQrPhysicalLabelLayout {
  widthMm: number;
  heightMm: number;
  columns: number;
  rows: number;
  paddingMm: number;
  qrMm: number;
}

export const ASSET_QR_A4_MARGIN_MM = 10;
export const ASSET_QR_A4_PRINT_WIDTH_MM = 190;
export const ASSET_QR_A4_PRINT_HEIGHT_MM = 277;

export const ASSET_QR_LABEL_LAYOUT: Readonly<Record<AssetQrLabelTemplate, AssetQrPhysicalLabelLayout>> = {
  '40x25': { widthMm: 40, heightMm: 25, columns: 4, rows: 11, paddingMm: 1.5, qrMm: 20 },
  '50x30': { widthMm: 50, heightMm: 30, columns: 3, rows: 9, paddingMm: 2, qrMm: 24 },
  '70x40': { widthMm: 70, heightMm: 40, columns: 2, rows: 6, paddingMm: 2.5, qrMm: 32 },
};

export function assetQrLabelsPerA4(templateKey: AssetQrLabelTemplate): number {
  const layout = ASSET_QR_LABEL_LAYOUT[templateKey];
  return layout.columns * layout.rows;
}

export function assetQrA4PageCount(templateKey: AssetQrLabelTemplate, itemCount: number): number {
  if (!Number.isSafeInteger(itemCount) || itemCount < 0) throw new Error('Jumlah item label tidak valid.');
  return itemCount === 0 ? 0 : Math.ceil(itemCount / assetQrLabelsPerA4(templateKey));
}
