import { Monitor, MousePointer2 } from 'lucide-react';
import { editorChildKey, type CanonicalLayoutEditorState, type LayoutDeviceMetadataById } from '@/domain/server-layout';
import { placementDisplayLabel } from '@/lib/layoutPage';
import { cn } from '@/utils';

const STRUCTURAL_LABELS = {
  teacher_desk: 'Meja Guru',
  door: 'Pintu',
  window: 'Jendela',
  wall: 'Dinding',
  aisle: 'Lorong',
  label: 'Label',
} as const;

export type LayoutGridSelection =
  | { kind: 'structural'; key: string }
  | { kind: 'device'; key: string }
  | null;

interface LayoutGridProps {
  editor: CanonicalLayoutEditorState;
  metadataById: LayoutDeviceMetadataById;
  selection: LayoutGridSelection;
  editable: boolean;
  placingLabel: string | null;
  onSelect: (selection: LayoutGridSelection) => void;
  onEmptyCell: (row: number, column: number) => void;
}

export function LayoutGrid({
  editor,
  metadataById,
  selection,
  editable,
  placingLabel,
  onSelect,
  onEmptyCell,
}: LayoutGridProps) {
  const occupied = new Set<string>();
  for (const item of [...editor.structuralElements, ...editor.devicePlacements]) {
    for (let row = item.row; row < item.row + item.rowSpan; row += 1) {
      for (let column = item.column; column < item.column + item.columnSpan; column += 1) occupied.add(`${row}:${column}`);
    }
  }

  const cells = [];
  for (let row = 1; row <= editor.rows; row += 1) {
    for (let column = 1; column <= editor.columns; column += 1) {
      const cellKey = `${row}:${column}`;
      if (occupied.has(cellKey)) continue;
      cells.push(
        <button
          key={cellKey}
          type="button"
          disabled={!editable || (!placingLabel && !selection)}
          aria-label={`Sel kosong baris ${row}, kolom ${column}${placingLabel ? `; tempatkan ${placingLabel}` : ''}`}
          className="min-h-12 rounded-md border border-dashed border-base-600/70 bg-base-800/40 transition hover:border-accent-content/70 hover:bg-accent-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-default disabled:opacity-50"
          style={{ gridRow: row, gridColumn: column }}
          onClick={() => onEmptyCell(row, column)}
        />,
      );
    }
  }

  return (
    <div className="overflow-auto rounded-xl border border-base-700 bg-base-900/70 p-3">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>{editor.rows} baris × {editor.columns} kolom</span>
        {editable && (
          <span className="inline-flex items-center gap-1.5">
            <MousePointer2 className="h-3.5 w-3.5" />
            {placingLabel ?? (selection ? 'Klik sel kosong untuk memindahkan pilihan' : 'Pilih alat atau item')}
          </span>
        )}
      </div>
      <div
        className="grid min-w-max gap-1"
        style={{
          gridTemplateColumns: `repeat(${editor.columns}, minmax(3rem, 4.25rem))`,
          gridTemplateRows: `repeat(${editor.rows}, minmax(3rem, auto))`,
        }}
      >
        {cells}
        {editor.structuralElements.map((element) => {
          const key = editorChildKey(element);
          const label = element.label ?? STRUCTURAL_LABELS[element.type];
          const selected = selection?.kind === 'structural' && selection.key === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label}, baris ${element.row}, kolom ${element.column}`}
              aria-pressed={selected}
              className={cn(
                'z-10 overflow-hidden rounded-md border bg-base-700 px-1.5 py-1 text-center text-[11px] font-medium text-ink-primary shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                selected ? 'border-accent-content ring-2 ring-accent-content/40' : 'border-base-500',
              )}
              style={{
                gridRow: `${element.row} / span ${element.rowSpan}`,
                gridColumn: `${element.column} / span ${element.columnSpan}`,
              }}
              onClick={() => onSelect({ kind: 'structural', key })}
            >
              <span className="line-clamp-2 break-words">{label}</span>
            </button>
          );
        })}
        {editor.devicePlacements.map((placement) => {
          const key = editorChildKey(placement);
          const metadata = metadataById[placement.deviceId];
          const label = metadata?.deviceCode ?? placementDisplayLabel(placement);
          const selected = selection?.kind === 'device' && selection.key === key;
          return (
            <button
              key={key}
              type="button"
              aria-label={`${label}, baris ${placement.row}, kolom ${placement.column}`}
              aria-pressed={selected}
              className={cn(
                'z-10 flex min-w-0 flex-col items-center justify-center overflow-hidden rounded-md border bg-info/15 px-1.5 py-1 text-center text-[11px] font-medium text-ink-primary shadow-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus',
                selected ? 'border-accent-content ring-2 ring-accent-content/40' : 'border-info/50',
              )}
              style={{
                gridRow: `${placement.row} / span ${placement.rowSpan}`,
                gridColumn: `${placement.column} / span ${placement.columnSpan}`,
              }}
              onClick={() => onSelect({ kind: 'device', key })}
            >
              <Monitor className="mb-0.5 h-3.5 w-3.5 shrink-0" />
              <span className="line-clamp-2 break-all">{label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
