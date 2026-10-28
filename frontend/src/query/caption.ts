/**
 * "What am I looking at" (M11): one sentence under each result, built from the question.
 *
 *   Sum of Total per month · Status is paid · last 90 days · top 10
 *   Сумма «Итого» по месяцам · Статус — paid · последние 90 дней · первые 10
 *
 * Column and table names come from the data model through a Namer (src/query/outputs.ts);
 * the sentence is in the UI language. SQL questions say so and show their description.
 * Pure, tested in tests/caption.test.ts.
 */
import type { ColumnType } from '../api';
import { locale, t, tc, tn } from '../i18n/index.ts';
import { prettify } from '../lib/names.ts';
import { formatDate } from '../viz/format.ts';
import { aggregationName, breakoutName } from './draft.ts';
import { aggregationLabel, breakoutLabel, outputLabels, plainNamer } from './outputs.ts';
import type { ColumnName, Namer } from './outputs.ts';
import type { Breakout, Condition, FilterGroup, FilterNode, QuerySpec, RelativeDate } from './types.ts';
import { isGroup } from './types.ts';

const SEP = ' · ';
const lowerFirst = (text: string) => text.charAt(0).toLocaleLowerCase() + text.slice(1);
const quote = (name: string) => tc('quoted', '{name}', { name });

