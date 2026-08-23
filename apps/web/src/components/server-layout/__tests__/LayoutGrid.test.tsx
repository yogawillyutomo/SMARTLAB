import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { LayoutGrid } from '@/components/server-layout/LayoutGrid';
import { CanonicalLayoutEditor } from '@/components/server-layout/CanonicalLayoutEditor';
import { layoutEditorStateFromServer } from '@/domain/server-layout';
import type { LayoutDto } from '@/services/layoutApi';

const NOW = '2026-08-24T10:00:00.000Z';
const layout: LayoutDto = {
  id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', schoolId: '01ARZ3NDEKTSV4RRFFQ69G5FAW', laboratoryId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
  name: 'Draft', templateKey: null, rows: 2, columns: 3, status: 'draft', version: 1,
  structuralElements: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAA', type: 'teacher_desk', label: null, row: 1, column: 1, rowSpan: 1, columnSpan: 2, rotation: 0 }],
  devicePlacements: [{ id: '01ARZ3NDEKTSV4RRFFQ69G5FAB', deviceId: '01ARZ3NDEKTSV4RRFFQ69G5FAC', role: null, label: null, row: 2, column: 3, rowSpan: 1, columnSpan: 1, rotation: 0 }],
  activatedAt: null, archivedAt: null, createdAt: NOW, updatedAt: NOW,
};

describe('canonical sparse Layout grid', () => {
  it('renders only unoccupied cells as accessible buttons and preserves multi-cell footprints', () => {
    const markup = renderToStaticMarkup(
      <LayoutGrid
        editor={layoutEditorStateFromServer(layout)}
        metadataById={{}}
        selection={null}
        editable
        placingLabel="Dinding"
        onSelect={vi.fn()}
        onEmptyCell={vi.fn()}
      />,
    );
    expect(markup.match(/aria-label="Sel kosong/g)).toHaveLength(3);
    expect(markup).toContain('grid-column:1 / span 2');
    expect(markup).toContain('Meja Guru');
    expect(markup).toContain('Device •');
    expect(markup).not.toContain('type="empty"');
  });

  it('renders all six structural tools and server-authoritative paginated candidates', () => {
    const editor = layoutEditorStateFromServer({ ...layout, structuralElements: [], devicePlacements: [] });
    const desktop = { id: '01ARZ3NDEKTSV4RRFFQ69G5FAD', deviceCode: 'DEV-001', deviceType: 'desktop_pc' as const, lifecycleStatus: 'in_service' as const, hostname: 'PC-01', brand: null, model: null };
    const printer = { ...desktop, id: '01ARZ3NDEKTSV4RRFFQ69G5FAE', deviceCode: 'DEV-PRN', deviceType: 'printer' as const };
    const markup = renderToStaticMarkup(
      <CanonicalLayoutEditor
        editor={editor}
        editable
        metadataById={{}}
        unplaced={{ status: 'ready', data: [desktop, printer], meta: { page: 2, perPage: 10, total: 12, lastPage: 2 } }}
        unplacedSearch="PC"
        onUnplacedSearchChange={vi.fn()}
        onUnplacedSearch={vi.fn()}
        onUnplacedPage={vi.fn()}
        onRetryUnplaced={vi.fn()}
        onEditorChange={vi.fn()}
        onMetadata={vi.fn()}
      />,
    );
    for (const label of ['Meja Guru', 'Pintu', 'Jendela', 'Dinding', 'Lorong', 'Label']) expect(markup).toContain(label);
    expect(markup).toContain('DEV-001');
    expect(markup).toContain('DEV-PRN');
    expect(markup).toContain('value="PC"');
    expect(markup).toContain('Halaman 2 dari 2 · 12 kandidat');
  });

  it('does not eagerly resolve Device details while rendering existing placements', () => {
    const onDevicePlacementSelect = vi.fn();
    renderToStaticMarkup(
      <CanonicalLayoutEditor
        editor={layoutEditorStateFromServer(layout)}
        editable
        metadataById={{}}
        unplaced={{ status: 'disabled', data: [], meta: null }}
        unplacedSearch=""
        onUnplacedSearchChange={vi.fn()}
        onUnplacedSearch={vi.fn()}
        onUnplacedPage={vi.fn()}
        onRetryUnplaced={vi.fn()}
        onEditorChange={vi.fn()}
        onMetadata={vi.fn()}
        canResolveDeviceMetadata
        onDevicePlacementSelect={onDevicePlacementSelect}
      />,
    );
    expect(onDevicePlacementSelect).not.toHaveBeenCalled();
  });

  it('keeps read-only grid items keyboard-addressable while disabling empty-cell mutation', () => {
    const markup = renderToStaticMarkup(
      <LayoutGrid editor={layoutEditorStateFromServer(layout)} metadataById={{}} selection={null} editable={false} placingLabel={null} onSelect={vi.fn()} onEmptyCell={vi.fn()} />,
    );
    expect(markup).toContain('aria-label="Meja Guru, baris 1, kolom 1"');
    expect(markup).toContain('aria-label="Sel kosong baris 1, kolom 3"');
    expect(markup).toContain('disabled=""');
  });
});
