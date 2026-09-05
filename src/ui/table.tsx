/**
 * DataTable — search, sort, pagination and selection that compose correctly.
 *
 * Notable behaviours:
 *  - "Select all" in the header selects the CURRENT filtered page only, and
 *    says so; selecting every matching row is a separate, labelled action.
 *  - Below `mobileAt` px the rows become structured record cards instead of
 *    a table nobody can operate with a thumb.
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';
import { Checkbox } from './form';

export interface Column<T> {
  key: string;
  header: string;
  /** Cell content. */
  render: (row: T) => ReactNode;
  /** Sort value; omit to make the column unsortable. */
  sortValue?: (row: T) => string | number;
  align?: 'left' | 'right';
  /** Hidden on narrow screens when the table stays a table. */
  secondary?: boolean;
  width?: string;
}

export interface DataTableProps<T> {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  /** Enables selection and the batch bar. */
  selection?: { selected: Set<string>; onChange: (next: Set<string>) => void };
  onRowClick?: (row: T) => void;
  pageSize?: number;
  empty: ReactNode;
  loading?: boolean;
  caption?: string;
  /** Renders a compact card per row below this width. */
  mobileCard?: (row: T) => ReactNode;
  initialSort?: { key: string; dir: 1 | -1 };
  /** Highlighted row ids, e.g. a just-created record. */
  highlight?: Set<string>;
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  selection,
  onRowClick,
  pageSize = 10,
  empty,
  loading,
  caption,
  mobileCard,
  initialSort,
  highlight,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(initialSort ?? null);
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sortValue) return rows;
    return [...rows].sort((a, b) => {
      const av = col.sortValue!(a);
      const bv = col.sortValue!(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir;
      return String(av).localeCompare(String(bv)) * sort.dir;
    });
  }, [rows, sort, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  // Filtering can shrink the result set under the current page.
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);

  const pageRows = useMemo(
    () => sorted.slice((page - 1) * pageSize, page * pageSize),
    [sorted, page, pageSize],
  );

  const pageIds = pageRows.map(rowKey);
  const allOnPageSelected = pageIds.length > 0 && pageIds.every((id) => selection?.selected.has(id));
  const someOnPageSelected = pageIds.some((id) => selection?.selected.has(id));

  const toggleAllOnPage = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selected);
    for (const id of pageIds) {
      if (checked) next.add(id);
      else next.delete(id);
    }
    selection.onChange(next);
  };

  const toggleSort = (key: string) => {
    setSort((cur) =>
      cur?.key === key ? { key, dir: cur.dir === 1 ? -1 : 1 } : { key, dir: 1 },
    );
    setPage(1);
  };

  if (loading) {
    return (
      <div className="col gap3" style={{ padding: 'var(--s4)' }} aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 20 }} />
        ))}
      </div>
    );
  }

  if (rows.length === 0) return <>{empty}</>;

  return (
    <>
      {mobileCard && (
        <div className="reccards mobile-only">
          {pageRows.map((row) => (
            <div className="reccard" key={rowKey(row)}>
              {mobileCard(row)}
            </div>
          ))}
        </div>
      )}

      <div className={clsx('tbl-wrap', mobileCard && 'desktop-only')}>
        <table className="tbl">
          {caption && <caption className="sr-only">{caption}</caption>}
          <thead>
            <tr>
              {selection && (
                <th className="cell-check">
                  <Checkbox
                    checked={allOnPageSelected}
                    indeterminate={someOnPageSelected}
                    onChange={toggleAllOnPage}
                    ariaLabel={`Select all ${pageIds.length} rows on this page`}
                  />
                </th>
              )}
              {columns.map((col) => {
                const active = sort?.key === col.key;
                const ariaSort = active ? (sort!.dir === 1 ? 'ascending' : 'descending') : 'none';
                return (
                  <th
                    key={col.key}
                    style={{ width: col.width, textAlign: col.align === 'right' ? 'right' : undefined }}
                    className={clsx(col.secondary && 'col-secondary')}
                    aria-sort={col.sortValue ? (ariaSort as 'ascending' | 'descending' | 'none') : undefined}
                  >
                    {col.sortValue ? (
                      <button
                        type="button"
                        className="sort-btn"
                        data-active={active}
                        onClick={() => toggleSort(col.key)}
                      >
                        {col.header}
                        {active ? (
                          sort!.dir === 1 ? (
                            <ArrowUp size={13} aria-hidden />
                          ) : (
                            <ArrowDown size={13} aria-hidden />
                          )
                        ) : (
                          <ArrowUpDown size={13} aria-hidden />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {pageRows.map((row) => {
              const id = rowKey(row);
              const selected = selection?.selected.has(id) ?? false;
              return (
                <tr
                  key={id}
                  data-selected={selected || undefined}
                  className={highlight?.has(id) ? 'row-enter' : undefined}
                >
                  {selection && (
                    <td className="cell-check">
                      <Checkbox
                        checked={selected}
                        onChange={(checked) => {
                          const next = new Set(selection.selected);
                          if (checked) next.add(id);
                          else next.delete(id);
                          selection.onChange(next);
                        }}
                        ariaLabel={`Select row ${id}`}
                      />
                    </td>
                  )}
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={clsx(
                        col.align === 'right' && 'cell-num',
                        col.secondary && 'col-secondary',
                      )}
                      onClick={col.key === 'actions' ? undefined : onRowClick ? () => onRowClick(row) : undefined}
                      style={onRowClick && col.key !== 'actions' ? { cursor: 'pointer' } : undefined}
                    >
                      {col.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > pageSize && (
        <nav className="pagination" aria-label="Pagination">
          <span>
            {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="page-btns">
            <button
              type="button"
              className="page-btn"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Previous page"
            >
              <ChevronLeft size={14} aria-hidden />
            </button>
            {pageNumbers(page, pageCount).map((n, i) =>
              n === '…' ? (
                <span key={`gap-${i}`} className="muted" style={{ padding: '0 4px' }}>
                  …
                </span>
              ) : (
                <button
                  key={n}
                  type="button"
                  className="page-btn"
                  aria-current={n === page ? 'page' : undefined}
                  onClick={() => setPage(n as number)}
                >
                  {n}
                </button>
              ),
            )}
            <button
              type="button"
              className="page-btn"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={page === pageCount}
              aria-label="Next page"
            >
              <ChevronRight size={14} aria-hidden />
            </button>
          </div>
        </nav>
      )}
    </>
  );
}

function pageNumbers(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | '…')[] = [1];
  const from = Math.max(2, current - 1);
  const to = Math.min(total - 1, current + 1);
  if (from > 2) out.push('…');
  for (let i = from; i <= to; i++) out.push(i);
  if (to < total - 1) out.push('…');
  out.push(total);
  return out;
}
