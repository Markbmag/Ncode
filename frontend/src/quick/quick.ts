/**
 * The quick question (M12): one screen for newcomers. Pick a table, then
 *
 *   What do you want to see?   count of rows · sum / average / minimum / maximum of a number · just the rows
 *   Split by                   a column (a related table's name in place of an id) and/or a period
 *   Only where                 a period preset (last quarter ...) and simple conditions
 *   Top N                      the biggest groups only
 *
 * The choices (QuickParts) turn into an ordinary builder question (quickSpec), so the result,
 * the caption, saving and "Open in full editor" all use the same QuerySpec - nothing is lost.
 *
 * Columns of related tables are reached by following foreign keys away from the table (many rows
 * to one: a scrap record's work order, that order's line), never towards it, so joining them never
 * repeats rows and counts and sums stay right. Pure, tested in tests/quick.test.ts.
 */
import type { ColumnType, Relationship, SchemaColumn, SchemaTable } from '../api';
import { descriptionOf, nameOf, pickText } from '../lib/names.ts';
import type { NameMeta } from '../lib/names.ts';
import { columnOptions, summaryOutputs } from '../query/draft.ts';
import type { ColumnOption, SchemaInfo } from '../query/draft.ts';
import { bestPath } from '../query/joins.ts';
import type { Namer } from '../query/outputs.ts';
import type { JoinStep } from '../query/joins.ts';
import type { Aggregation, Bucket, Condition, FieldSel, FilterNode, Join, OrderBy, QuerySpec, RelativeDate } from '../query/types.ts';

// ---------------------------------------------------------------- the columns on offer

export type QuickKind = 'category' | 'number' | 'date';

export interface QuickColumn {
  ref: string;          // "production_lines.name" (every table is in the question under its own name)
  table: string;
  column: string;
  label: string;        // friendly, in the UI language: "Line"
  description: string | null;
  type: ColumnType;
  kind: QuickKind;
  hops: number;         // 0: the table's own column; 1: a table it points to; 2: one further
  via: string[];        // tables passed on the way (their friendly names)
  semantic: string | null;
  /** conditions on it use this column instead (a key column shown by its related name: the name) */
  filterRef?: string;
}

/** One foreign key followed from `from` to `to` (many rows to one). */
interface Hop {
  from: string;
  to: string;
  on: [string, string][]; // ["scrap_records.work_order_id", "work_orders.id"]
}

export interface QuickModel {
  table: string;
  numbers: QuickColumn[];
  dates: QuickColumn[];
  /** own categories, then the names of related tables in place of their ids, then their categories */
  categories: QuickColumn[];
  /** how each related table is reached */
  chains: Record<string, Hop[]>;
}

const MAX_HOPS = 2;
const NOT_A_VALUE = new Set(['id', 'description', 'email', 'url', 'latitude', 'longitude']);
const TEXTY = /(comment|notes?|description|remarks?|text|body|message|e?mail|url|link|address|phone|password|hash|token|uuid|guid)$/i;
const ID_NAME = /(^id$|_id$|^id_|Id$)/;
const CATEGORY_NAME = /(category|type|kind|class|status|state|group|segment|region|country|city|department|shift|line)$/i;
const LABEL_NAME = /^(name|title|label)$/i;
const FIRST_NUMBERS = new Set(['quantity', 'currency', 'percent']);

/** The data model gave it a name (in any language). */
const named = (m: NameMeta | undefined) => !!m && pickText(m.display_name, m.translations, 'display_name') !== null;
/** "Show values as" of a key column in the data model (M12, backend app/semantic/labels.py): the related column shown for its ids. */
const shownAs = (c: SchemaColumn | undefined): string | null => (c as (SchemaColumn & { label_column?: string | null }) | undefined)?.label_column || null;
const usable = (t: SchemaTable, c: SchemaColumn) => !c.hidden && c.type !== 'binary' && !t.primary_key.includes(c.name) && !c.primary_key;
const isFk = (t: SchemaTable, c: SchemaColumn, rels: Relationship[]) => !!c.foreign_key || rels.some((r) => r.from_table === t.name && r.from_columns.includes(c.name));

/** The column that names a row of a table: "Line" for production_lines (data model "name", else a column called name / title / label). */
export function labelColumn(t: SchemaTable): SchemaColumn | null {
  const text = t.columns.filter((c) => usable(t, c) && c.type === 'string' && !c.foreign_key);
  return text.find((c) => c.semantic_type === 'name') ?? text.find((c) => LABEL_NAME.test(c.name) && (!c.semantic_type || c.semantic_type === 'category')) ?? null;
}

