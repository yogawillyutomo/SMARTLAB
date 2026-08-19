import type { ID, LaboratoryLayout, LayoutElement, LayoutElementType } from '@/types';
import type { LayoutCoordinate } from './types';

export const MULTI_CELL_LAYOUT_ELEMENT_TYPES = [
  'teacher_desk',
  'door',
  'window',
  'wall',
  'aisle',
  'label',
] as const satisfies readonly LayoutElementType[];

const DEVICE_MANAGED_TYPES: readonly LayoutElementType[] = ['student_pc', 'teacher_pc'];

export interface LayoutElementGeometryCapabilities {
  editable: boolean;
  resizable: boolean;
  reason?: 'geometry_not_custom' | 'device_geometry_managed' | 'fixed_single_cell';
}

export interface LayoutElementFootprint {
  row: number;
  column: number;
  rowSpan: number;
  columnSpan: number;
}

export interface FootprintCollision {
  elementId: ID;
  type: LayoutElementType;
  coordinate: LayoutCoordinate;
}

export type FootprintReconciliationResult =
  | { ok: true; elements: LayoutElement[]; consumedEmptyElementIds: ID[]; generatedEmptyElementIds: ID[] }
  | { ok: false; reason: 'collision'; collisions: FootprintCollision[] }
  | { ok: false; reason: 'missing_coordinate'; coordinate: LayoutCoordinate }
  | { ok: false; reason: 'duplicate_empty_id'; emptyElementId: ID };

export function coordinateKey(coordinate: LayoutCoordinate): string {
  return `${coordinate.row}:${coordinate.column}`;
}

export function getElementFootprint(element: LayoutElementFootprint): LayoutCoordinate[] {
  const coordinates: LayoutCoordinate[] = [];
  for (let row = element.row; row < element.row + element.rowSpan; row += 1) {
    for (let column = element.column; column < element.column + element.columnSpan; column += 1) {
      coordinates.push({ row, column });
    }
  }
  return coordinates;
}

export function findLayoutElementAt(layout: Pick<LaboratoryLayout, 'elements'>, coordinate: LayoutCoordinate): LayoutElement | undefined {
  return layout.elements.find((element) => coordinate.row >= element.row
    && coordinate.row < element.row + element.rowSpan
    && coordinate.column >= element.column
    && coordinate.column < element.column + element.columnSpan);
}

export function isFootprintInBounds(
  layout: Pick<LaboratoryLayout, 'rows' | 'columns'>,
  footprint: LayoutElementFootprint,
): boolean {
  return Number.isInteger(footprint.row)
    && Number.isInteger(footprint.column)
    && Number.isInteger(footprint.rowSpan)
    && Number.isInteger(footprint.columnSpan)
    && footprint.row > 0
    && footprint.column > 0
    && footprint.rowSpan > 0
    && footprint.columnSpan > 0
    && footprint.row + footprint.rowSpan - 1 <= layout.rows
    && footprint.column + footprint.columnSpan - 1 <= layout.columns;
}

export function supportsMultiCellGeometry(type: LayoutElementType): boolean {
  return (MULTI_CELL_LAYOUT_ELEMENT_TYPES as readonly LayoutElementType[]).includes(type);
}

export function getLayoutElementGeometryCapabilities(
  layout: Pick<LaboratoryLayout, 'layoutType'>,
  element: Pick<LayoutElement, 'type'>,
): LayoutElementGeometryCapabilities {
  if ((DEVICE_MANAGED_TYPES as readonly LayoutElementType[]).includes(element.type)) {
    return { editable: false, resizable: false, reason: 'device_geometry_managed' };
  }
  if (!supportsMultiCellGeometry(element.type)) {
    return { editable: false, resizable: false, reason: 'fixed_single_cell' };
  }
  if (layout.layoutType !== 'custom') {
    return { editable: false, resizable: false, reason: 'geometry_not_custom' };
  }
  return { editable: true, resizable: true };
}

export function createEmptyLayoutElement(layoutId: ID, id: ID, coordinate: LayoutCoordinate): LayoutElement {
  return {
    id,
    layoutId,
    type: 'empty',
    row: coordinate.row,
    column: coordinate.column,
    rowSpan: 1,
    columnSpan: 1,
    rotation: 0,
    movable: false,
    swappable: false,
    fixed: false,
  };
}

export function reconcileElementFootprint(
  layout: LaboratoryLayout,
  source: LayoutElement,
  nextFootprint: LayoutElementFootprint,
  emptyElementIdPrefix: string,
): FootprintReconciliationResult {
  const currentCoordinates = getElementFootprint(source);
  const nextCoordinates = getElementFootprint(nextFootprint);
  const currentKeys = new Set(currentCoordinates.map(coordinateKey));
  const nextKeys = new Set(nextCoordinates.map(coordinateKey));
  const claimedCoordinates = nextCoordinates.filter((coordinate) => !currentKeys.has(coordinateKey(coordinate)));
  const releasedCoordinates = currentCoordinates.filter((coordinate) => !nextKeys.has(coordinateKey(coordinate)));
  const consumedEmptyElementIds = new Set<ID>();
  const collisions: FootprintCollision[] = [];

  for (const coordinate of claimedCoordinates) {
    const occupant = findLayoutElementAt(layout, coordinate);
    if (!occupant) return { ok: false, reason: 'missing_coordinate', coordinate };
    if (occupant.type !== 'empty') {
      collisions.push({ elementId: occupant.id, type: occupant.type, coordinate });
    } else {
      consumedEmptyElementIds.add(occupant.id);
    }
  }
  if (collisions.length > 0) return { ok: false, reason: 'collision', collisions };

  const elements = layout.elements
    .filter((element) => !consumedEmptyElementIds.has(element.id))
    .map((element) => element.id === source.id ? { ...element, ...nextFootprint } : { ...element });
  const retainedIds = new Set(elements.map((element) => element.id));
  const generatedEmptyElementIds: ID[] = [];
  for (const coordinate of releasedCoordinates) {
    const id = `${emptyElementIdPrefix}:${coordinate.row}:${coordinate.column}`;
    if (retainedIds.has(id)) return { ok: false, reason: 'duplicate_empty_id', emptyElementId: id };
    retainedIds.add(id);
    generatedEmptyElementIds.push(id);
    elements.push(createEmptyLayoutElement(layout.id, id, coordinate));
  }
  return {
    ok: true,
    elements,
    consumedEmptyElementIds: [...consumedEmptyElementIds],
    generatedEmptyElementIds,
  };
}
