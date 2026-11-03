/**
 * Value pickers (M12): the helpers behind src/components/query/ValuePicker.tsx without React -
 * the list typed into the box ("a, b, c"), how one value reads ("3 · Paint line"), the values
 * picked lately per column (localStorage) and which table and column a filter's reference names.
 * The values themselves come from GET /api/connections/{key}/values (backend/app/query/values.py),
 * through the same permissions and row rules as any question.
 * Unit-tested in tests/valuePicker.test.ts.
 */
import type { ColumnType } from '../api';
import { queryTables } from './draft.ts';
import type { SchemaInfo } from './draft.ts';
import type { QuerySpec } from './types.ts';

/** The column whose values are offered. */
export interface ValueSource {
  connection: string;
  table: string;
  column: string;
  type?: ColumnType;
}

export type Scalar = string | number | boolean;

/** One entry of a value list: the value, the related table's name for it (ids), how many rows have it. */
export interface ValueOption {
  value: Scalar;
  label?: string | null;
  count?: number;
}

export interface ValueList {
  values: ValueOption[];
  label: { table: string; key: string; label: string } | null;
  truncated: boolean;
  cached?: boolean;
}

/** Column types a list of values makes sense for (dates get a calendar). */
export const LISTABLE: ColumnType[] = ['string', 'number', 'boolean', 'unknown'];
/** Filter operators that compare with whole values. */
export const PICKER_OPS = ['=', '!=', 'in', 'not_in'];

export const canPick = (type: ColumnType | undefined): boolean => LISTABLE.includes(type ?? 'unknown');

/** "3 · Paint line" for an id with a name, else the value itself. */
export function optionText(o: ValueOption): string {
  const value = String(o.value);
  return o.label && o.label !== value ? `${value} · ${o.label}` : value;
}

export const sameValue = (a: unknown, b: unknown): boolean => String(a) === String(b);

/** "a, b , ,c" -> ["a", "b", "c"] */
export const splitList = (text: string): string[] =>
  text
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** Typed values as sent: numbers stay numbers in a number column. */
export const typedValues = (text: string, type?: ColumnType): Scalar[] =>
  splitList(text).map((s) => (type === 'number' && !Number.isNaN(Number(s)) ? Number(s) : s));

export const listText = (values: unknown[]): string => values.map(String).join(', ');

/** What the list is narrowed to: nothing until something is typed; in a list, the part after the last comma. */
export function searchTerm(text: string, multiple: boolean, typed: boolean): string {
  if (!typed) return '';
  return (multiple ? (text.split(',').pop() ?? '') : text).trim();
}

/**
 * Picking a value in a list (multiple): it is added, or taken out when it is in already. The
 * letters typed to find it (after the last comma) are replaced by it.
 */
export function pickInList(text: string, value: Scalar, typed: boolean, type?: ColumnType): Scalar[] {
  const parts = text.split(',');
  const last = (parts[parts.length - 1] ?? '').trim();
  const kept = typed && last && !sameValue(last, value) ? parts.slice(0, -1).join(',') : text;
  const values = typedValues(kept, type);
  return values.some((v) => sameValue(v, value)) ? values.filter((v) => !sameValue(v, value)) : [...values, value];
}

/** The name of each chosen value that has one, from a loaded list. */
export function labelsOf(values: unknown[], list: ValueOption[] | undefined): string[] {
  if (!list) return [];
  const out: string[] = [];
  for (const v of values) {
    const found = list.find((o) => sameValue(o.value, v));
    if (found?.label) out.push(found.label);
  }
  return out;
}

// ---------------------------------------------------------------- recent values per column

const RECENT_KEY = 'ncode_recent_values';
const PER_COLUMN = 8;
const COLUMNS = 50;

interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

const columnKey = (s: ValueSource) => JSON.stringify([s.connection, s.table, s.column]);

function readAll(store: KeyValueStore | null): Record<string, Scalar[]> {
  try {
    const raw = store?.getItem(RECENT_KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : {};
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, Scalar[]>) : {};
  } catch {
    return {}; // private mode, corrupted JSON: recent values are a convenience only
  }
}

/** The values picked lately in this column, the latest first. */
export function recentValues(source: ValueSource, store: KeyValueStore | null = defaultStore()): Scalar[] {
  const found = readAll(store)[columnKey(source)];
  return Array.isArray(found) ? found.filter((v) => ['string', 'number', 'boolean'].includes(typeof v)).slice(0, PER_COLUMN) : [];
}

/** Remember values picked in a column (at most 8 per column, the 50 columns used last). */
export function rememberValues(source: ValueSource, values: unknown[], store: KeyValueStore | null = defaultStore()): void {
  const picked = values.filter((v): v is Scalar => ['string', 'number', 'boolean'].includes(typeof v) && String(v).trim() !== '');
  if (!store || picked.length === 0) return;
  const all = readAll(store);
  const key = columnKey(source);
  const merged = [...picked.reverse(), ...(all[key] ?? [])].filter((v, i, list) => list.findIndex((x) => sameValue(x, v)) === i);
  delete all[key]; // the column used last goes to the end
  all[key] = merged.slice(0, PER_COLUMN);
  const keys = Object.keys(all);
  for (const old of keys.slice(0, Math.max(0, keys.length - COLUMNS))) delete all[old];
  try {
    store.setItem(RECENT_KEY, JSON.stringify(all));
  } catch {
    // quota: never mind
  }
}

// ---------------------------------------------------------------- the column behind a filter

/** The real table and column a reference of the question names ("alias.column" or a unique column name); null for formulas. */
export function valueSourceOf(spec: QuerySpec, schema: SchemaInfo | null, ref: string | undefined): ValueSource | null {
  if (!ref || !schema) return null;
  const tables = queryTables(spec, schema);
  const columnOf = (table: string, name: string) =>
    schema.tables.find((t) => t.name === table)?.columns.find((c) => c.name === name || c.name.toLowerCase() === name.toLowerCase());
  for (const qt of [...tables].sort((a, b) => b.alias.length - a.alias.length)) {
    if (!ref.toLowerCase().startsWith(`${qt.alias.toLowerCase()}.`)) continue;
    const col = columnOf(qt.table, ref.slice(qt.alias.length + 1));
    if (col) return { connection: spec.connection, table: qt.table, column: col.name, type: col.type };
  }
  if ((spec.expressions ?? []).some((e) => e.name === ref)) return null;
  const hits = tables.map((qt) => [qt.table, columnOf(qt.table, ref)] as const).filter(([, c]) => c);
  if (hits.length !== 1) return null;
  const [table, col] = hits[0];
  return { connection: spec.connection, table, column: col!.name, type: col!.type };
}