/** The table's own columns to split by. When the data model describes the table, its kinds decide. */
function ownCategory(t: SchemaTable, c: SchemaColumn, label: SchemaColumn | null, rels: Relationship[]): boolean {
  if (!usable(t, c) || isFk(t, c, rels) || (c.type !== 'string' && c.type !== 'boolean')) return false;
  if (label && c !== label && /(^|_)code$/i.test(c.name)) return false; // a code next to a name says the same
  if (c.type === 'boolean') return true;
  if (t.columns.some((x) => x.semantic_type)) return c.semantic_type === 'category' || c.semantic_type === 'name';
  return !TEXTY.test(c.name) && !ID_NAME.test(c.name);
}

/** Categories of a related table besides its name: its group, hall, status (codes repeat the name and are left out). */
function relatedCategory(t: SchemaTable, c: SchemaColumn, label: SchemaColumn | null, rels: Relationship[]): boolean {
  if (c === label || !usable(t, c) || isFk(t, c, rels) || c.type !== 'string') return false;
  if (label && /(^|_)code$/i.test(c.name)) return false;
  return c.semantic_type ? c.semantic_type === 'category' : CATEGORY_NAME.test(c.name);
}

function isNumber(t: SchemaTable, c: SchemaColumn, rels: Relationship[]): boolean {
  if (!usable(t, c) || c.type !== 'number' || isFk(t, c, rels)) return false;
  if (c.semantic_type) return !NOT_A_VALUE.has(c.semantic_type);
  return !ID_NAME.test(c.name);
}

/** Tables reached from `source` by following foreign keys away from it, nearest first (in the order of the key columns). */
function walk(schema: SchemaInfo, source: string): Record<string, Hop[]> {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const chains: Record<string, Hop[]> = {};
  let frontier: { table: string; chain: Hop[] }[] = [{ table: source, chain: [] }];
  const seen = new Set([source]);
  for (let depth = 0; depth < MAX_HOPS; depth++) {
    const next: typeof frontier = [];
    for (const { table, chain } of frontier) {
      const t = byName.get(table);
      if (!t) continue;
      const position = (r: Relationship) => t.columns.findIndex((c) => c.name === r.from_columns[0]);
      const out = schema.relationships.filter((r) => r.from_table === table && byName.has(r.to_table)).sort((a, b) => position(a) - position(b));
      for (const r of out) {
        if (seen.has(r.to_table)) continue;
        seen.add(r.to_table);
        const hop: Hop = { from: table, to: r.to_table, on: r.from_columns.map((col, i) => [`${table}.${col}`, `${r.to_table}.${r.to_columns[i]}`]) };
        chains[r.to_table] = [...chain, hop];
        next.push({ table: r.to_table, chain: chains[r.to_table] });
      }
    }
    frontier = next;
  }
  return chains;
}

function entry(t: SchemaTable, c: SchemaColumn, kind: QuickKind, hops: number, via: string[], label = nameOf(c.name, c)): QuickColumn {
  return { ref: `${t.name}.${c.name}`, table: t.name, column: c.name, label, description: descriptionOf(c), type: c.type, kind, hops, via, semantic: c.semantic_type ?? null };
}

