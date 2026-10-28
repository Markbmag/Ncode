/**
 * Readable names for the result columns of a builder question (M11): "Sum of Revenue" instead
 * of sum_revenue, "Created at: month" instead of created_at_month, "Count" instead of count.
 * The technical names stay what the server returns and what CSV, chart settings and sorting
 * refer to; these are only shown (result headers, sort pickers, chart axes and legends).
 * Pure, tested in tests/outputs.test.ts.
 */
import type { ColumnType, ResultColumn } from '../api';
import { t } from '../i18n/index.ts';
import { descriptionOf, nameOf, prettify } from '../lib/names.ts';
import type { NameMeta } from '../lib/names.ts';
import { aggregationName, breakoutName } from './draft.ts';
import type { ColumnOption } from './draft.ts';
import type { Aggregation, Breakout, QuerySpec, Transform } from './types.ts';

/** What a column is called and what the data model says about it. */
export interface ColumnName {
  label: string;
  description?: string | null;
  type?: ColumnType; // when known (the builder's column options)
}

/** Turns the column references of one question into friendly names. */
export interface Namer {
  /** the column's own name: "Total" */
  column: (ref: string) => ColumnName;
  /** with its table when the question reads several: "Orders → Total" (raw rows) */
  full?: (ref: string) => string;
  table?: (table: string) => string;
  metric?: (id: number) => (ColumnName & { slug?: string }) | undefined;
}

const lastPart = (ref: string) => ref.split('.').pop() ?? ref;

/** No data model at hand: technical names made readable. */
export const plainNamer: Namer = { column: (ref) => ({ label: prettify(lastPart(ref)) }) };

/** From the builder's column options (they already carry the data model's names and descriptions). */
export function namerFromOptions(options: ColumnOption[], extra: Omit<Namer, 'column' | 'full'> = {}): Namer {
  const byRef = new Map(options.map((o) => [o.ref, o]));
  const counts = new Map<string, number>();
  for (const o of options) counts.set(o.name, (counts.get(o.name) ?? 0) + 1);
  return {
    ...extra,
    column: (ref) => {
      const o = byRef.get(ref) ?? options.find((x) => x.column === ref);
      if (!o) return plainNamer.column(ref);
      // "Id" twice (orders and customers): keep the table so the two can be told apart
      return { label: (counts.get(o.name) ?? 0) > 1 ? o.label : o.name, description: o.description, type: o.type };
    },
    full: (ref) => byRef.get(ref)?.label ?? plainNamer.column(ref).label,
  };
}

/**
 * From the data model alone (GET /api/semantic/{c}/fields and table names), without the schema:
 * what dashboard cards use. `lookup` answers the metadata of a table's column.
 */
export function namerFromModel(spec: QuerySpec, lookup: (table: string, column: string) => NameMeta | null | undefined, extra: Omit<Namer, 'column'> = {}): Namer {
  const aliases = new Map<string, string>([[spec.source.alias || spec.source.table, spec.source.table]]);
  for (const j of spec.joins ?? []) if (j.table) aliases.set(j.alias || j.table, j.table);
  const customs = new Set((spec.expressions ?? []).map((c) => c.name));
  const split = (ref: string): [string, string] => {
    // the longest matching alias first: table names with dots ("a.b") exist
    for (const alias of [...aliases.keys()].sort((a, b) => b.length - a.length)) {
      if (ref.startsWith(`${alias}.`)) return [aliases.get(alias)!, ref.slice(alias.length + 1)];
    }
    const dot = ref.lastIndexOf('.');
    return dot > 0 ? [ref.slice(0, dot), ref.slice(dot + 1)] : [spec.source.table, ref];
  };
  return {
    ...extra,
    column: (ref) => {
      if (customs.has(ref)) return { label: ref };
      const [table, column] = split(ref);
      const meta = lookup(table, column);
      return { label: nameOf(column, meta), description: descriptionOf(meta) };
    },
  };
}

// ---------------------------------------------------------------- one summary column

const BUCKET_WORDS = (): Record<NonNullable<Breakout['bucket']>, string> => ({
  minute: t('minute'),
  hour: t('hour'),
  day: t('day'),
  week: t('week'),
  month: t('month'),
  quarter: t('quarter'),
  year: t('year'),
});

/** "Created at: month", "Total: ranges of 10", "Status". */
export function breakoutLabel(b: Breakout, namer: Namer): ColumnName {
  const col = namer.column(b.ref);
  if (b.bucket) return { label: `${col.label}: ${BUCKET_WORDS()[b.bucket] ?? b.bucket}`, description: col.description };
  if (b.bin_width) return { label: `${col.label}: ${t('ranges of {n}', { n: b.bin_width })}`, description: col.description };
  return col;
}

/** "Sum of Revenue", "Count", "Distinct Customer", a saved metric's name. */
export function aggregationLabel(a: Aggregation, namer: Namer): ColumnName {
  if (a.fn === 'metric') {
    const m = a.metric !== undefined ? namer.metric?.(a.metric) : undefined;
    return m ? { label: m.label, description: m.description } : { label: t('Metric {id}', { id: a.metric ?? '?' }) };
  }
  if (!a.ref) return { label: t('Count') };
  const col = namer.column(a.ref);
  const column = col.label;
  const label = {
    count: () => t('Count of {column}', { column }),
    count_distinct: () => t('Distinct {column}', { column }),
    sum: () => t('Sum of {column}', { column }),
    avg: () => t('Average of {column}', { column }),
    min: () => t('Minimum of {column}', { column }),
    max: () => t('Maximum of {column}', { column }),
  }[a.fn]();
  return { label, description: col.description };
}

