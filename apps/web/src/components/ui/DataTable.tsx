import { type ReactNode, useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, ArrowUpDown, ArrowUp, ArrowDown, Search } from 'lucide-react';
import { cn } from '@/utils';
import { Input } from './Input';
import { EmptyState } from './States';

export interface Column<T> {
  key: string;
  header: string;
  render?: (row: T) => ReactNode;
  sortable?: boolean;
  sortValue?: (row: T) => string | number;
  className?: string;
  width?: string;
  printHidden?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  searchable?: boolean;
  searchPlaceholder?: string;
  searchKeys?: (row: T) => string;
  pageSize?: number;
  emptyTitle?: string;
  emptyDescription?: string;
  initialSort?: { key: string; dir: 'asc' | 'desc' };
  compact?: boolean;
  toolbar?: ReactNode;
}

export function DataTable<T>({
  columns,
  data,
  rowKey,
  onRowClick,
  searchable,
  searchPlaceholder = 'Cari...',
  searchKeys,
  pageSize = 10,
  emptyTitle = 'Tidak ada data',
  emptyDescription,
  initialSort,
  compact,
  toolbar,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' } | null>(initialSort ?? null);
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    if (!search || !searchKeys) return data;
    const q = search.toLowerCase();
    return data.filter((row) => searchKeys(row).toLowerCase().includes(q));
  }, [data, search, searchKeys]);

  const sorted = useMemo(() => {
    if (!sort) return filtered;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return filtered;
    const vals = filtered.map((r) => col.sortValue!(r));
    const idx = filtered.map((_, i) => i);
    idx.sort((a, b) => {
      const va = vals[a];
      const vb = vals[b];
      if (va < vb) return sort.dir === 'asc' ? -1 : 1;
      if (va > vb) return sort.dir === 'asc' ? 1 : -1;
      return 0;
    });
    return idx.map((i) => filtered[i]);
  }, [filtered, sort, columns]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, totalPages);
  const paged = sorted.slice((current - 1) * pageSize, current * pageSize);

  function toggleSort(key: string) {
    setSort((s) => {
      if (!s || s.key !== key) return { key, dir: 'asc' };
      if (s.dir === 'asc') return { key, dir: 'desc' };
      return null;
    });
  }

  return (
    <div className="data-table-root space-y-3">
      {(searchable || toolbar) && (
        <div className="data-table-toolbar flex flex-wrap items-center gap-2 justify-between">
          {searchable && (
            <div className="w-full sm:w-64">
              <Input icon={<Search className="h-4 w-4" />} placeholder={searchPlaceholder} value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
            </div>
          )}
          {toolbar && <div className="flex flex-wrap items-center gap-2 ml-auto">{toolbar}</div>}
        </div>
      )}
      <div className="data-table-scroll overflow-x-auto rounded-xl border border-base-700/70 bg-base-800/60">
        <table className="data-table-table w-full text-sm">
          <thead>
            <tr className="border-b border-base-700/70 bg-base-800/80">
              {columns.map((col) => (
                <th
                  key={col.key}
                  className={cn('px-4 py-3 text-left font-semibold text-ink-secondary whitespace-nowrap', compact && 'py-2', col.className, col.printHidden && 'print-hidden')}
                  style={col.width ? { width: col.width } : undefined}
                >
                  {col.sortable ? (
                    <button
                      onClick={() => toggleSort(col.key)}
                      className="inline-flex items-center gap-1 hover:text-ink-primary"
                    >
                      {col.header}
                      {sort?.key === col.key ? (
                        sort.dir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
                      ) : (
                        <ArrowUpDown className="h-3 w-3 opacity-50" />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {paged.length === 0 ? (
              <tr>
                <td colSpan={columns.length}>
                  <EmptyState title={emptyTitle} description={emptyDescription} className="py-10" />
                </td>
              </tr>
            ) : (
              paged.map((row) => (
                <tr
                  key={rowKey(row)}
                  onClick={() => onRowClick?.(row)}
                  className={cn(
                    'border-b border-base-700/40 transition-colors last:border-0',
                    onRowClick && 'cursor-pointer hover:bg-base-700/30',
                    compact && 'text-xs'
                  )}
                >
                  {columns.map((col) => (
                    <td key={col.key} className={cn('px-4 py-3 text-ink-secondary', compact && 'py-2', col.className, col.printHidden && 'print-hidden')}>
                      {col.render ? col.render(row) : String((row as Record<string, unknown>)[col.key] ?? '')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {sorted.length > pageSize && (
        <div className="data-table-pagination flex items-center justify-between text-xs text-ink-muted">
          <span>
            Menampilkan {(current - 1) * pageSize + 1}–{Math.min(current * pageSize, sorted.length)} dari {sorted.length}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={current === 1}
              className="rounded-lg p-1.5 hover:bg-base-700 disabled:opacity-40"
              aria-label="Halaman sebelumnya"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="px-2 font-medium text-ink-primary">
              {current} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={current === totalPages}
              className="rounded-lg p-1.5 hover:bg-base-700 disabled:opacity-40"
              aria-label="Halaman berikutnya"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