/** What the quick question offers for a table: its numbers and dates, and the categories to split by. */
export function quickModel(schema: SchemaInfo, table: string): QuickModel | null {
  const byName = new Map(schema.tables.map((t) => [t.name, t]));
  const source = byName.get(table);
  if (!source) return null;
  const rels = schema.relationships;
  const numbers = source.columns.filter((c) => isNumber(source, c, rels)).map((c) => entry(source, c, 'number', 0, []));
  numbers.sort((a, b) => Number(FIRST_NUMBERS.has(b.semantic ?? '')) - Number(FIRST_NUMBERS.has(a.semantic ?? '')));
  const dates = source.columns.filter((c) => usable(source, c) && (c.type === 'date' || c.type === 'datetime')).map((c) => entry(source, c, 'date', 0, []));
  dates.sort((a, b) => Number(b.semantic === 'created') - Number(a.semantic === 'created'));

  const chains = walk(schema, table);
  const ownLabel = labelColumn(source);
  const own = source.columns.filter((c) => ownCategory(source, c, ownLabel, rels)).map((c) => entry(source, c, 'category', 0, []));
  const labels: QuickColumn[] = [];
  const extras: QuickColumn[] = [];
  for (const [name, chain] of Object.entries(chains)) {
    const t = byName.get(name)!;
    const via = chain.slice(0, -1).map((h) => nameOf(h.to, byName.get(h.to)));
    const last = chain[chain.length - 1];
    const fkTable = byName.get(last.from)!;
    const fkColumn = last.on.length === 1 ? fkTable.columns.find((c) => `${fkTable.name}.${c.name}` === last.on[0][0]) : undefined;
    const label = labelColumn(t);
    const setting = shownAs(fkColumn) ? t.columns.find((c) => c.name === shownAs(fkColumn)) : undefined;
    if (fkColumn && setting) {
      // the data model shows the related name in place of the id ("Show values as"): split by the key column
      // itself, the result shows the names; conditions use the names
      const text = named(fkColumn) ? nameOf(fkColumn.name, fkColumn) : nameOf(t.name, t);
      labels.push({ ...entry(fkTable, fkColumn, 'category', chain.length, via, text), type: setting.type, semantic: setting.semantic_type ?? null, filterRef: `${t.name}.${setting.name}` });
    } else if (label) {
      // a name the data model gave the column, else the key column's ("Responsible"), else the table's
      const text = named(label) ? nameOf(label.name, label) : named(fkColumn) ? nameOf(fkColumn!.name, fkColumn) : nameOf(t.name, t);
      labels.push(entry(t, label, 'category', chain.length, via, text));
    }
    if (chain.length === 1) {
      for (const c of t.columns.filter((col) => relatedCategory(t, col, label, rels))) {
        extras.push(entry(t, c, 'category', 1, via, named(c) ? nameOf(c.name, c) : `${nameOf(t.name, t)} → ${nameOf(c.name, c)}`));
      }
    }
  }
  labels.sort((a, b) => a.hops - b.hops); // stable: the key columns' order within each distance
  // identifiers (order numbers, VINs) have a value per row or nearly: last, for looking one up
  const lookup = (c: QuickColumn) => c.semantic === 'id';
  const categories = [...own, ...labels, ...extras].sort((a, b) => Number(lookup(a)) - Number(lookup(b)));
  // the same name twice ("Name" of two tables): the later ones say their table
  const seen = new Set<string>();
  for (const c of categories) {
    if (seen.has(c.label)) c.label = `${nameOf(c.table, byName.get(c.table))} → ${c.label}`;
    seen.add(c.label);
  }
  return { table, numbers, dates, categories, chains };
}

export const quickColumns = (m: QuickModel): QuickColumn[] => [...m.categories, ...m.numbers, ...m.dates];

/** Names in captions and result headers as the quick question shows them ("Line", not "Production lines → Line"). */
export function quickNamer(base: Namer, m: QuickModel): Namer {
  const byRef = new Map(quickColumns(m).flatMap((c) => [[c.ref, c] as const, ...(c.filterRef ? [[c.filterRef, c] as const] : [])]));
  const own = (ref: string) => byRef.get(ref) ?? null;
  return {
    ...base,
    column: (ref) => {
      const q = own(ref);
      return q ? { label: q.label, description: q.description, type: q.type } : base.column(ref);
    },
    full: (ref) => own(ref)?.label ?? (ref.startsWith(`${m.table}.`) ? base.column(ref).label : (base.full?.(ref) ?? base.column(ref).label)),
  };
}

// ---------------------------------------------------------------- the choices

export type SeeFn = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'rows';
export type DatePreset = 'last_30_days' | 'last_quarter' | 'this_year' | 'last_12_months';
export const DATE_PRESETS: DatePreset[] = ['last_30_days', 'last_quarter', 'this_year', 'last_12_months'];
export const TIME_BUCKETS: Bucket[] = ['day', 'week', 'month', 'quarter', 'year'];

export interface QuickParts {
  table: string;
  see: { fn: SeeFn; ref?: string };
  /** split by this category (a column ref), one row per value */
  category: string | null;
  /** ... and/or by this period of a date column */
  time: { ref: string; bucket: Bucket } | null;
  /** only rows in this period */
  when: { ref: string; preset: DatePreset } | null;
  /** and these conditions (all must match) */
  where: Condition[];
  /** only the N biggest groups (by the value; needs a category) */
  top: number | null;
}

/** A fresh question on a table: the count of its rows. */
export function startParts(table: string): QuickParts {
  return { table, see: { fn: 'count' }, category: null, time: null, when: null, where: [], top: null };
}

export function presetCondition(ref: string, preset: DatePreset): Condition {
  const rel = (amount: number, unit: RelativeDate['unit']): RelativeDate => ({ amount, unit });
  switch (preset) {
    case 'last_30_days':
      return { ref, op: 'last', value: rel(30, 'day') };
    case 'last_quarter':
      return { ref, op: 'last', value: rel(1, 'quarter') };
    case 'this_year':
      return { ref, op: 'current', value: { unit: 'year' } };
    case 'last_12_months':
      return { ref, op: 'last', value: rel(12, 'month') };
  }
}

