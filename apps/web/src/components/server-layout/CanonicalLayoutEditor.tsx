import { useRef, useState } from 'react';
import { Box, ChevronLeft, ChevronRight, MonitorUp, Search, Trash2 } from 'lucide-react';
import {
  addDevicePlacement,
  addStructuralElement,
  editorChildKey,
  moveDevicePlacement,
  moveStructuralElement,
  removeDevicePlacement,
  removeStructuralElement,
  resizeDevicePlacement,
  resizeLayout,
  resizeStructuralElement,
  updateDevicePlacement,
  updateLayoutProperties,
  updateStructuralElement,
  type CanonicalLayoutEditorState,
  type LayoutDeviceMetadataById,
  type LayoutEditorResult,
} from '@/domain/server-layout';
import { Button } from '@/components/ui/Button';
import { Card, CardContent, CardHeader } from '@/components/ui/Card';
import { Input, Select } from '@/components/ui/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ui/States';
import { LayoutGrid, type LayoutGridSelection } from './LayoutGrid';
import { placementRoleOptions, visibleUnplacedCandidates } from '@/lib/layoutPage';
import {
  type DevicePlacementRole,
  type LayoutPaginationMeta,
  type LayoutRotation,
  type StructuralLayoutElementType,
  type UnplacedDeviceCandidateDto,
} from '@/services/layoutApi';

const STRUCTURAL_OPTIONS: Array<{ value: StructuralLayoutElementType; label: string }> = [
  { value: 'teacher_desk', label: 'Meja Guru' },
  { value: 'door', label: 'Pintu' },
  { value: 'window', label: 'Jendela' },
  { value: 'wall', label: 'Dinding' },
  { value: 'aisle', label: 'Lorong' },
  { value: 'label', label: 'Label' },
];

type PlacementTool = { kind: 'structural'; type: StructuralLayoutElementType } | { kind: 'device'; candidate: UnplacedDeviceCandidateDto } | null;

interface UnplacedPanelState {
  status: 'disabled' | 'loading' | 'error' | 'ready';
  data: UnplacedDeviceCandidateDto[];
  meta: LayoutPaginationMeta | null;
  message?: string;
}

interface CanonicalLayoutEditorProps {
  editor: CanonicalLayoutEditorState;
  editable: boolean;
  metadataById: LayoutDeviceMetadataById;
  unplaced: UnplacedPanelState;
  unplacedSearch: string;
  onUnplacedSearchChange: (value: string) => void;
  onUnplacedSearch: () => void;
  onUnplacedPage: (page: number) => void;
  onRetryUnplaced: () => void;
  onEditorChange: (editor: CanonicalLayoutEditorState) => void;
  onMetadata: (candidate: UnplacedDeviceCandidateDto) => void;
  showUnplacedPanel?: boolean;
  metadataLoadingIds?: ReadonlySet<string>;
  metadataErrors?: Readonly<Record<string, string>>;
  canResolveDeviceMetadata?: boolean;
  onDevicePlacementSelect?: (deviceId: string) => void;
}

