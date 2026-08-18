import { useEffect, useState } from 'react';
import { Lock, RotateCw } from 'lucide-react';
import type { Device, LaboratoryLayoutType, LayoutElement, LayoutRotation } from '@/types';
import {
  LAYOUT_ELEMENT_LABEL_MAX_LENGTH,
  LAYOUT_ELEMENT_ROTATIONS,
  LAYOUT_ELEMENT_TYPE_DISPLAY_NAMES,
  getLayoutElementPropertyCapabilities,
  getLayoutElementGeometryCapabilities,
  type LayoutElementPropertyPatch,
} from '@/domain/laboratory-layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Select } from '@/components/ui/Input';

interface LayoutElementInspectorProps {
  layoutType: LaboratoryLayoutType;
  selectedElement: LayoutElement | null;
  selectedDevice?: Device;
  layoutRows: number;
  layoutColumns: number;
  canUpdate: boolean;
  onApply: (patch: LayoutElementPropertyPatch) => void;
  onApplyGeometry: (rowSpan: number, columnSpan: number) => void;
}

type PositionMode = 'locked' | 'movable' | 'immovable';

function getPositionMode(element: LayoutElement | null): PositionMode {
  if (element?.fixed) return 'locked';
  if (element?.movable) return 'movable';
  return 'immovable';
}

