import { describe, expect, it } from 'vitest';
import {
  PDF_A4_HEIGHT_PT,
  PDF_A4_WIDTH_PT,
  assetQrPdfFilename,
  generateAssetQrLabelPdf,
} from '@/lib/assetQrPdf';
import type { AssetQrLabelBatch, AssetQrLabelTemplate } from '@/services/assetQrApi';

function uuidFor(index: number): string {
  return `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`;
}

function assetIdFor(index: number): string {
  return `01J0000000000000000000${String(index).padStart(4, '0')}`.slice(0, 26);
}

function makeBatch(templateKey: AssetQrLabelTemplate, count: number): AssetQrLabelBatch {
  return {
    id: '01J00000000000000000000000',
    templateKey,
    filters: {},
    assetCount: count,
    laboratory: {
      id: '01J00000000000000000000001',
      code: 'RPL1',
      name: 'Lab RPL 1',
    },
    generatedByName: 'Operator UAT',
    generatedAt: '2026-09-11T00:00:00Z',
    items: Array.from({ length: count }, (_, index) => {
      const publicId = uuidFor(index);
      return {
        ordinal: index + 1,
        assetId: assetIdFor(index),
        assetCode: `AST-${String(index + 1).padStart(4, '0')}`,
        assetName: `Komputer Praktikum ${index + 1}`,
        laboratory: {
          id: '01J00000000000000000000001',
          code: 'RPL1',
          name: 'Lab RPL 1',
        },
        publicId,
        tokenVersion: 1,
        scanPath: `/public/assets/qr/${publicId}`,
      };
    }),
    events: [],
  };
}

function pdfText(batch: AssetQrLabelBatch): string {
  return new TextDecoder().decode(generateAssetQrLabelPdf(batch));
}

describe('Asset QR deterministic PDF', () => {
  it('emits a valid A4 PDF with safe human-readable label fields and no plaintext public UUID', () => {
    const batch = makeBatch('50x30', 1);
    const pdf = pdfText(batch);

    expect(pdf.startsWith('%PDF-1.4\n%SMARTLAB\n')).toBe(true);
    expect(pdf).toContain('/Type /Catalog');
    expect(pdf).toContain('/Count 1');
    expect(pdf).toContain('/MediaBox [0 0 595.276 841.89]');
    expect(pdf).toContain('(SMARTLAB - BP)');
    expect(pdf).toContain('(AST-0001)');
    expect(pdf).toContain('(Komputer)');
    expect(pdf).toContain('(Praktikum)');
    expect(pdf).not.toContain('(Komputer Praktikum 1)');
    expect(pdf).toContain('(RPL1)');
    expect(pdf).not.toContain(batch.items![0].publicId);
    expect(pdf.endsWith('%%EOF\n')).toBe(true);
  });

  it('is byte-for-byte deterministic for the same immutable batch snapshot', () => {
    const batch = makeBatch('50x30', 1);
    const first = generateAssetQrLabelPdf(batch);
    const second = generateAssetQrLabelPdf(batch);

    expect(Array.from(first)).toEqual(Array.from(second));
  });

  it('keeps the exported A4 point geometry locked to 210 x 297 mm', () => {
    expect(Number(PDF_A4_WIDTH_PT.toFixed(3))).toBe(595.276);
    expect(Number(PDF_A4_HEIGHT_PT.toFixed(3))).toBe(841.89);
  });

  it('paginates from the same physical template capacity used by print layout', () => {
    const pdf = pdfText(makeBatch('50x30', 28));

    expect(pdf).toContain('/Count 2');
    expect((pdf.match(/\/Type \/Page \/Parent/g) ?? [])).toHaveLength(2);
    expect((pdf.match(/\/MediaBox \[0 0 595\.276 841\.89\]/g) ?? [])).toHaveLength(2);
    expect(pdf).toContain('(AST-0028)');
  });

  it('fails closed when the immutable item snapshot is incomplete', () => {
    const batch = makeBatch('70x40', 1);
    batch.assetCount = 2;

    expect(() => generateAssetQrLabelPdf(batch)).toThrow('Immutable Asset QR label batch belum lengkap untuk PDF.');
  });

  it('creates a deterministic sanitized PDF filename from batch identity and template', () => {
    const batch = makeBatch('40x25', 1);
    batch.id = 'batch/unsafe value';

    expect(assetQrPdfFilename(batch)).toBe('smartlab-asset-labels-40x25-batch-unsafe-value.pdf');
  });
});
