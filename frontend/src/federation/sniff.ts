/**
 * Suggestions for the upload dialog from the first bytes of a text file - the same rules the
 * server uses for "detect automatically" (app/federation/datasets.py), so the dialog can show
 * what it will do: Russian Excel exports are Windows-1251, separated by ";" and use a decimal comma.
 */
export type SniffEncoding = 'utf-8' | 'windows-1251' | 'windows-1252' | 'utf-16';
export type SniffNumbers = 'point' | 'comma';

export interface Sniffed {
  encoding: SniffEncoding;
  delimiter: 'comma' | 'semicolon' | 'tab' | 'pipe';
  numberFormat: SniffNumbers;
}

export const SNIFF_BYTES = 256 * 1024;

const COMMA_NUMBER = /^[-+]?(?:\d{1,3}(?:[ \u00a0\u202f]\d{3})+(?:,\d+)?|\d+,\d+)$/;
const POINT_NUMBER = /^[-+]?\d+\.\d+$/;
const DELIMS = { comma: ',', semicolon: ';', tab: '\t', pipe: '|' } as const;

/** Most words with non-ASCII letters are all Cyrillic (Western text read as Windows-1251 mixes scripts). */
export function looksCyrillic(text: string): boolean {
  // eslint-disable-next-line no-control-regex
  const words = (text.match(/\p{L}+/gu) ?? []).filter((w) => /[^\x00-\x7f]/.test(w));
  if (words.length === 0) return false;
  const cyrillic = words.filter((w) => /^[\u0400-\u04ff]+$/.test(w)).length;
  return cyrillic >= 0.6 * words.length;
}

export function detectEncoding(bytes: Uint8Array, complete: boolean): SniffEncoding {
  if ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)) return 'utf-16';
  try {
    // a sample cut inside a character is fine: stream mode leaves the tail undecoded
    new TextDecoder('utf-8', { fatal: true }).decode(bytes, { stream: !complete });
    return 'utf-8';
  } catch {
    return looksCyrillic(new TextDecoder('windows-1251').decode(bytes)) ? 'windows-1251' : 'windows-1252';
  }
}

export function sniffNumbers(text: string, delimiter: string): SniffNumbers {
  if (delimiter !== ';') return 'point';
  let comma = 0;
  let point = 0;
  for (const line of text.split(/\r\n|\n|\r/).filter((l) => l.trim()).slice(0, 500)) {
    for (const cell of line.split(';')) {
      const value = cell.trim().replace(/^"|"$/g, '').trim();
      if (COMMA_NUMBER.test(value)) comma++;
      else if (POINT_NUMBER.test(value)) point++;
    }
  }
  return comma > 0 && point === 0 ? 'comma' : 'point';
}

export function sniffText(bytes: Uint8Array, complete: boolean): Sniffed {
  const encoding = detectEncoding(bytes, complete);
  const text = new TextDecoder(encoding).decode(bytes);
  const first = text.split(/\r\n|\n|\r/).find((l) => l.trim()) ?? '';
  const count = (ch: string) => first.split(ch).length - 1;
  let delimiter: Sniffed['delimiter'] = 'comma';
  for (const key of ['semicolon', 'tab', 'pipe'] as const) if (count(DELIMS[key]) > count(DELIMS[delimiter])) delimiter = key;
  return { encoding, delimiter, numberFormat: sniffNumbers(text, DELIMS[delimiter]) };
}

/** The first SNIFF_BYTES of a file, sniffed; null when it cannot be read. */
export async function sniffFile(file: Blob): Promise<Sniffed | null> {
  try {
    const bytes = new Uint8Array(await file.slice(0, SNIFF_BYTES).arrayBuffer());
    return sniffText(bytes, file.size <= SNIFF_BYTES);
  } catch {
    return null;
  }
}
