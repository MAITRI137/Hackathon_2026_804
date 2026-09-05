/** CSV export and printable-document helpers. No dependency, no server round-trip. */

function escapeCell(value: unknown): string {
  const s = value == null ? '' : String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: Record<string, unknown>[], preamble: string[] = []): string {
  if (rows.length === 0) return `${preamble.join('\n')}\n`;
  const headers = Object.keys(rows[0]);
  const lines = [
    ...preamble,
    headers.join(','),
    ...rows.map((r) => headers.map((h) => escapeCell(r[h])).join(',')),
  ];
  return `${lines.join('\n')}\n`;
}

export function downloadCsv(
  filename: string,
  rows: Record<string, unknown>[],
  preamble: string[] = [],
): void {
  downloadBlob(filename, new Blob([toCsv(rows, preamble)], { type: 'text/csv;charset=utf-8' }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoke on the next tick so the download has certainly started.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Print a specific element as a document.
 *
 * The page carries print styles that hide the shell, so `window.print()` on
 * the payslip route yields a clean, paginated, text-selectable PDF through the
 * browser's own print-to-PDF. The server produces the same document with
 * pdf-lib for bulk delivery.
 */
export function printDocument(): void {
  window.print();
}