export function CanonicalLayoutEditor({
  editor,
  editable,
  metadataById,
  unplaced,
  unplacedSearch,
  onUnplacedSearchChange,
  onUnplacedSearch,
  onUnplacedPage,
  onRetryUnplaced,
  onEditorChange,
  onMetadata,
  showUnplacedPanel = true,
  metadataLoadingIds = new Set(),
  metadataErrors = {},
  canResolveDeviceMetadata = false,
  onDevicePlacementSelect,
}: CanonicalLayoutEditorProps) {
  const [selection, setSelection] = useState<LayoutGridSelection>(null);
  const [tool, setTool] = useState<PlacementTool>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const nextKey = useRef(0);

  function apply(result: LayoutEditorResult) {
    if (!result.ok) {
      setOperationError(result.message);
      return false;
    }
    setOperationError(null);
    onEditorChange(result.state);
    return true;
  }

  function selectedItem() {
    if (!selection) return null;
    return selection.kind === 'structural'
      ? editor.structuralElements.find((item) => editorChildKey(item) === selection.key) ?? null
      : editor.devicePlacements.find((item) => editorChildKey(item) === selection.key) ?? null;
  }

  function onEmptyCell(row: number, column: number) {
    if (!editable) return;
    if (tool?.kind === 'structural') {
      nextKey.current += 1;
      const clientKey = `structure-${Date.now()}-${nextKey.current}`;
      const result = addStructuralElement(editor, {
        clientKey,
        type: tool.type,
        label: tool.type === 'label' ? 'Label' : null,
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        rotation: 0,
      });
      if (apply(result)) {
        setSelection({ kind: 'structural', key: clientKey });
        setTool(null);
      }
      return;
    }
    if (tool?.kind === 'device') {
      nextKey.current += 1;
      const clientKey = `placement-${Date.now()}-${nextKey.current}`;
      const result = addDevicePlacement(editor, tool.candidate, {
        clientKey,
        role: null,
        label: null,
        row,
        column,
        rowSpan: 1,
        columnSpan: 1,
        rotation: 0,
      });
      if (apply(result)) {
        onMetadata(tool.candidate);
        setSelection({ kind: 'device', key: clientKey });
        setTool(null);
      }
      return;
    }
    if (selection?.kind === 'structural') apply(moveStructuralElement(editor, selection.key, { row, column }));
    if (selection?.kind === 'device') apply(moveDevicePlacement(editor, selection.key, { row, column }));
  }

  const selected = selectedItem();
  const selectedStructural = selection?.kind === 'structural'
    ? editor.structuralElements.find((item) => editorChildKey(item) === selection.key) ?? null
    : null;
  const selectedDevice = selection?.kind === 'device'
    ? editor.devicePlacements.find((item) => editorChildKey(item) === selection.key) ?? null
    : null;
  const visibleCandidates = unplaced.status === 'ready' ? visibleUnplacedCandidates(unplaced.data, editor) : [];
  const placingLabel = tool?.kind === 'structural'
    ? STRUCTURAL_OPTIONS.find(({ value }) => value === tool.type)?.label ?? tool.type
    : tool?.candidate.deviceCode ?? null;

  function updateSelectedGeometry(field: 'row' | 'column' | 'rowSpan' | 'columnSpan', value: number) {
    if (!selection || !selected) return false;
    if (field === 'row' || field === 'column') {
      const target = { row: selected.row, column: selected.column, [field]: value };
      return apply(selection.kind === 'structural'
        ? moveStructuralElement(editor, selection.key, target)
        : moveDevicePlacement(editor, selection.key, target));
    }
    const size = { rowSpan: selected.rowSpan, columnSpan: selected.columnSpan, [field]: value };
    return apply(selection.kind === 'structural'
      ? resizeStructuralElement(editor, selection.key, size)
      : resizeDevicePlacement(editor, selection.key, size));
  }

  function removeSelected() {
    if (!selection) return;
    const result = selection.kind === 'structural'
      ? removeStructuralElement(editor, selection.key)
      : removeDevicePlacement(editor, selection.key);
    if (apply(result)) setSelection(null);
  }

  return (
    <div className="space-y-4">
      {operationError && <div role="alert" className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{operationError}</div>}
      <div className="grid gap-4 xl:grid-cols-[15rem_minmax(0,1fr)_17rem]">
        <div className="space-y-4">
          <Card>
            <CardHeader><h3 className="text-sm font-semibold text-ink-primary">Properti denah</h3></CardHeader>
            <CardContent className="space-y-3">
              <Input label="Nama" value={editor.name} disabled={!editable} maxLength={255} onChange={(event) => apply(updateLayoutProperties(editor, { name: event.target.value }))} />
              <Input label="Provenance template" value={editor.templateKey ?? ''} disabled={!editable} maxLength={100} onChange={(event) => apply(updateLayoutProperties(editor, { templateKey: event.target.value.trim() === '' ? null : event.target.value }))} />
              <div className="grid grid-cols-2 gap-2">
                <Input key={`rows-${editor.rows}`} label="Baris" type="number" min={1} max={50} defaultValue={editor.rows} disabled={!editable} onBlur={(event) => { if (!apply(resizeLayout(editor, { rows: Number(event.target.value), columns: editor.columns }))) event.currentTarget.value = String(editor.rows); }} />
                <Input key={`columns-${editor.columns}`} label="Kolom" type="number" min={1} max={50} defaultValue={editor.columns} disabled={!editable} onBlur={(event) => { if (!apply(resizeLayout(editor, { rows: editor.rows, columns: Number(event.target.value) }))) event.currentTarget.value = String(editor.columns); }} />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><h3 className="text-sm font-semibold text-ink-primary">Elemen struktural</h3></CardHeader>
            <CardContent className="grid grid-cols-2 gap-2">
              {STRUCTURAL_OPTIONS.map((option) => (
                <Button
                  key={option.value}
                  type="button"
                  size="sm"
                  variant={tool?.kind === 'structural' && tool.type === option.value ? 'primary' : 'secondary'}
                  disabled={!editable}
                  onClick={() => { setTool({ kind: 'structural', type: option.value }); setSelection(null); }}
                >{option.label}</Button>
              ))}
            </CardContent>
          </Card>
        </div>

        <LayoutGrid
          editor={editor}
          metadataById={metadataById}
          selection={selection}
          editable={editable}
          placingLabel={placingLabel}
          onSelect={(next) => {
            setSelection(next);
            setTool(null);
            if (next?.kind === 'device') {
              const placement = editor.devicePlacements.find((item) => editorChildKey(item) === next.key);
              if (placement && !metadataById[placement.deviceId]) onDevicePlacementSelect?.(placement.deviceId);
            }
          }}
          onEmptyCell={onEmptyCell}
        />

        <div className="space-y-4">
          <Card>
            <CardHeader><h3 className="text-sm font-semibold text-ink-primary">Properti pilihan</h3></CardHeader>
            <CardContent className="space-y-3">
              {!selected || !selection ? (
                <p className="text-xs text-ink-muted">Pilih elemen atau Device pada grid.</p>
              ) : (
                <>
                  {selection.kind === 'structural' && selectedStructural && (
                    <>
                      <Select
                        label="Tipe"
                        value={selectedStructural.type}
                        disabled={!editable}
                        options={STRUCTURAL_OPTIONS}
                        onChange={(event) => {
                          const type = event.target.value as StructuralLayoutElementType;
                          apply(updateStructuralElement(editor, selection.key, {
                            type,
                            label: type === 'aisle' ? null : type === 'label' ? (selectedStructural.label ?? 'Label') : selectedStructural.label,
                          }));
                        }}
                      />
                      <Input
                        label="Label"
                        value={selectedStructural.label ?? ''}
                        disabled={!editable || selectedStructural.type === 'aisle'}
                        maxLength={60}
                        onChange={(event) => apply(updateStructuralElement(editor, selection.key, { label: event.target.value.trim() === '' ? null : event.target.value }))}
                      />
                    </>
                  )}
                  {selection.kind === 'device' && selectedDevice && (
                    <>
                      <Input
                        label="Label"
                        value={selectedDevice.label ?? ''}
                        disabled={!editable}
                        maxLength={60}
                        onChange={(event) => apply(updateDevicePlacement(editor, selection.key, { label: event.target.value.trim() === '' ? null : event.target.value }))}
                      />
                      <Select
                        label="Role"
                        value={selectedDevice.role ?? ''}
                        disabled={!editable || !metadataById[selectedDevice.deviceId]}
                        options={placementRoleOptions(metadataById[selectedDevice.deviceId]?.deviceType, selectedDevice.role)}
                        onChange={(event) => apply(updateDevicePlacement(
                          editor,
                          selection.key,
                          { role: (event.target.value || null) as DevicePlacementRole },
                          metadataById[selectedDevice.deviceId]?.deviceType,
                        ))}
                      />
                      {!metadataById[selectedDevice.deviceId] && metadataLoadingIds.has(selectedDevice.deviceId) && (
                        <p role="status" className="text-xs text-ink-muted">Memuat metadata Device canonical untuk pilihan role...</p>
                      )}
                      {!metadataById[selectedDevice.deviceId] && metadataErrors[selectedDevice.deviceId] && (
                        <p role="alert" className="text-xs text-danger">{metadataErrors[selectedDevice.deviceId]}</p>
                      )}
                      {!metadataById[selectedDevice.deviceId] && !metadataLoadingIds.has(selectedDevice.deviceId) && !metadataErrors[selectedDevice.deviceId] && (
                        <p className="text-xs text-ink-muted">{canResolveDeviceMetadata ? 'Pilih kembali Device untuk memuat jenis canonical.' : 'Role tidak dapat diubah tanpa izin devices.view; editing lain tetap tersedia.'}</p>
                      )}
                    </>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    {(['row', 'column', 'rowSpan', 'columnSpan'] as const).map((field) => (
                      <Input
                        key={`${field}-${selected[field]}`}
                        label={{ row: 'Baris', column: 'Kolom', rowSpan: 'Tinggi', columnSpan: 'Lebar' }[field]}
                        type="number"
                        min={1}
                        max={50}
                        defaultValue={selected[field]}
                        disabled={!editable}
                        onBlur={(event) => { const before = selected[field]; if (!updateSelectedGeometry(field, Number(event.target.value))) event.currentTarget.value = String(before); }}
                      />
                    ))}
                  </div>
                  <Select
                    label="Rotasi"
                    value={selected.rotation}
                    disabled={!editable}
                    options={[0, 90, 180, 270].map((value) => ({ value: String(value), label: `${value}°` }))}
                    onChange={(event) => {
                      const rotation = Number(event.target.value) as LayoutRotation;
                      apply(selection.kind === 'structural'
                        ? updateStructuralElement(editor, selection.key, { rotation })
                        : updateDevicePlacement(editor, selection.key, { rotation }));
                    }}
                  />
                  <Button type="button" variant="danger" size="sm" icon={<Trash2 className="h-4 w-4" />} disabled={!editable} onClick={removeSelected}>Hapus dari denah</Button>
                </>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      {showUnplacedPanel && <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div><h3 className="text-sm font-semibold text-ink-primary">Device belum ditempatkan</h3><p className="text-xs text-ink-muted">Sumber canonical dari endpoint Layout server.</p></div>
            {unplaced.status !== 'disabled' && (
              <form className="flex w-full max-w-sm gap-2" onSubmit={(event) => { event.preventDefault(); onUnplacedSearch(); }}>
                <Input aria-label="Cari Device belum ditempatkan" value={unplacedSearch} maxLength={100} placeholder="Kode, hostname, merek..." onChange={(event) => onUnplacedSearchChange(event.target.value)} />
                <Button type="submit" size="icon" variant="secondary" aria-label="Cari Device"><Search className="h-4 w-4" /></Button>
              </form>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {unplaced.status === 'disabled' && <EmptyState icon={<MonitorUp className="h-6 w-6" />} title="Panel Device tidak tersedia" description="Izin devices.view diperlukan untuk membaca kandidat Device server." className="py-6" />}
          {unplaced.status === 'loading' && <LoadingState label="Memuat kandidat Device..." className="py-6" />}
          {unplaced.status === 'error' && <ErrorState message={unplaced.message ?? 'Kandidat Device gagal dimuat.'} onRetry={onRetryUnplaced} className="py-6" />}
          {unplaced.status === 'ready' && visibleCandidates.length === 0 && <EmptyState icon={<Box className="h-6 w-6" />} title="Tidak ada kandidat pada halaman ini" description="Device yang sudah ditempatkan secara lokal disembunyikan hingga draft disimpan." className="py-6" />}
          {unplaced.status === 'ready' && visibleCandidates.length > 0 && (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {visibleCandidates.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  disabled={!editable}
                  className="rounded-lg border border-base-700 bg-base-800 p-3 text-left transition hover:border-accent-content/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50"
                  onClick={() => { setTool({ kind: 'device', candidate }); setSelection(null); }}
                >
                  <span className="block text-sm font-semibold text-ink-primary">{candidate.deviceCode}</span>
                  <span className="mt-1 block text-xs text-ink-muted">{candidate.hostname ?? candidate.deviceType} · {candidate.lifecycleStatus}</span>
                </button>
              ))}
            </div>
          )}
          {unplaced.status === 'ready' && unplaced.meta && (
            <div className="mt-4 flex items-center justify-between gap-3 text-xs text-ink-muted">
              <span>Halaman {unplaced.meta.page} dari {unplaced.meta.lastPage} · {unplaced.meta.total} kandidat</span>
              <div className="flex gap-2">
                <Button type="button" size="icon" variant="secondary" aria-label="Halaman kandidat sebelumnya" disabled={unplaced.meta.page <= 1} onClick={() => onUnplacedPage(unplaced.meta!.page - 1)}><ChevronLeft className="h-4 w-4" /></Button>
                <Button type="button" size="icon" variant="secondary" aria-label="Halaman kandidat berikutnya" disabled={unplaced.meta.page >= unplaced.meta.lastPage} onClick={() => onUnplacedPage(unplaced.meta!.page + 1)}><ChevronRight className="h-4 w-4" /></Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>}
    </div>
  );
}
