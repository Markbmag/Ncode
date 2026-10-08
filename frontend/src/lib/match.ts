import type { MatchMode } from '../api';

export interface Segment {
  text: string;
  match: boolean;
}

/** Splits `text` into pieces so the parts that matched `phrase` can be highlighted. */
export function splitByMatch(text: string, phrase: string, mode: MatchMode, caseSensitive: boolean): Segment[] {
  const plain = [{ text, match: false }];
  if (!phrase || !text) return plain;

  const hay = caseSensitive ? text : text.toLowerCase();
  const needle = caseSensitive ? phrase : phrase.toLowerCase();
  // Some characters change length when lower-cased; indexes would drift, so don't highlight.
  if (hay.length !== text.length) return plain;

  if (mode === 'exact') {
    return hay === needle ? [{ text, match: true }] : plain;
  }
  if (mode === 'starts_with') {
    return hay.startsWith(needle)
      ? [{ text: text.slice(0, needle.length), match: true }, { text: text.slice(needle.length), match: false }].filter(
          (s) => s.text,
        )
      : plain;
  }

  const segments: Segment[] = [];
  let cursor = 0;
  let index = hay.indexOf(needle, cursor);
  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), match: false });
    segments.push({ text: text.slice(index, index + needle.length), match: true });
    cursor = index + needle.length;
    index = hay.indexOf(needle, cursor);
  }
  if (segments.length === 0) return plain;
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });
  return segments;
}
