export type GeometrySpanAxis = 'row' | 'column';

export type GeometrySpanInputValidation =
  | { valid: true; value: number }
  | { valid: false; message: string };

const AXIS_LABELS: Record<GeometrySpanAxis, string> = {
  row: 'baris',
  column: 'kolom',
};

export function validateGeometrySpanInput(
  input: string,
  maximum: number,
  axis: GeometrySpanAxis,
): GeometrySpanInputValidation {
  const label = AXIS_LABELS[axis];
  if (!input.trim()) return { valid: false, message: `Rentang ${label} wajib diisi.` };
  const value = Number(input);
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    return { valid: false, message: `Rentang ${label} harus berupa bilangan bulat.` };
  }
  if (value < 1) return { valid: false, message: `Rentang ${label} minimal 1.` };
  if (value > maximum) {
    return { valid: false, message: `Maksimum rentang ${label} dari posisi ini adalah ${maximum}.` };
  }
  return { valid: true, value };
}

export function createGeometrySpanSubmission(
  row: GeometrySpanInputValidation,
  column: GeometrySpanInputValidation,
): { rowSpan: number; columnSpan: number } | null {
  return row.valid && column.valid
    ? { rowSpan: row.value, columnSpan: column.value }
    : null;
}
