/**
 * Suggest a chart from the shape of a result, and say why in one short line (M12):
 *   one number                       -> Number (KPI)           "Number: one value"
 *   a date + numbers                 -> Line (a second text column -> one line per value)
 *   a category + numbers             -> Bar (pie is never the default: bars compare better)
 *   two text columns + one number    -> Bar split by the second (few values) or Heatmap
 *   two or three numbers, no labels  -> Scatter
 *   anything else                    -> Table
 * chartFit() tells which chart types cannot show a result at all, with the reason (the chart
 * type picker greys them out). Pure, tested in tests/viz.test.ts.
 */
import type { ResultColumn } from '../api';
import { t as tr } from '../i18n/index.ts';
import { MAX_SERIES } from './palette.ts';
import type { Table } from './data.ts';
import { columnTitle } from './labels.ts';
import type { ChartType, VizSpec } from './types.ts';

const isTime = (c: ResultColumn) => c.type === 'date' || c.type === 'datetime';
const isNum = (c: ResultColumn) => c.type === 'number';

function distinct(t: Table, name: string): number {
  const i = t.columns.findIndex((c) => c.name === name);
  return new Set(t.rows.map((r) => String(r[i]))).size;
}

/** The automatic chart and the reason for it ("Line chart: one date and one number"). */
export function chooseViz(t: Table): { spec: VizSpec; reason: string } {
  const spec = pickViz(t);
  if (spec.type !== 'table') return { spec, reason: vizReason(spec, t.columns) ?? '' };
  if (t.rows.length === 0 || t.columns.length === 0) return { spec, reason: tr('Table: no rows to draw') };
  if (!t.columns.some(isNum)) return { spec, reason: tr('Table: no numbers to compare') };
  return { spec, reason: tr('Table: too many rows or columns for a clear chart') };
}

function pickViz(t: Table): VizSpec {
  const base = { version: 1 as const };
  if (t.rows.length === 0 || t.columns.length === 0) return { ...base, type: 'table' };
  const measures = t.columns.filter((c) => isNum(c) && c.role === 'measure');
  const numbers = measures.length > 0 ? measures : t.columns.filter(isNum);
  const dims = t.columns.filter((c) => !numbers.includes(c));

  if (t.rows.length === 1 && numbers.length === 1 && dims.length <= 1) return { ...base, type: 'kpi', value: numbers[0].name };
  if (numbers.length === 0) return { ...base, type: 'table' };

  const time = dims.find(isTime);
  const text = dims.filter((c) => !isTime(c));

  if (time && dims.length === 1) {
    return { ...base, type: 'line', x: time.name, series: numbers.slice(0, MAX_SERIES).map((c) => ({ y: c.name })) };
  }
  if (time && dims.length === 2 && text.length === 1 && distinct(t, text[0].name) <= MAX_SERIES) {
    return { ...base, type: 'line', x: time.name, breakout: text[0].name, series: [{ y: numbers[0].name }] };
  }
  if (dims.length === 1 && t.rows.length <= 200) {
    return { ...base, type: 'bar', x: dims[0].name, series: numbers.slice(0, MAX_SERIES).map((c) => ({ y: c.name })) };
  }
  if (dims.length === 2 && numbers.length === 1) {
    const [a, b] = dims;
    if (distinct(t, b.name) <= MAX_SERIES && t.rows.length <= 400) {
      return { ...base, type: 'bar', x: a.name, breakout: b.name, series: [{ y: numbers[0].name }], stack: 'stacked' };
    }
    if (distinct(t, a.name) <= 60 && distinct(t, b.name) <= 60) {
      return { ...base, type: 'heatmap', x: a.name, y2: b.name, value: numbers[0].name };
    }
  }
  if (dims.length === 0 && numbers.length >= 2) {
    return { ...base, type: 'scatter', x: numbers[0].name, series: [{ y: numbers[1].name }], size: numbers[2]?.name };
  }
  return { ...base, type: 'table' };
}

/**
 * Why a chart suits the result, in one line, from the chart and the result's columns (the chart
 * settings show it). Null for the kinds a person picks for their own reasons (pie, area, gauge ...).
 */
export function vizReason(spec: VizSpec, columns: ResultColumn[]): string | null {
  const col = (name: string | undefined) => columns.find((c) => c.name === name);
  const n = (spec.series ?? []).length;
  const per = spec.breakout ? columnTitle(col(spec.breakout), spec.breakout) : null;
  switch (spec.type) {
    case 'kpi':
      return tr('Number: one value');
    case 'line': {
      const x = col(spec.x);
      if (!x || !isTime(x)) return null;
      if (per) return tr('Line chart: a date, a number and one line per {column}', { column: per });
      return n > 1 ? tr('Line chart: one date and {n} numbers', { n }) : tr('Line chart: one date and one number');
    }
    case 'bar':
      if (per) {
        return spec.stack === 'stacked' || spec.stack === 'percent'
          ? tr('Stacked bars: categories, a number and one colour per {column}', { column: per })
          : tr('Bars: categories, a number and one colour per {column}', { column: per });
      }
      return n > 1 ? tr('Bars: categories and {n} numbers', { n }) : tr('Bars: categories and a number');
    case 'heatmap':
      return tr('Heatmap: two columns with many values and a number');
    case 'scatter':
      return columns.some((c) => !isNum(c)) ? tr('Scatter: two numbers against each other') : tr('Scatter: numbers only, no categories');
    default:
      return null;
  }
}

export function suggestViz(t: Table): VizSpec {
  return chooseViz(t).spec;
}

/**
 * Why a chart type cannot show a result with these columns and this many rows, or null when it
 * can. Only what can never work is ruled out; a chart that fits but needs settings stays allowed.
 */
export function chartFit(type: ChartType, columns: ResultColumn[], rowCount: number): string | null {
  if (type === 'table') return null;
  if (rowCount === 0) return tr('No rows to draw');
  const numbers = columns.filter(isNum).length;
  const others = columns.length - numbers;
  switch (type) {
    case 'bar':
    case 'line':
    case 'area':
      if (numbers === 0) return tr('Needs a number to draw');
      return columns.length < 2 ? tr('Needs a second column for the axis') : null;
    case 'combo':
      return numbers < 2 || columns.length < 3 ? tr('Needs two numbers (bars and a line) and a column for the axis') : null;
    case 'pie':
    case 'funnel':
      return numbers === 0 || others === 0 ? tr('Needs a category and a number') : null;
    case 'scatter':
      return numbers < 2 ? tr('Needs two numbers') : null;
    case 'kpi':
    case 'gauge':
      return numbers === 0 ? tr('Needs a number') : null;
    case 'histogram':
      return numbers === 0 || rowCount < 2 ? tr('Needs a number column with several rows') : null;
    case 'heatmap':
      return others < 2 || numbers === 0 ? tr('Needs two categories and a number') : null;
    case 'pivot':
      return columns.length < 2 ? tr('Needs at least two columns') : null;
    default:
      return null;
  }
}

/** Does this spec still fit the result (after the question changed)? */
export function vizFits(viz: VizSpec, t: Table): boolean {
  const names = new Set(t.columns.map((c) => c.name));
  const refs = [viz.x, viz.breakout, viz.size, viz.y2, viz.value, ...(viz.series ?? []).map((s) => s.y),
    ...(viz.pivot ? [...viz.pivot.rows, ...viz.pivot.columns, ...viz.pivot.values.map((v) => v.column)] : [])];
  return refs.every((r) => r === undefined || r === null || r === '' || names.has(r));
}
