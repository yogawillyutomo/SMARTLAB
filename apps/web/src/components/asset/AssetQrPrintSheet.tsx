import { Fragment } from 'react';
import { AssetQrCode } from '@/components/asset/AssetQrCode';
import {
  ASSET_QR_A4_PRINT_HEIGHT_MM,
  ASSET_QR_A4_PRINT_WIDTH_MM,
  ASSET_QR_LABEL_LAYOUT,
  assetQrLabelsPerA4,
} from '@/lib/assetQrLabelLayout';
import type { AssetQrLabelBatch } from '@/services/assetQrApi';

export { assetQrLabelsPerA4 } from '@/lib/assetQrLabelLayout';

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let offset = 0; offset < items.length; offset += size) result.push(items.slice(offset, offset + size));
  return result;
}

export function AssetQrPrintSheet({ batch }: { batch: AssetQrLabelBatch }) {
  const items = batch.items ?? [];
  if (items.length === 0) return null;

  const layout = ASSET_QR_LABEL_LAYOUT[batch.templateKey];
  const pages = chunks(items, assetQrLabelsPerA4(batch.templateKey));

  return (
    <div className="asset-qr-print-root" aria-hidden="true">
      <style>{`
        .asset-qr-print-root { display: none; }
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          .asset-qr-print-root, .asset-qr-print-root * { visibility: visible !important; }
          .asset-qr-print-root {
            display: block !important;
            position: absolute;
            inset: 0 auto auto 0;
            width: ${ASSET_QR_A4_PRINT_WIDTH_MM}mm;
            color: #000;
            background: #fff;
          }
          .asset-qr-print-page {
            width: ${ASSET_QR_A4_PRINT_WIDTH_MM}mm;
            min-height: ${ASSET_QR_A4_PRINT_HEIGHT_MM}mm;
            display: grid;
            align-content: start;
            justify-content: center;
            page-break-after: always;
            break-after: page;
          }
          .asset-qr-print-page:last-child { page-break-after: auto; break-after: auto; }
          .asset-qr-print-label { box-sizing: border-box; overflow: hidden; break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>
      {pages.map((pageItems, pageIndex) => (
        <div
          key={`${batch.id}-page-${pageIndex + 1}`}
          className="asset-qr-print-page"
          style={{
            gridTemplateColumns: `repeat(${layout.columns}, ${layout.widthMm}mm)`,
            gridAutoRows: `${layout.heightMm}mm`,
          }}
        >
          {pageItems.map((item) => (
            <Fragment key={`${batch.id}-${item.ordinal}`}>
              <div
                className="asset-qr-print-label"
                style={{
                  width: `${layout.widthMm}mm`,
                  height: `${layout.heightMm}mm`,
                  padding: `${layout.paddingMm}mm`,
                  border: '0.2mm solid #d4d4d4',
                  display: 'grid',
                  gridTemplateColumns: `${layout.qrMm}mm minmax(0, 1fr)`,
                  gap: `${layout.paddingMm}mm`,
                  alignItems: 'center',
                  background: '#fff',
                }}
              >
                <AssetQrCode publicId={item.publicId} className="block h-auto w-full" showBpMark />
                <div style={{ minWidth: 0, fontFamily: 'Arial, sans-serif', lineHeight: 1.08 }}>
                  <div style={{ fontSize: '7pt', fontWeight: 800, letterSpacing: '0.02em' }}>SMARTLAB · BP</div>
                  <div style={{ marginTop: '1mm', fontSize: batch.templateKey === '40x25' ? '8pt' : '10pt', fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.assetCode}</div>
                  <div style={{ marginTop: '0.6mm', fontSize: batch.templateKey === '40x25' ? '6.5pt' : '7.5pt', fontWeight: 600, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{item.assetName}</div>
                  <div style={{ marginTop: '1mm', fontSize: '6pt', fontWeight: 600 }}>{item.laboratory?.code ?? 'NO HOME LAB'}</div>
                </div>
              </div>
            </Fragment>
          ))}
        </div>
      ))}
    </div>
  );
}
