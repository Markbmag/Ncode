export type CsvDelimiter = ';' | ',';

/**
 * Spreadsheet formula injection guard: a text cell that starts with = @ or a
 * sign followed by something that is not a number would be executed by Excel.
 * Such cells get a leading apostrophe. Plain numbers and phone numbers
 * like "+7 (999) 123" are left alone.
 */
function neutralize(text: string): string {
  return /^(?:[=@\t\r]|[+-](?![\d\s.()-]))/.test(text) ? `'${text}` : text;
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

/** Saves text as a file. A UTF-8 BOM makes Excel open Cyrillic correctly. */
export function downloadText(filename: string, text: string): void {
  const blob = new Blob(['\uFEFF', text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function safeFilename(...parts: string[]): string {
  const name = parts
    .map((p) => p.trim().replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, ''))
    .filter(Boolean)
    .join('_');
  return (name || 'export').slice(0, 120);
}