/** Top N only makes sense for groups of a category with a value to rank them by. */
export const canTop = (p: QuickParts): boolean => p.see.fn !== 'rows' && !!p.category && !p.time;

/** The date column periods and presets work on: the one split by, else the table's main date. */
export function mainDate(p: QuickParts, m: QuickModel): string | null {
  return p.time?.ref ?? p.when?.ref ?? m.dates[0]?.ref ?? null;
}

/** A condition with everything it needs (half-typed ones are left out, as in the builder). */
function complete(c: Condition): boolean {
  if (!c.ref) return false;
  if (['is_true', 'is_false', 'is_null', 'not_null', 'is_empty', 'not_empty'].includes(c.op)) return true;
  if (Array.isArray(c.value)) return c.value.length > 0;
  return c.value !== undefined && c.value !== null && String(c.value).trim() !== '';
}

/** The table of a column reference (the longest table name first: names with dots exist). */
const tableOf = (ref: string, m: QuickModel): string | null =>
  [m.table, ...Object.keys(m.chains)].sort((a, b) => b.length - a.length).find((t) => ref.startsWith(`${t}.`)) ?? null;

/** "production_lines.name" -> the table and the column (value pickers list that column's values). */
export function splitRef(ref: string, m: QuickModel): { table: string; column: string } | null {
  const table = tableOf(ref, m);
  return table ? { table, column: ref.slice(table.length + 1) } : null;
}

/** The joins that bring the related columns in: automatic (foreign keys) where that takes the same way, else spelled out. */
function joinsFor(tables: string[], m: QuickModel, rels: Relationship[]): Join[] {
  const joins: Join[] = [];
  const present = [m.table];
  const needed = [...new Set(tables)].filter((t) => t !== m.table && m.chains[t]).sort((a, b) => m.chains[a].length - m.chains[b].length);
  for (const table of needed) {
    if (present.includes(table)) continue;
    const chain = m.chains[table];
    const start = chain.findIndex((h) => !present.includes(h.to));
    const rest = chain.slice(start);
    const best = bestPath(rels, present, table);
    if (best && sameWay(best, rest)) {
      joins.push({ table, type: 'left' });
      present.push(...best.path.map((s) => s.table));
      continue;
    }
    for (const hop of rest) {
      joins.push({ table: hop.to, type: 'left', on: hop.on.map(([left, right]) => ({ left, right })) });
      present.push(hop.to);
    }
  }
  return joins;
}

function sameWay(best: { from: string; path: JoinStep[] }, rest: Hop[]): boolean {
  if (best.path.length !== rest.length || best.from !== rest[0]?.from) return false;
  return best.path.every((step, i) => step.table === rest[i].to && JSON.stringify(step.on) === JSON.stringify(rest[i].on));
}

/** The builder question for the choices: what runs, what is saved and what the full editor opens. */
export function quickSpec(connection: string, p: QuickParts, m: QuickModel, schema: SchemaInfo): QuerySpec {
  const spec: QuerySpec = { version: 1, connection, source: { table: p.table } };
  const refs: string[] = [];
  const rules: FilterNode[] = [];
  if (p.when) {
    rules.push(presetCondition(p.when.ref, p.when.preset));
    refs.push(p.when.ref);
  }
  for (const c of p.where) {
    if (!complete(c)) continue;
    rules.push(c);
    refs.push(c.ref!);
  }
  let fields: FieldSel[] = [];
  if (p.see.fn === 'rows') {
    // the rows with the names of related rows in place of their ids ("Line", not line_id = 3)
    const source = schema.tables.find((t) => t.name === p.table);
    const labelOf = new Map<string, string>(); // own key column -> the related table's name column
    for (const [name, chain] of Object.entries(m.chains)) {
      const t = schema.tables.find((x) => x.name === name);
      if (!t || chain.length !== 1 || chain[0].on.length !== 1) continue;
      const key = chain[0].on[0][0];
      const setting = shownAs(source?.columns.find((c) => `${p.table}.${c.name}` === key));
      const label = setting && t.columns.some((c) => c.name === setting) ? setting : labelColumn(t)?.name;
      if (label) labelOf.set(key, `${name}.${label}`);
    }
    fields = (source?.columns ?? []).filter((c) => !c.hidden && c.type !== 'binary').map((c) => ({ ref: labelOf.get(`${p.table}.${c.name}`) ?? `${p.table}.${c.name}` }));
    if (labelOf.size > 0) refs.push(...fields.map((f) => f.ref));
  } else {
    const agg: Aggregation = p.see.fn === 'count' || !p.see.ref ? { fn: 'count' } : { fn: p.see.fn, ref: p.see.ref };
    if (agg.ref) refs.push(agg.ref);
    spec.breakouts = [];
    if (p.category) {
      spec.breakouts.push({ ref: p.category });
      refs.push(p.category);
    }
    if (p.time) {
      spec.breakouts.push({ ref: p.time.ref, bucket: p.time.bucket });
      refs.push(p.time.ref);
    }
    if (!spec.breakouts.length) delete spec.breakouts;
    spec.aggregations = [agg];
  }
  const joins = joinsFor(refs.map((r) => tableOf(r, m)).filter((t): t is string => !!t), m, schema.relationships);
  if (joins.length) spec.joins = joins;
  if (joins.length && fields.length) spec.fields = fields; // else every column of the table, as always
  if (rules.length) spec.filters = { op: 'and', rules };
  if (p.top && canTop(p)) {
    const by = valueOutput(spec, columnOptions(spec, schema));
    if (by) {
      spec.order = [{ ref: by, dir: 'desc' }];
      spec.limit = p.top;
    }
  }
  return spec;
}