/** "a, b and c" in the UI language. */
function joinList(items: string[], word: 'and' | 'or' = 'and'): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} ${word === 'and' ? t('and') : t('or')} ${items[items.length - 1]}`;
}

const isDateText = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}/.test(v);

function valueText(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'number') return v.toLocaleString(locale());
  if (typeof v === 'boolean') return v ? t('yes') : t('no');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (isDateText(s)) return formatDate(s.replace('T', ' '), 'auto');
  return s.length > 40 ? `${s.slice(0, 39)}…` : s;
}

/** Up to three values, then "or 2 more". */
function valuesText(values: unknown, word: 'or' | 'comma'): string {
  const list = (Array.isArray(values) ? values : [values]).map(valueText);
  if (list.length <= 3) return word === 'or' ? joinList(list, 'or') : list.join(', ');
  const rest = list.length - 3;
  return `${list.slice(0, 3).join(', ')} ${tn(rest, 'or {n} more', 'or {n} more')}`;
}

/** "last 90 days", "last month", "this year" (relative date filters). */
export function relativeText(op: 'last' | 'current', rel: RelativeDate | null | undefined): string {
  const unit = rel?.unit ?? 'day';
  if (op === 'current') {
    return { day: t('today'), week: t('this week'), month: t('this month'), quarter: t('this quarter'), year: t('this year') }[unit];
  }
  const n = Math.max(1, Number(rel?.amount ?? 1) || 1);
  const incl = rel?.include_current;
  let text: string;
  if (n === 1 && !incl) text = { day: t('yesterday'), week: t('last week'), month: t('last month'), quarter: t('last quarter'), year: t('last year') }[unit];
  else
    text = {
      day: () => tn(n, 'last {n} day', 'last {n} days'),
      week: () => tn(n, 'last {n} week', 'last {n} weeks'),
      month: () => tn(n, 'last {n} month', 'last {n} months'),
      quarter: () => tn(n, 'last {n} quarter', 'last {n} quarters'),
      year: () => tn(n, 'last {n} year', 'last {n} years'),
    }[unit]();
  if (!incl) return text;
  const including = { day: t('incl. today'), week: t('incl. this week'), month: t('incl. this month'), quarter: t('incl. this quarter'), year: t('incl. this year') }[unit];
  return `${text} ${including}`;
}

interface FilterContext {
  label: (ref: string) => string;
  /** relative dates name their column only when there are several */
  dateColumns: boolean;
}

function conditionText(c: Condition, ctx: FilterContext): string | null {
  if (!c.ref && !c.expr) return null;
  const column = c.ref ? ctx.label(c.ref) : t('a formula');
  if (c.param) return t('{column}: chosen when it runs', { column });
  const value = valueText(c.value);
  const date = isDateText(c.value);
  switch (c.op) {
    case '=':
      return date ? t('{column} on {value}', { column, value }) : t('{column} is {value}', { column, value });
    case '!=':
      return t('{column} is not {value}', { column, value });
    case '>':
      return date ? t('{column} after {value}', { column, value }) : `${column} > ${value}`;
    case '>=':
      return date ? t('{column} on or after {value}', { column, value }) : `${column} ≥ ${value}`;
    case '<':
      return date ? t('{column} before {value}', { column, value }) : `${column} < ${value}`;
    case '<=':
      return date ? t('{column} on or before {value}', { column, value }) : `${column} ≤ ${value}`;
    case 'between': {
      const [from, to] = Array.isArray(c.value) ? c.value : [];
      return t('{column} between {from} and {to}', { column, from: valueText(from), to: valueText(to) });
    }
    case 'in':
      return t('{column} is {values}', { column, values: valuesText(c.value, 'or') });
    case 'not_in':
      return t('{column} is none of {values}', { column, values: valuesText(c.value, 'comma') });
    case 'is_null':
    case 'is_empty':
      return t('{column} is empty', { column });
    case 'not_null':
    case 'not_empty':
      return t('{column} has a value', { column });
    case 'contains':
      return t('{column} contains “{value}”', { column, value });
    case 'not_contains':
      return t('{column} does not contain “{value}”', { column, value });
    case 'starts_with':
      return t('{column} starts with “{value}”', { column, value });
    case 'ends_with':
      return t('{column} ends with “{value}”', { column, value });
    case 'is_true':
      return t('{column}: yes', { column });
    case 'is_false':
      return t('{column}: no', { column });
    case 'last':
    case 'current': {
      const when = relativeText(c.op, c.value as RelativeDate);
      return ctx.dateColumns ? `${column}: ${when}` : when;
    }
    default:
      return `${column} ${c.op} ${value}`;
  }
}

function nodeText(node: FilterNode, ctx: FilterContext): string | null {
  if (!isGroup(node)) return conditionText(node, ctx);
  const inner = node.rules.map((r) => nodeText(r, ctx)).filter((x): x is string => !!x);
  if (inner.length === 0) return null;
  if (inner.length === 1) return inner[0];
  return `(${inner.join(` ${node.op === 'and' ? t('and') : t('or')} `)})`;
}

/** Parts of the caption for a filter: "and" rules each their own part, "or" rules as one. */
function filterParts(group: FilterGroup | null | undefined, ctx: FilterContext): string[] {
  if (!group || group.rules.length === 0) return [];
  const parts = group.rules.map((r) => nodeText(r, ctx)).filter((x): x is string => !!x);
  if (group.op === 'or' && parts.length > 1) return [parts.join(` ${t('or')} `)];
  return parts;
}

function countRelative(node: FilterNode | null | undefined): number {
  if (!node) return 0;
  if (isGroup(node)) return node.rules.reduce((n, r) => n + countRelative(r), 0);
  return node.op === 'last' || node.op === 'current' ? 1 : 0;
}

// ---------------------------------------------------------------- what is counted

const PER_BUCKET = (): Record<NonNullable<Breakout['bucket']>, string> => ({
  minute: t('per minute'),
  hour: t('per hour'),
  day: t('per day'),
  week: t('per week'),
  month: t('per month'),
  quarter: t('per quarter'),
  year: t('per year'),
});

function perText(b: Breakout, namer: Namer): string {
  if (b.bucket) return PER_BUCKET()[b.bucket] ?? b.bucket;
  const column = namer.column(b.ref).label;
  const per = t('per {column}', { column });
  return b.bin_width ? `${per} (${t('ranges of {n}', { n: b.bin_width })})` : per;
}

const used = (spec: QuerySpec) => ({
  breakouts: (spec.breakouts ?? []).filter((b) => b.ref),
  aggregations: (spec.aggregations ?? []).filter((a) => a.fn === 'count' || a.fn === 'metric' || a.ref),
});

function whatText(spec: QuerySpec, namer: Namer): string {
  const table = namer.table?.(spec.source.table) ?? prettify(spec.source.table);
  const { breakouts, aggregations } = used(spec);
  if (breakouts.length + aggregations.length === 0) {
    const joined = (spec.joins ?? []).filter((j) => j.table).map((j) => quote(namer.table?.(j.table) ?? prettify(j.table)));
    return joined.length ? t('Rows of {table} with {tables}', { table, tables: joinList(joined) }) : t('Rows of {table}', { table });
  }
  if (aggregations.length === 0) return t('Values of {columns}', { columns: joinList(breakouts.map((b) => breakoutLabel(b, namer).label)) });
  const items = aggregations.map((a) => (a.fn === 'count' && !a.ref ? t('Count of {table}', { table }) : aggregationLabel(a, namer).label));
  // "Sum of Total and count of Orders": only the first one starts with a capital (a saved metric keeps its name)
  const what = joinList(items.map((text, i) => (i > 0 && aggregations[i].fn !== 'metric' ? lowerFirst(text) : text)));
  return breakouts.length ? `${what} ${joinList(breakouts.map((b) => perText(b, namer)))}` : what;
}

// ---------------------------------------------------------------- how many

type Kind = 'number' | 'date' | 'other';

const kindOf = (type: ColumnType | undefined): Kind =>
  type === 'number' ? 'number' : type === 'date' || type === 'datetime' ? 'date' : 'other';

function limitText(spec: QuerySpec, namer: Namer, labels: Map<string, ColumnName>): string | null {
  const n = spec.limit;
  if (!n) return null;
  const first = (spec.order ?? []).find((o) => o.ref);
  const rows = tn(n, 'first {n} row', 'first {n} rows');
  if (!first) return rows;
  const { breakouts, aggregations } = used(spec);
  const summarised = breakouts.length + aggregations.length > 0;
  let kind: Kind = 'other';
  let only = false; // sorted by the one number the question counts: "top 10" says it all
  if (summarised) {
    const agg = aggregations.find((a) => (a.alias || aggregationName(a)) === first.ref);
    const brk = breakouts.find((b) => (b.alias || breakoutName(b)) === first.ref);
    if (agg) {
      kind = agg.fn === 'min' || agg.fn === 'max' ? (kindOf(namer.column(agg.ref ?? '').type) === 'date' ? 'date' : 'number') : 'number';
      only = aggregations.length === 1;
    } else if (brk) {
      kind = brk.bucket ? 'date' : brk.bin_width ? 'number' : kindOf(namer.column(brk.ref).type);
    }
  } else {
    kind = kindOf(namer.column(first.ref).type);
  }
  const column = labels.get(first.ref)?.label ?? namer.column(first.ref).label;
  const desc = first.dir === 'desc';
  if (kind === 'number') {
    if (only) return desc ? t('top {n}', { n }) : t('bottom {n}', { n });
    return desc ? t('top {n} by {column}', { n, column }) : t('bottom {n} by {column}', { n, column });
  }
  if (kind === 'date') return desc ? t('latest {n} by {column}', { n, column }) : t('earliest {n} by {column}', { n, column });
  return rows;
}

// ---------------------------------------------------------------- the sentence

/** The caption of a builder question. */
export function questionCaption(spec: QuerySpec, namer: Namer = plainNamer): string {
  const labels = outputLabels(spec, namer);
  const parts = [whatText(spec, namer)];
  const relative = countRelative(spec.filters) > 1;
  parts.push(...filterParts(spec.filters, { label: (ref) => namer.column(ref).label, dateColumns: relative }));
  if (used(spec).breakouts.length + used(spec).aggregations.length > 0) {
    parts.push(...filterParts(spec.having, { label: (ref) => labels.get(ref)?.label ?? ref, dateColumns: countRelative(spec.having) > 1 }));
  }
  const limit = limitText(spec, namer, labels);
  if (limit) parts.push(limit);
  return parts.filter(Boolean).join(SEP);
}

/** The first line of a description, kept short. */
function shortDescription(description: string | null | undefined): string | null {
  const line = (description ?? '').split('\n').map((s) => s.trim()).find(Boolean);
  if (!line) return null;
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/** SQL questions: "Written in SQL · <description>". */
export function sqlCaption(description?: string | null): string {
  return [t('Written in SQL'), shortDescription(description)].filter(Boolean).join(SEP);
}

/** The caption of any saved question (a dashboard card): builder, SQL or several sources. */
export function captionOf(q: { kind?: string | null; spec?: unknown; description?: string | null }, namer: Namer = plainNamer): string | null {
  if (q.kind === 'sql') return sqlCaption(q.description);
  if (q.kind === 'federated') return [t('Combines data from several sources'), shortDescription(q.description)].filter(Boolean).join(SEP);
  const spec = q.spec as QuerySpec | null | undefined;
  if (!spec || typeof spec !== 'object' || !spec.source?.table) return shortDescription(q.description);
  return questionCaption(spec, namer);
}