const PERIOD_WORDS = (): Record<string, [string, string]> => ({
  // [the earlier value, the change against it]
  day: [t('yesterday'), t('change vs yesterday')],
  week: [t('last week'), t('change vs last week')],
  month: [t('last month'), t('change vs last month')],
  quarter: [t('last quarter'), t('change vs last quarter')],
  year: [t('last year'), t('change vs last year')],
  period: [t('previous row'), t('change vs the previous row')],
});

/** The columns a calculation adds (mirrors backend/app/query/transforms.py output_names). */
function transformOutputs(tf: Transform, base: string): [string, string][] {
  const name = tf.alias || tf.column;
  const own = (fallback: string, label: string): [string, string] => (tf.alias ? [tf.alias, tf.alias] : [fallback, `${base}: ${label}`]);
  switch (tf.type) {
    case 'running_total':
      return [own(`${name}_running_total`, t('running total'))];
    case 'moving_average':
      return [own(`${name}_avg_${tf.window ?? 3}`, t('average of the last {n} rows', { n: tf.window ?? 3 }))];
    case 'pct_change':
      return [own(`${name}_change`, t('% change'))];
    case 'previous_period': {
      const p = tf.period || 'period';
      const [earlier, change] = PERIOD_WORDS()[p] ?? [p, p];
      return [[`${name}_prev_${p}`, `${base}: ${earlier}`], own(`${name}_vs_prev_${p}`, change)];
    }
    case 'rank':
      return [own(`${name}_rank`, t('rank'))];
    case 'pct_of_total':
      return [own(`${name}_pct_of_total`, t('% of total'))];
    default:
      return [own(`${name}_outlier`, t('outlier'))];
  }
}

function unique(name: string, taken: Set<string>): string {
  if (!taken.has(name)) return name;
  let n = 2;
  while (taken.has(`${name}_${n}`)) n++;
  return `${name}_${n}`;
}

/**
 * Result column name -> friendly name, for the spec as it is sent (prepareSpec: summary columns
 * carry their generated name as alias). A name someone typed stays as typed. `options` (the
 * builder's column options) say which columns "every column" means for raw rows.
 */
export function outputLabels(spec: QuerySpec, namer: Namer, options: ColumnOption[] = []): Map<string, ColumnName> {
  const out = new Map<string, ColumnName>();
  const taken = new Set<string>();
  const add = (name: string, label: ColumnName) => {
    const own = unique(name, taken);
    taken.add(own);
    out.set(own, label);
  };
  const breakouts = (spec.breakouts ?? []).filter((b) => b.ref);
  const aggregations = (spec.aggregations ?? []).filter((a) => a.fn === 'count' || a.fn === 'metric' || a.ref);
  const customs = new Set((spec.expressions ?? []).map((c) => c.name));
  // a name is "generated" when it is what the builder would have called the column anyway
  const generated = (alias: string | undefined, auto: string) => !alias || alias === auto || new RegExp(`^${auto.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_\\d+$`).test(alias);

  if (breakouts.length + aggregations.length > 0) {
    for (const b of breakouts) {
      const auto = breakoutName({ ...b, alias: undefined });
      add(b.alias || auto, generated(b.alias, auto) ? breakoutLabel(b, namer) : { label: b.alias!, description: namer.column(b.ref).description });
    }
    for (const a of aggregations) {
      const auto = aggregationName({ ...a, alias: undefined });
      const friendly = aggregationLabel(a, namer);
      // a saved metric is named by its slug: its own name reads better
      const slug = a.fn === 'metric' && a.metric !== undefined ? namer.metric?.(a.metric)?.slug : undefined;
      const own = generated(a.alias, auto) || (a.fn === 'metric' && (!slug || a.alias === slug));
      add(a.alias || auto, own ? friendly : { label: a.alias!, description: friendly.description });
    }
  } else if (spec.fields?.length) {
    for (const f of spec.fields) {
      const auto = customs.has(f.ref) ? f.ref : lastPart(f.ref);
      add(f.alias || auto, f.alias ? { label: f.alias } : { label: namer.full?.(f.ref) ?? namer.column(f.ref).label, description: namer.column(f.ref).description });
    }
  } else {
    for (const o of options) {
      if (customs.has(o.ref)) continue; // custom columns come last, as on the server
      add(o.column, { label: namer.full?.(o.ref) ?? o.label, description: o.description });
    }
    for (const c of spec.expressions ?? []) add(c.name, { label: c.name });
  }

  for (const tf of spec.transforms ?? []) {
    const base = out.get(tf.column)?.label ?? tf.column;
    for (const [name, label] of transformOutputs(tf, base)) add(name, { label, description: out.get(tf.column)?.description });
  }
  return out;
}

/** The result's columns with the friendly names filled in (shown; the names stay as they are). */
export function labelColumns(columns: ResultColumn[], labels: Map<string, ColumnName> | null | undefined): ResultColumn[] {
  if (!labels || labels.size === 0) return columns;
  return columns.map((c) => {
    const own = labels.get(c.name);
    if (!own) return c;
    // the label is already in the UI language; the column's own description too (picked before the translations go)
    return { ...c, display_name: own.label, description: own.description ?? descriptionOf(c), translations: null };
  });
}
