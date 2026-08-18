import {
  PALETTE_PLACEABLE_ELEMENT_TYPES,
  type LayoutCoordinate,
  type PalettePlaceableElementType,
} from '@/domain/laboratory-layout';
import type { LayoutElement } from '@/types';

export const LAYOUT_ELEMENT_DRAG_MIME = 'application/x-smartlab-layout-element';

export interface LayoutElementGrabOffset {
  grabRowOffset: number;
  grabColumnOffset: number;
}

export interface LayoutElementDragPayload extends LayoutElementGrabOffset {
  elementId: string;
}

interface LogicalGridBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface ResolveLogicalGridCoordinateInput {
  clientX: number;
  clientY: number;
  bounds: LogicalGridBounds;
  rows: number;
  columns: number;
  rowGap: number;
  columnGap: number;
}

export type LayoutDropAction =
  | { kind: 'place'; type: PalettePlaceableElementType; target: LayoutCoordinate }
  | { kind: 'move'; elementId: string; target: LayoutCoordinate };

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isPaletteType(value: string): value is PalettePlaceableElementType {
  return (PALETTE_PLACEABLE_ELEMENT_TYPES as readonly string[]).includes(value);
}

export function resolveLogicalGridCoordinate(input: ResolveLogicalGridCoordinateInput): LayoutCoordinate | null {
  if (!Number.isInteger(input.rows) || input.rows <= 0 || !Number.isInteger(input.columns) || input.columns <= 0) return null;
  const cellWidth = (input.bounds.width - (input.columns - 1) * input.columnGap) / input.columns;
  const cellHeight = (input.bounds.height - (input.rows - 1) * input.rowGap) / input.rows;
  if (cellWidth <= 0 || cellHeight <= 0) return null;
  const column = Math.min(input.columns, Math.max(1, Math.floor((input.clientX - input.bounds.left + input.columnGap / 2) / (cellWidth + input.columnGap)) + 1));
  const row = Math.min(input.rows, Math.max(1, Math.floor((input.clientY - input.bounds.top + input.rowGap / 2) / (cellHeight + input.rowGap)) + 1));
  return { row, column };
}

export function createLayoutElementDragPayload(
  element: Pick<LayoutElement, 'id' | 'row' | 'column' | 'rowSpan' | 'columnSpan'>,
  pointerCoordinate: LayoutCoordinate,
): LayoutElementDragPayload | null {
  const grabRowOffset = pointerCoordinate.row - element.row;
  const grabColumnOffset = pointerCoordinate.column - element.column;
  if (!isNonNegativeInteger(grabRowOffset)
    || !isNonNegativeInteger(grabColumnOffset)
    || grabRowOffset >= element.rowSpan
    || grabColumnOffset >= element.columnSpan) return null;
  return { elementId: element.id, grabRowOffset, grabColumnOffset };
}

export function serializeLayoutElementDragPayload(payload: LayoutElementDragPayload): string {
  return JSON.stringify(payload);
}

export function parseLayoutElementDragPayload(value: string): LayoutElementDragPayload | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const candidate = parsed as Record<string, unknown>;
    if (typeof candidate.elementId !== 'string' || !candidate.elementId.trim()) return null;
    if (!isNonNegativeInteger(candidate.grabRowOffset) || !isNonNegativeInteger(candidate.grabColumnOffset)) return null;
    return {
      elementId: candidate.elementId,
      grabRowOffset: candidate.grabRowOffset,
      grabColumnOffset: candidate.grabColumnOffset,
    };
  } catch {
    return null;
  }
}

export function calculateElementDropAnchor(
  pointerCoordinate: LayoutCoordinate,
  offset: LayoutElementGrabOffset,
): LayoutCoordinate {
  return {
    row: pointerCoordinate.row - offset.grabRowOffset,
    column: pointerCoordinate.column - offset.grabColumnOffset,
  };
}

export function resolveLayoutDropAction(input: {
  pointerCoordinate: LayoutCoordinate;
  paletteType: string;
  serializedElementPayload: string;
  elements: readonly Pick<LayoutElement, 'id' | 'rowSpan' | 'columnSpan'>[];
}): LayoutDropAction | null {
  if (input.paletteType) {
    return isPaletteType(input.paletteType)
      ? { kind: 'place', type: input.paletteType, target: { ...input.pointerCoordinate } }
      : null;
  }
  const payload = parseLayoutElementDragPayload(input.serializedElementPayload);
  if (!payload) return null;
  const source = input.elements.find((element) => element.id === payload.elementId);
  if (!source || payload.grabRowOffset >= source.rowSpan || payload.grabColumnOffset >= source.columnSpan) return null;
  return {
    kind: 'move',
    elementId: payload.elementId,
    target: calculateElementDropAnchor(input.pointerCoordinate, payload),
  };
}