export function LayoutElementInspector({ layoutType, selectedElement, selectedDevice, layoutRows, layoutColumns, canUpdate, onApply, onApplyGeometry }: LayoutElementInspectorProps) {
  const [label, setLabel] = useState('');
  const [rotation, setRotation] = useState<LayoutRotation>(0);
  const [rowSpan, setRowSpan] = useState('1');
  const [columnSpan, setColumnSpan] = useState('1');
  const [positionMode, setPositionMode] = useState<PositionMode>('immovable');
  const [positionModeTouched, setPositionModeTouched] = useState(false);

  useEffect(() => {
    setLabel(selectedElement?.label ?? '');
    setRotation(selectedElement?.rotation ?? 0);
    setRowSpan(String(selectedElement?.rowSpan ?? 1));
    setColumnSpan(String(selectedElement?.columnSpan ?? 1));
    setPositionMode(getPositionMode(selectedElement));
    setPositionModeTouched(false);
  }, [selectedElement]);

  const capabilities = selectedElement ? getLayoutElementPropertyCapabilities({ layoutType }, selectedElement) : null;
  const geometryCapabilities = selectedElement ? getLayoutElementGeometryCapabilities({ layoutType }, selectedElement) : null;
  const reason = !capabilities?.editable
    ? capabilities?.reason === 'property_edit_not_custom'
      ? 'Ubah denah menjadi Custom untuk mengedit properti elemen.'
      : capabilities?.reason === 'device_element_managed'
        ? 'Elemen PC dikelola dari Data Perangkat dan hanya ditampilkan sebagai informasi.'
        : capabilities?.reason === 'empty_element_not_editable'
          ? 'Sel kosong tidak memiliki properti yang dapat diedit.'
          : selectedElement ? 'Jenis elemen ini belum mendukung pengeditan properti.' : null
    : null;
  const geometryReason = geometryCapabilities?.reason === 'device_geometry_managed'
    ? 'Ukuran PC dikelola sebagai 1 × 1.'
    : geometryCapabilities?.reason === 'geometry_not_custom'
      ? 'Ubah denah menjadi Custom untuk mengedit ukuran elemen.'
      : geometryCapabilities?.reason === 'fixed_single_cell'
        ? 'Jenis elemen ini menggunakan ukuran tetap 1 × 1.'
        : null;

  return (
    <Card className="min-w-0">
      <CardHeader><CardTitle>Properti Elemen</CardTitle></CardHeader>
      <CardContent className="min-w-0 space-y-4">
        {!selectedElement ? (
          <p className="text-xs leading-relaxed text-ink-muted">Klik elemen pada denah untuk melihat propertinya.</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2 text-xs text-ink-muted">
              <span>Jenis</span><span className="min-w-0 break-words text-right text-ink-secondary">{LAYOUT_ELEMENT_TYPE_DISPLAY_NAMES[selectedElement.type]}</span>
              <span>Posisi</span><span className="min-w-0 break-words text-right text-ink-secondary">Baris {selectedElement.row}, Kolom {selectedElement.column}</span>
              <span>Rotasi</span><span className="min-w-0 text-right text-ink-secondary">{selectedElement.rotation}°</span>
              <span>Status</span><span className="min-w-0 break-words text-right text-ink-secondary">{selectedElement.fixed ? 'Terkunci' : selectedElement.movable ? 'Dapat dipindahkan' : 'Tidak dapat dipindahkan'}</span>
              <span>Rentang</span><span className="min-w-0 text-right text-ink-secondary">{selectedElement.rowSpan} × {selectedElement.columnSpan}</span>
              {selectedElement.referenceId && <><span>Referensi</span><span className="min-w-0 truncate text-right text-ink-secondary" title={selectedElement.referenceId}>{selectedElement.referenceId}</span></>}
              {selectedDevice && <><span>Perangkat</span><span className="min-w-0 break-words text-right text-ink-secondary">{selectedDevice.positionCode} · {selectedDevice.hostname}</span></>}
            </div>

            {reason && <p className="rounded-lg border border-base-700 bg-base-900/30 p-3 text-xs leading-relaxed text-ink-muted">{reason}</p>}

            {capabilities?.editable && (
              <div className="space-y-3 border-t border-base-700 pt-3">
                {capabilities.labelEditable && (
                  <Input
                    label={selectedElement.type === 'label' ? 'Teks label' : 'Label (opsional)'}
                    value={label}
                    maxLength={LAYOUT_ELEMENT_LABEL_MAX_LENGTH}
                    disabled={!canUpdate}
                    onChange={(event) => setLabel(event.target.value)}
                    hint={`Maksimal ${LAYOUT_ELEMENT_LABEL_MAX_LENGTH} karakter`}
                  />
                )}
                {capabilities.rotationEditable && (
                  <Select
                    label="Rotasi visual"
                    value={String(rotation)}
                    disabled={!canUpdate}
                    onChange={(event) => setRotation(Number(event.target.value) as LayoutRotation)}
                    options={LAYOUT_ELEMENT_ROTATIONS.map((value) => ({ value: String(value), label: `${value}°` }))}
                  />
                )}
                {capabilities.lockEditable && (
                  <Select
                    label="Status posisi"
                    value={positionMode}
                    disabled={!canUpdate}
                    onChange={(event) => {
                      setPositionMode(event.target.value as PositionMode);
                      setPositionModeTouched(true);
                    }}
                    options={[
                      { value: 'movable', label: 'Dapat dipindahkan' },
                      { value: 'locked', label: 'Terkunci' },
                      ...(!selectedElement.fixed && !selectedElement.movable ? [{ value: 'immovable', label: 'Tidak dapat dipindahkan' }] : []),
                    ]}
                  />
                )}
                <Button
                  size="sm"
                  className="w-full"
                  disabled={!canUpdate}
                  icon={positionMode === 'locked' ? <Lock className="h-3.5 w-3.5" /> : <RotateCw className="h-3.5 w-3.5" />}
                  onClick={() => onApply({
                    ...(capabilities.labelEditable ? { label } : {}),
                    ...(capabilities.rotationEditable ? { rotation } : {}),
                    ...(capabilities.lockEditable && positionModeTouched && positionMode !== 'immovable' ? { locked: positionMode === 'locked' } : {}),
                  })}
                >
                  Terapkan Properti ke Draft
                </Button>
              </div>
            )}
            <div className="space-y-3 border-t border-base-700 pt-3">
              <p className="text-sm font-medium text-ink-secondary">Ukuran Elemen</p>
              {geometryCapabilities?.resizable ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 2xl:grid-cols-1">
                    <Input
                      label="Rentang Baris"
                      type="number"
                      min={1}
                      max={layoutRows - selectedElement.row + 1}
                      step={1}
                      value={rowSpan}
                      disabled={!canUpdate}
                      onChange={(event) => setRowSpan(event.target.value)}
                    />
                    <Input
                      label="Rentang Kolom"
                      type="number"
                      min={1}
                      max={layoutColumns - selectedElement.column + 1}
                      step={1}
                      value={columnSpan}
                      disabled={!canUpdate}
                      onChange={(event) => setColumnSpan(event.target.value)}
                    />
                  </div>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="w-full"
                    disabled={!canUpdate}
                    onClick={() => onApplyGeometry(Number(rowSpan), Number(columnSpan))}
                  >
                    Terapkan Ukuran ke Draft
                  </Button>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-ink-muted">{geometryReason}</p>
              )}
            </div>
            {!canUpdate && <p className="text-xs text-warning-foreground">Mode hanya baca. Properti dan ukuran tidak dapat diterapkan.</p>}
          </>
        )}
      </CardContent>
    </Card>
  );
}
