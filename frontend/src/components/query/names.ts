// Names people give in the builder: custom columns and result columns (aggregation aliases).
// Letters of any language are allowed (M10: Cyrillic was rejected / silently dropped); the server
// quotes these names as identifiers on every engine.

/** A custom column name: starts with a letter or _, then letters, digits, _ and spaces; at most 64. */
export const CUSTOM_COLUMN_NAME = /^[\p{L}_][\p{L}\p{N}_ ]{0,63}$/u;

export function validCustomColumnName(name: string): boolean {
  return CUSTOM_COLUMN_NAME.test(name.trim());
}

/** What is kept of a typed result column name: letters, digits, _ and inner spaces; undefined when empty. */
export function cleanResultName(text: string): string | undefined {
  const kept = text.replace(/[^\p{L}\p{N}_ ]/gu, '').replace(/^ +/, '').replace(/ {2,}/g, ' ').slice(0, 64);
  return kept || undefined;
}
