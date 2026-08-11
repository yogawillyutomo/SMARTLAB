import type { DragEvent } from 'react';
import {
  DoorOpen,
  Lock,
  Monitor,
  Move,
  Network,
  PanelTop,
  Printer,
  Table2,
  Tag,
  Trash2,
  Wifi,
  X,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import {
  PALETTE_ELEMENT_DISPLAY_NAMES,
  type PalettePlaceableElementType,
} from '@/domain/laboratory-layout';
import type { LayoutElement } from '@/types';
import { cn } from '@/utils';

export const LAYOUT_PALETTE_DRAG_MIME = 'application/x-smartlab-layout-palette';

type PaletteIcon = typeof Printer;

interface PaletteItem {
  type: PalettePlaceableElementType;
  icon: PaletteIcon;
}

const GROUPS: Array<{ title: string; items: PaletteItem[] }> = [
  { title: 'Infrastruktur / Peralatan', items: [{ type: 'printer', icon: Printer }, { type: 'network_switch', icon: Network }, { type: 'access_point', icon: Wifi }] },
  { title: 'Struktur Ruang', items: [{ type: 'teacher_desk', icon: Table2 }, { type: 'door', icon: DoorOpen }, { type: 'window', icon: PanelTop }, { type: 'wall', icon: PanelTop }, { type: 'aisle', icon: Move }] },
  { title: 'Informasi', items: [{ type: 'label', icon: Tag }] },
];

const TYPE_NAMES: Record<LayoutElement['type'], string> = {
  student_pc: 'PC Siswa',
  teacher_pc: 'PC Guru',
  teacher_desk: 'Meja Guru',
  projector: 'Projector',
  printer: 'Printer',
  network_switch: 'Network Switch',
  access_point: 'Access Point',
  door: 'Pintu',
  window: 'Jendela',
  wall: 'Dinding',
  aisle: 'Jalur',
  label: 'Label',
  empty: 'Sel kosong',
};

interface LayoutElementPaletteProps {
  canUpdate: boolean;
  structureEditable: boolean;
  selectedPaletteType: PalettePlaceableElementType | null;
  labelText: string;
  selectedElement: LayoutElement | null;
  canRemoveSelected: boolean;
  onSelectPaletteType: (type: PalettePlaceableElementType) => void;
  onClearPaletteSelection: () => void;
  onLabelTextChange: (value: string) => void;
  onRemoveSelected: () => void;
}

export function LayoutElementPalette({
  canUpdate,
  structureEditable,
  selectedPaletteType,
  labelText,
  selectedElement,
  canRemoveSelected,
  onSelectPaletteType,
  onClearPaletteSelection,
  onLabelTextChange,
  onRemoveSelected,
}: LayoutElementPaletteProps) {
  const disabled = !canUpdate || !structureEditable;
  const handleDragStart = (event: DragEvent<HTMLButtonElement>, type: PalettePlaceableElementType) => {
    if (disabled) return;
    event.dataTransfer.setData(LAYOUT_PALETTE_DRAG_MIME, type);
    event.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Element Palette</CardTitle></CardHeader>
      <CardContent className="min-w-0 space-y-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">Perangkat Terkelola</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {['student_pc', 'teacher_pc'].map((type) => (
              <div key={type} className="rounded-lg border border-base-700 bg-base-900/30 p-2 text-center text-xs text-ink-muted">
                <Monitor className="mx-auto mb-1 h-4 w-4 text-accent-content" />
                <p className="font-medium text-ink-secondary">{type === 'student_pc' ? 'PC Siswa' : 'PC Guru'}</p>
                <p className="mt-0.5 text-[10px]">Dikelola dari Data Perangkat</p>
              </div>
            ))}
          </div>
        </div>

        {!structureEditable && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs leading-relaxed text-warning-foreground">
            <Lock className="mr-1 inline h-3.5 w-3.5" /> Template fisik memiliki struktur terkunci. Pengubahan struktur tersedia melalui Custom Editor.
          </div>
        )}

        {GROUPS.map((group) => (
          <div key={group.title}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-ink-muted">{group.title}</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {group.items.map(({ type, icon: Icon }) => {
                const selected = selectedPaletteType === type;
                return (
                  <button
                    key={type}
                    type="button"
                    draggable={!disabled}
                    disabled={disabled}
                    aria-pressed={selected}
                    title={`Pilih ${PALETTE_ELEMENT_DISPLAY_NAMES[type]} untuk ditempatkan`}
                    onClick={() => { if (!disabled) onSelectPaletteType(type); }}
                    onDragStart={(event) => handleDragStart(event, type)}
                    className={cn(
                      'flex min-w-0 flex-col items-center rounded-lg border p-2 text-center text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:cursor-not-allowed disabled:opacity-50',
                      selected ? 'border-accent-content bg-accent-primary/15 text-accent-content' : 'border-base-700 bg-base-900/30 text-ink-secondary hover:border-base-600 hover:bg-base-700/50'
                    )}
                  >
                    <Icon className="mb-1 h-4 w-4" />
                    <span className="leading-tight">{PALETTE_ELEMENT_DISPLAY_NAMES[type]}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}

        {selectedPaletteType && (
          <div className="space-y-2 rounded-lg border border-accent-content/30 bg-accent-primary/10 p-3">
            <p className="text-xs text-ink-secondary">Pilih sel kosong di denah untuk menempatkan <span className="font-semibold text-accent-content">{PALETTE_ELEMENT_DISPLAY_NAMES[selectedPaletteType]}</span>.</p>
            {selectedPaletteType === 'label' && <Input label="Teks label" value={labelText} maxLength={60} onChange={(event) => onLabelTextChange(event.target.value)} placeholder="Maksimal 60 karakter" />}
            <Button size="sm" variant="ghost" className="w-full" icon={<X className="h-3.5 w-3.5" />} onClick={onClearPaletteSelection}>Batalkan pilihan</Button>
          </div>
        )}

        {selectedElement && (
          <div className="space-y-2 border-t border-base-700 pt-3 text-xs">
            <p className="font-semibold text-ink-primary">Elemen dipilih</p>
            <div className="space-y-1 text-ink-muted">
              <p>Jenis: <span className="text-ink-secondary">{TYPE_NAMES[selectedElement.type]}</span></p>
              {selectedElement.label && <p>Label: <span className="text-ink-secondary">{selectedElement.label}</span></p>}
              <p>Posisi: <span className="text-ink-secondary">Baris {selectedElement.row} · Kolom {selectedElement.column}</span></p>
              <p>Status: <span className="text-ink-secondary">{selectedElement.fixed ? 'Fixed' : selectedElement.movable ? 'Movable' : 'Tidak dapat dipindahkan'}</span></p>
            </div>
            {canRemoveSelected && <Button size="sm" variant="danger" className="w-full" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={onRemoveSelected}>Hapus dari denah</Button>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