// ---------------------------------------------------------------- Top N (the quick question and the builder's Summarise step)

type SummaryPart = Pick<QuerySpec, 'aggregations' | 'breakouts'>;
/** The columns that can be picked, as far as the result names need them (their types). */
type Typed = Pick<ColumnOption, 'ref' | 'type'>[];

/** Result names of the complete summary columns, as prepareSpec names them. */
function outputsOf(spec: SummaryPart, options: Typed) {
  const breakouts = (spec.breakouts ?? []).filter((b) => b.ref);
  const aggregations = (spec.aggregations ?? []).filter((a) => a.fn === 'count' || a.fn === 'metric' || a.ref);
  return summaryOutputs({ version: 1, connection: '', source: { table: '' }, breakouts, aggregations }, options as ColumnOption[]);
}

/** The result name of the first value (aggregation) of a summary: what "Top N" ranks by. */
function valueOutput(spec: SummaryPart, options: Typed): string | null {
  return outputsOf(spec, options).find((o) => o.kind === 'aggregation')?.name ?? null;
}

/** The values a summary can rank by: [result name, index of the aggregation]. */
export function rankable(spec: SummaryPart, options: Typed): { name: string; index: number }[] {
  const complete = (spec.aggregations ?? []).map((a, i) => ({ a, i })).filter(({ a }) => a.fn === 'count' || a.fn === 'metric' || a.ref);
  const names = outputsOf(spec, options).filter((o) => o.kind === 'aggregation').map((o) => o.name);
  return complete.map(({ i }, k) => ({ name: names[k], index: i }));
}

/** "Top N by …" as the builder stores it: sorted by one value, biggest first, and a row limit. Null when it is not that. */
export function topNOf(spec: SummaryPart & Pick<QuerySpec, 'order' | 'limit'>, options: Typed): { n: number; by: string } | null {
  const order = spec.order ?? [];
  if (!spec.limit || order.length !== 1 || order[0].dir !== 'desc') return null;
  return rankable(spec, options).some((r) => r.name === order[0].ref) ? { n: spec.limit, by: order[0].ref } : null;
}

/** Sets (n, by) or removes (n null) "Top N by …": the sort and the row limit it consists of. */
export function withTopN(spec: Pick<QuerySpec, 'order' | 'limit'>, n: number | null, by: string | null): { order: OrderBy[]; limit: number | null } {
  if (!n || !by) {
    const current = spec.order ?? [];
    const wasTop = current.length === 1 && current[0].dir === 'desc' && !!spec.limit;
    return { order: wasTop ? [] : current, limit: wasTop ? null : (spec.limit ?? null) };
  }
  return { order: [{ ref: by, dir: 'desc' }], limit: Math.max(1, Math.round(n)) };
}

// ---------------------------------------------------------------- which editor opens for "New question"

export type EditorMode = 'quick' | 'full';
export const EDITOR_PREF = 'question_editor'; // personal settings (GET/PUT /api/account/prefs)

/** ?editor=full|quick wins (links, tests), then the person's own choice, then the quick question. */
export function editorMode(search: string | null, pref: unknown, local: unknown): EditorMode {
  const pick = (v: unknown): EditorMode | null => (v === 'quick' || v === 'full' ? v : null);
  return pick(search) ?? pick(pref) ?? pick(local) ?? 'quick';
}
