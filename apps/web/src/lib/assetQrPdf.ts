import {
  ASSET_QR_A4_MARGIN_MM,
  ASSET_QR_A4_PRINT_WIDTH_MM,
  ASSET_QR_LABEL_LAYOUT,
  assetQrA4PageCount,
  assetQrLabelsPerA4,
} from '@/lib/assetQrLabelLayout';
import {
  ASSET_QR_QUIET_ZONE,
  ASSET_QR_SIZE,
  createAssetQrMatrix,
} from '@/lib/assetQrMatrix';
import type { AssetQrLabelBatch, AssetQrLabelTemplate } from '@/services/assetQrApi';

const PT_PER_MM = 72 / 25.4;
export const PDF_A4_WIDTH_PT = 210 * PT_PER_MM;
export const PDF_A4_HEIGHT_PT = 297 * PT_PER_MM;

function pt(mm: number): number {
  return mm * PT_PER_MM;
}

function n(value: number): string {
  return Number(value.toFixed(3)).toString();
}

function asciiText(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '?');
}

function pdfString(value: string): string {
  return asciiText(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function trimText(value: string, max: number): string {
  const normalized = asciiText(value).trim().replace(/\s+/g, ' ');
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(1, max - 3))}...`;
}

function wrapText(value: string, maxChars: number, maxLines = 2): string[] {
  const words = asciiText(value).trim().replace(/\s+/g, ' ').split(' ').filter(Boolean);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) lines.push(current);
    current = word.length <= maxChars ? word : trimText(word, maxChars);
    if (lines.length >= maxLines - 1) break;
  }
  if (lines.length < maxLines && current) lines.push(current);
  if (words.length > 0 && lines.length === maxLines) {
    const reconstructed = lines.join(' ');
    const source = words.join(' ');
    if (reconstructed.length < source.length) lines[maxLines - 1] = trimText(lines[maxLines - 1], maxChars);
  }
  return lines.slice(0, maxLines);
}

function textCommand(font: 'F1' | 'F2', size: number, x: number, y: number, value: string): string {
  return `BT /${font} ${n(size)} Tf ${n(x)} ${n(y)} Td (${pdfString(value)}) Tj ET\n`;
}

function drawQrCommands(publicId: string, x: number, y: number, qrMm: number): string {
  const matrix = createAssetQrMatrix(publicId);
  const totalModules = ASSET_QR_SIZE + ASSET_QR_QUIET_ZONE * 2;
  const modulePt = pt(qrMm) / totalModules;
  const matrixOriginX = x + ASSET_QR_QUIET_ZONE * modulePt;
  const matrixOriginY = y + ASSET_QR_QUIET_ZONE * modulePt;
  const commands: string[] = ['0 g\n'];

  matrix.forEach((row, rowIndex) => {
    row.forEach((dark, columnIndex) => {
      if (!dark) return;
      const rx = matrixOriginX + columnIndex * modulePt;
      const ry = matrixOriginY + (ASSET_QR_SIZE - rowIndex - 1) * modulePt;
      commands.push(`${n(rx)} ${n(ry)} ${n(modulePt + 0.02)} ${n(modulePt + 0.02)} re f\n`);
    });
  });

  const markModules = 5;
  const markPt = markModules * modulePt;
  const markX = matrixOriginX + (ASSET_QR_SIZE * modulePt - markPt) / 2;
  const markY = matrixOriginY + (ASSET_QR_SIZE * modulePt - markPt) / 2;
  commands.push(`1 g ${n(markX)} ${n(markY)} ${n(markPt)} ${n(markPt)} re f\n`);
  commands.push('0 g\n');
  commands.push(textCommand('F2', Math.max(3.5, markPt * 0.42), markX + markPt * 0.2, markY + markPt * 0.34, 'BP'));
  return commands.join('');
}

function labelContent(batch: AssetQrLabelBatch, itemIndex: number, templateKey: AssetQrLabelTemplate): string {
  const item = batch.items?.[itemIndex];
  if (!item) return '';
  const layout = ASSET_QR_LABEL_LAYOUT[templateKey];
  const perPage = assetQrLabelsPerA4(templateKey);
  const pageIndex = Math.floor(itemIndex / perPage);
  const pageLocalIndex = itemIndex - pageIndex * perPage;
  const row = Math.floor(pageLocalIndex / layout.columns);
  const column = pageLocalIndex % layout.columns;
  const gridWidthMm = layout.columns * layout.widthMm;
  const horizontalInsetMm = (ASSET_QR_A4_PRINT_WIDTH_MM - gridWidthMm) / 2;
  const leftMm = ASSET_QR_A4_MARGIN_MM + horizontalInsetMm + column * layout.widthMm;
  const bottomMm = 297 - ASSET_QR_A4_MARGIN_MM - (row + 1) * layout.heightMm;
  const x = pt(leftMm);
  const y = pt(bottomMm);
  const width = pt(layout.widthMm);
  const height = pt(layout.heightMm);
  const padding = pt(layout.paddingMm);

  const commands: string[] = [];
  commands.push('0.82 G 0.4 w\n');
  commands.push(`${n(x)} ${n(y)} ${n(width)} ${n(height)} re S\n`);
  commands.push(drawQrCommands(item.publicId, x + padding, y + (height - pt(layout.qrMm)) / 2, layout.qrMm));

  const textX = x + padding + pt(layout.qrMm) + padding;
  const textRight = x + width - padding;
  const textWidth = Math.max(1, textRight - textX);
  const compact = templateKey === '40x25';
  const assetCodeSize = compact ? 8 : 10;
  const nameSize = compact ? 6.5 : 7.5;
  const labSize = 6;
  const brandSize = 6.5;
  const approxChars = Math.max(8, Math.floor(textWidth / (nameSize * 0.52)));
  const nameLines = wrapText(item.assetName, approxChars, 2);

  commands.push('0 g\n');
  commands.push(textCommand('F2', brandSize, textX, y + height - padding - brandSize, 'LARAS - BP'));
  commands.push(textCommand('F2', assetCodeSize, textX, y + height - padding - brandSize - assetCodeSize - 2, trimText(item.assetCode, Math.max(8, approxChars + 2))));
  nameLines.forEach((line, lineIndex) => {
    commands.push(textCommand('F1', nameSize, textX, y + height - padding - brandSize - assetCodeSize - 7 - lineIndex * (nameSize + 1), line));
  });
  commands.push(textCommand('F2', labSize, textX, y + padding + 1, trimText(item.laboratory?.code ?? 'NO HOME LAB', Math.max(8, approxChars))));
  return commands.join('');
}

function pageContent(batch: AssetQrLabelBatch, pageIndex: number): string {
  const perPage = assetQrLabelsPerA4(batch.templateKey);
  const start = pageIndex * perPage;
  const end = Math.min(start + perPage, batch.items?.length ?? 0);
  let content = '';
  for (let index = start; index < end; index += 1) content += labelContent(batch, index, batch.templateKey);
  return content;
}

function buildPdf(objects: string[]): Uint8Array {
  const encoder = new TextEncoder();
  let output = '%PDF-1.4\n%LARAS\n';
  const offsets: number[] = [0];

  objects.forEach((body, index) => {
    offsets[index + 1] = encoder.encode(output).length;
    output += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = encoder.encode(output).length;
  output += `xref\n0 ${objects.length + 1}\n`;
  output += '0000000000 65535 f \n';
  for (let index = 1; index <= objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return encoder.encode(output);
}

export function generateAssetQrLabelPdf(batch: AssetQrLabelBatch): Uint8Array {
  const items = batch.items ?? [];
  if (items.length === 0 || items.length !== batch.assetCount) {
    throw new Error('Immutable Asset QR label batch belum lengkap untuk PDF.');
  }

  const pageCount = assetQrA4PageCount(batch.templateKey, items.length);
  const pageObjectNumbers = Array.from({ length: pageCount }, (_, index) => 5 + index * 2);
  const objects: string[] = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Count ${pageCount} /Kids [${pageObjectNumbers.map((objectNumber) => `${objectNumber} 0 R`).join(' ')}] >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  ];

  for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
    const pageObjectNumber = 5 + pageIndex * 2;
    const contentObjectNumber = pageObjectNumber + 1;
    const content = pageContent(batch, pageIndex);
    const contentLength = new TextEncoder().encode(content).length;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(PDF_A4_WIDTH_PT)} ${n(PDF_A4_HEIGHT_PT)}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`);
    objects.push(`<< /Length ${contentLength} >>\nstream\n${content}endstream`);
  }

  return buildPdf(objects);
}

export function assetQrPdfFilename(batch: AssetQrLabelBatch): string {
  const safeBatch = batch.id.replace(/[^A-Za-z0-9_-]/g, '-');
  return `laras-asset-labels-${batch.templateKey}-${safeBatch}.pdf`;
}

export function downloadAssetQrLabelPdf(batch: AssetQrLabelBatch): void {
  const bytes = generateAssetQrLabelPdf(batch);
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = assetQrPdfFilename(batch);
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
