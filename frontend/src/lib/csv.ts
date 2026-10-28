export type CsvDelimiter = ';' | ',';

/**
 * Spreadsheet formula injection guard (OWASP CSV injection advice, same rule as
 * the backend's app/explore.py): text starting with = + - @ tab or CR gets a
 * leading apostrophe so Excel shows it instead of running it - also
 * "-2+3+cmd|' /C calc'!A0", which starts like a number. Plain numbers such as
 * -12.5 or +1e3 stay numbers.
 */
const FORMULA_START = /^[=+\-@\t\r]/;
const PLAIN_NUMBER = /^[+-]?(?:\d+(?:[.,]\d*)?|[.,]\d+)(?:[eE][+-]?\d+)?$/;

export function neutralize(text: string): string {
  return FORMULA_START.test(text) && !PLAIN_NUMBER.test(text) ? `'${text}` : text;
}

export function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return neutralize(value);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return neutralize(JSON.stringify(value));
}

function escapeCell(text: string, delimiter: CsvDelimiter): string {
  const needsQuotes = text.includes(delimiter) || /["\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

export function buildCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  delimiter: CsvDelimiter,
): string {
  const lines = [columns.map((c) => escapeCell(c, delimiter)).join(delimiter)];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(cellToString(row[c]), delimiter)).join(delimiter));
  }
  return lines.join('\r\n') + '\r\n';
}

/** Hands a Blob to the browser as a file download. */
export function saveBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Saves text as a file. A UTF-8 BOM makes Excel open Cyrillic correctly. */
export function downloadText(filename: string, text: string): void {
  saveBlob(filename, new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' }));
}

export function safeFilename(...parts: string[]): string {
  const name = parts
    .map((p) => p.trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_');
  return (name || 'export').slice(0, 120);
}

/** CSV from a result envelope (rows as arrays; duplicate column names are fine). */
export function buildCsvFromArrays(columns: string[], rows: unknown[][], delimiter: CsvDelimiter): string {
  const lines = [columns.map((c) => escapeCell(c, delimiter)).join(delimiter)];
  for (const row of rows) lines.push(row.map((v) => escapeCell(cellToString(v), delimiter)).join(delimiter));
  return lines.join('\r\n') + '\r\n';
}
