/**
 * Metric definitions in the metric dialog (Data model → Metrics), ratio metrics included (M12):
 * "Scrap rate" = sum of scrapped pieces ÷ sum of (good + scrapped pieces). Pure functions;
 * tested in tests/ratio.test.ts.
 */
import type { Expr, FilterGroup } from '../query/types.ts';
import type { MetricDefinition, MetricPart, TotalFn } from './api.ts';

/** One total in the dialog: of one column, of several columns added up, or of a formula set up through the API. */
export interface TotalDraft {
  fn: TotalFn;
  columns: string[];   // "table.column"; two or more are added up row by row (good + scrapped pieces)
  formula?: Expr;      // any other formula (kept as it is until a column is picked)
  where: FilterGroup;  // only these rows count for this total
}

export const NEEDS_NO_COLUMN: TotalFn[] = ['count'];
export const ADDABLE: TotalFn[] = ['sum', 'avg']; // totals where "+ another column" makes sense

export const emptyGroup = (): FilterGroup => ({ op: 'and', rules: [] });

/** A bare column name of a metric means the metric's own table. */
export const qualify = (ref: string, table: string): string => (ref.includes('.') ? ref : `${table}.${ref}`);

/** Conditions without a column are left out; an empty group is no condition. */
export function cleanWhere(group: FilterGroup | null | undefined): FilterGroup | null {
  if (!group) return null;
  const rules = group.rules.filter((r) => ('rules' in r ? r.rules.length > 0 : !!r.ref));
  return rules.length ? { ...group, rules } : null;
}

/** a + b + c as an expression (left to right). */
export function plusOf(refs: string[]): Expr {
  return refs.slice(1).reduce<Expr>((acc, ref) => ({ op: '+', args: [acc, { ref }] }), { ref: refs[0] });
}

/** The columns of a + b + c, or null for any other formula. */
export function columnsOfPlus(expr: Expr, table: string): string[] | null {
  if ('ref' in expr) return [qualify(expr.ref, table)];
  if (!('op' in expr) || expr.op !== '+') return null;
  const left = columnsOfPlus(expr.args[0], table);
  const right = columnsOfPlus(expr.args[1], table);
  return left && right ? [...left, ...right] : null;
}

export function draftOf(part: MetricPart | undefined, table: string, fallback: TotalFn = 'sum'): TotalDraft {
  if (!part) return { fn: fallback, columns: [], where: emptyGroup() };
  const where = part.where ?? emptyGroup();
  if (part.ref) return { fn: part.fn, columns: [qualify(part.ref, table)], where };
  if (part.expr) {
    const columns = columnsOfPlus(part.expr, table);
    return columns ? { fn: part.fn, columns, where } : { fn: part.fn, columns: [], formula: part.expr, where };
  }
  return { fn: part.fn, columns: [], where };
}

export function needsColumn(fn: TotalFn): boolean {
  return !NEEDS_NO_COLUMN.includes(fn);
}

/** Can it be saved: a column (or the kept formula) for every total that needs one. */
export function draftReady(d: TotalDraft): boolean {
  return !needsColumn(d.fn) || d.columns.some(Boolean) || !!d.formula;
}

export function partOf(d: TotalDraft): MetricPart {
  const part: MetricPart = { fn: d.fn };
  const columns = d.columns.filter(Boolean);
  if (needsColumn(d.fn)) {
    if (columns.length > 1 && ADDABLE.includes(d.fn)) part.expr = plusOf(columns);
    else if (columns.length > 0) part.ref = columns[0];
    else if (d.formula) part.expr = d.formula;
  }
  const where = cleanWhere(d.where);
  if (where) part.where = where;
  return part;
}

/** What the dialog saves: one total, or one total divided by another. */
export function definitionOf(kind: 'total' | 'ratio', total: TotalDraft, numerator: TotalDraft, denominator: TotalDraft, where: FilterGroup): MetricDefinition {
  const shared = cleanWhere(where);
  if (kind === 'ratio') {
    return { fn: 'ratio', numerator: partOf(numerator), denominator: partOf(denominator), ...(shared ? { where: shared } : {}) };
  }
  return partOf({ ...total, where }); // one total: the dialog's "Only rows where…" is its condition
}

export function definitionReady(kind: 'total' | 'ratio', total: TotalDraft, numerator: TotalDraft, denominator: TotalDraft): boolean {
  return kind === 'ratio' ? draftReady(numerator) && draftReady(denominator) : draftReady(total);
}

/**
 * The question behind the dialog's live example: the metric over all rows of its table, and for a
 * ratio its two totals too ("2.4 % = 1,234 ÷ 51,000"). Run like any question (row rules apply).
 */
export function exampleSpec(connection: string, table: string, definition: MetricDefinition): Record<string, unknown> {
  const aggregations: Record<string, unknown>[] = [{ ...definition, alias: 'value' }];
  if (definition.fn === 'ratio' && definition.numerator && definition.denominator) {
    const both = definition.where ?? null;
    const within = (part: MetricPart) => {
      if (!both) return part;
      return { ...part, where: part.where ? { op: 'and', rules: [both, part.where] } : both };
    };
    aggregations.push({ ...within(definition.numerator), alias: 'top' }, { ...within(definition.denominator), alias: 'bottom' });
  }
  return { version: 1, connection, source: { table }, aggregations, limit: 1 };
}

/** The example's numbers from its result row: [value, top?, bottom?] as numbers (null when empty). */
export function exampleValues(row: unknown[] | undefined): { value: number | null; top: number | null; bottom: number | null } {
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v);
    return null;
  };
  return { value: num(row?.[0]), top: num(row?.[1]), bottom: num(row?.[2]) };
}
