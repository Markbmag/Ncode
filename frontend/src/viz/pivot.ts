/**
 * Pivot like Excel (M12): the Rows / Columns / Values layout of a pivot table, a sensible
 * default for a result, moving fields between the areas, the grid as it is shown (and written
 * to Excel by backend/app/query/xlsx.py, which follows the same rules), and what the Excel
 * export is told. Pure functions; tested in tests/pivot.test.ts.
 *
 * The grid, for rows R, columns C and values V:
 *   - one left column per row field (one when there is none);
 *   - with column fields: a first header row with the value's name (one value) and the column
 *     fields' names, one header row per column field, and a row of value names when there are
 *     several values; without: one header row of value names;
 *   - the last header row names the row fields;
 *   - totals: a "Total" column per value when there are column fields, a "Total" row when there
 *     are row fields;
 *   - an outer label shows once at the start of its group (like Excel's tabular form).
 */
import type { ResultColumn } from '../api';
import { colIndex, pivot } from './data.ts';
import type { PivotResult, Table } from './data.ts';
import { titleOf } from './labels.ts';
import type { AggregateFn, ColumnFormat, DateStyle, PivotSpec, VizSpec } from './types.ts';
import { dateStyleFromName } from './format.ts';
import { t as tr } from '../i18n/index.ts';

export type PivotArea = 'rows' | 'columns' | 'values';
export const PIVOT_AREAS: PivotArea[] = ['rows', 'columns', 'values'];
export const PIVOT_AGGS: AggregateFn[] = ['sum', 'count', 'avg', 'min', 'max'];

const isDate = (c: ResultColumn) => c.type === 'date' || c.type === 'datetime';
const isMeasure = (c: ResultColumn) => c.type === 'number' && c.role === 'measure';
const isShare = (c: ResultColumn) => (c.format as ColumnFormat | null | undefined)?.style === 'percent' || c.semantic_type === 'percent';

/** How a column is totalled when it is put into Values: numbers are summed (shares averaged), the rest counted. */
export function defaultAgg(col: ResultColumn | undefined): AggregateFn {
  if (!col || col.type !== 'number') return 'count';
  return isShare(col) ? 'avg' : 'sum';
}

/**
 * The layout a pivot starts with: the result's numbers as values, its other columns as rows,
 * and - with two or more of those - the last one that is not a date across (time goes down,
 * like "scrap per week (rows) and line (columns)").
 */
export function defaultPivot(columns: ResultColumn[]): PivotSpec {
  const measures = columns.filter(isMeasure);
  const numbers = measures.length ? measures : columns.filter((c) => c.type === 'number' && !columns.every((x) => x.type === 'number'));
  const dims = columns.filter((c) => !numbers.includes(c) && c.type !== 'json' && c.type !== 'binary');
  const across = dims.length >= 2 ? ([...dims].reverse().find((c) => !isDate(c)) ?? dims[dims.length - 1]) : undefined;
  const values = numbers.slice(0, 3).map((c) => ({ column: c.name, agg: defaultAgg(c) }));
  if (values.length === 0 && columns.length) values.push({ column: (dims[0] ?? columns[0]).name, agg: 'count' });
  return {
    rows: dims.filter((c) => c !== across).map((c) => c.name),
    columns: across ? [across.name] : [],
    values,
    totals: true,
  };
}

/** Does every field of the layout exist in the result? */
export function pivotFits(spec: PivotSpec, columns: ResultColumn[]): boolean {
  const names = new Set(columns.map((c) => c.name));
  return [...spec.rows, ...spec.columns, ...spec.values.map((v) => v.column)].every((n) => names.has(n));
}

/** The layout shown: the saved one while it fits the result, else the default (choosing Pivot, or the question changed). */
export function effectivePivot(viz: Pick<VizSpec, 'pivot'>, columns: ResultColumn[]): PivotSpec {
  return viz.pivot && pivotFits(viz.pivot, columns) ? viz.pivot : defaultPivot(columns);
}

export interface PivotDrag {
  name: string;               // the result column
  from: PivotArea | 'fields'; // where it was picked up ("fields" = the list of all columns)
  index: number;              // its place there (values may hold a column twice)
}

/**
 * Puts a field into an area (at a place, else at the end), as dragging it there or picking
 * "Move to …" does. A column is in Rows or Columns once; Values may total it twice (sum and
 * count). "fields" as the target takes it out of the layout.
 */
export function placeField(spec: PivotSpec, drag: PivotDrag, to: PivotArea | 'fields', at: number | undefined, columns: ResultColumn[]): PivotSpec {
  const rows = [...spec.rows];
  const cols = [...spec.columns];
  const values = [...spec.values];
  const take = (list: string[], name: string) => {
    const i = list.indexOf(name);
    if (i >= 0) list.splice(i, 1);
    return i;
  };
  let place = at;
  const shift = (from: number) => {
    if (place !== undefined && from >= 0 && from < place) place -= 1; // it left this area above the place
  };
  // out of where it was picked up
  let entry: PivotSpec['values'][number] | undefined;
  if (drag.from === 'values') {
    entry = values.splice(drag.index, 1)[0];
    if (to === 'values') shift(drag.index);
  } else if (drag.from === 'rows' || drag.from === 'columns') {
    const i = take(drag.from === 'rows' ? rows : cols, drag.name);
    if (to === drag.from) shift(i);
  }
  const clamp = (list: unknown[]) => Math.max(0, Math.min(list.length, place ?? list.length));
  if (to === 'values') {
    values.splice(clamp(values), 0, entry ?? { column: drag.name, agg: defaultAgg(columns.find((c) => c.name === drag.name)) });
  } else if (to !== 'fields') {
    const target = to === 'rows' ? rows : cols;
    take(to === 'rows' ? cols : rows, drag.name); // in Rows or in Columns, not both
    shift(take(target, drag.name));
    target.splice(clamp(target), 0, drag.name);
  }
  return { ...spec, rows, columns: cols, values };
}

export function setAgg(spec: PivotSpec, index: number, agg: AggregateFn): PivotSpec {
  return { ...spec, values: spec.values.map((v, i) => (i === index ? { ...v, agg } : v)) };
}

/** The columns not in Rows or Columns (they can still be added to Values). */
export function freeFields(spec: PivotSpec, columns: ResultColumn[]): ResultColumn[] {
  const used = new Set([...spec.rows, ...spec.columns, ...spec.values.map((v) => v.column)]);
  return columns.filter((c) => !used.has(c.name));
}

/** "Sum of Good pieces" (in the UI language). */
export function valueLabel(columns: ResultColumn[], v: { column: string; agg: AggregateFn }): string {
  const text = tr('{agg} of {column}', { agg: tr(v.agg), column: titleOf(columns, v.column) });
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------- the grid

export type GridCell =
  | { kind: 'blank'; span?: number }
  | { kind: 'title'; text: string; span?: number }                  // a field's or value's name, "Total"
  | { kind: 'key'; field: string; raw: string; span?: number }      // a value of a row / column field
  | { kind: 'number'; value: number | null; v: number; total?: boolean };

export interface PivotGrid {
  header: GridCell[][];
  body: GridCell[][];
  left: number;          // how many left (row label) columns
  totalRow: boolean;     // the last body row is the totals
  rows: number;          // row keys (before any cap)
  cols: number;          // column keys (before any cap)
}

export interface GridLimits {
  maxRows?: number;
  maxCols?: number;
}

/** The pivot as rows of cells (see the top of this file); column keys and row keys can be capped for the screen. */
export function pivotGrid(t: Table, spec: PivotSpec, limits: GridLimits = {}): PivotGrid {
  const p: PivotResult = pivot(t, spec);
  const nv = spec.values.length;
  const rowFields = spec.rows.filter((r) => colIndex(t, r) >= 0);
  const colFields = spec.columns.filter((c) => colIndex(t, c) >= 0);
  const nr = rowFields.length;
  const nc = colFields.length;
  const left = Math.max(1, nr);
  const colKeys = p.colKeys.slice(0, limits.maxCols ?? p.colKeys.length);
  const rowKeys = p.rowKeys.slice(0, limits.maxRows ?? p.rowKeys.length);
  const totals = spec.totals !== false;
  const totalCols = totals && nc > 0;
  const totalRow = totals && nr > 0;
  const labels = spec.values.map((v) => valueLabel(t.columns, v));
  const title = (text: string, span?: number): GridCell => ({ kind: 'title', text, ...(span && span > 1 ? { span } : {}) });
  const blank = (span?: number): GridCell => ({ kind: 'blank', ...(span && span > 1 ? { span } : {}) });
  const rowTitles = (): GridCell[] => (nr ? rowFields.map((r) => title(titleOf(t.columns, r))) : [blank()]);

  const header: GridCell[][] = [];
  if (nc === 0) {
    header.push([...rowTitles(), ...labels.map((l) => title(l))]);
  } else {
    const width = colKeys.length * nv;
    header.push([
      nv === 1 ? title(labels[0]) : blank(), ...Array.from({ length: left - 1 }, () => blank()),
      title(colFields.map((c) => titleOf(t.columns, c)).join(' · '), width),
      ...(totalCols ? [blank(nv)] : []),
    ]);
    colFields.forEach((field, level) => {
      const last = level === nc - 1;
      const row: GridCell[] = last && nv === 1 ? rowTitles() : Array.from({ length: left }, () => blank());
      // one cell per run of equal keys (merged across, like Excel)
      for (let c = 0; c < colKeys.length; ) {
        let end = c + 1;
        const same = (a: string[], b: string[]) => a.slice(0, level + 1).every((x, i) => x === b[i]);
        while (!last && end < colKeys.length && same(colKeys[end], colKeys[c])) end++;
        if (last) end = c + 1;
        row.push({ kind: 'key', field, raw: colKeys[c][level], ...((end - c) * nv > 1 ? { span: (end - c) * nv } : {}) });
        c = end;
      }
      if (totalCols) row.push(level === 0 ? title(tr('Total'), nv) : blank(nv));
      header.push(row);
    });
    if (nv > 1) header.push([...rowTitles(), ...colKeys.flatMap(() => labels.map((l) => title(l))), ...(totalCols ? labels.map((l) => title(l)) : [])]);
  }

  const body: GridCell[][] = [];
  const shownCols = colKeys.map((_, c) => c);
  rowKeys.forEach((rk, r) => {
    const prev = rowKeys[r - 1];
    const leftCells: GridCell[] = nr
      ? rowFields.map((field, i) => (prev && i < nr - 1 && rk.slice(0, i + 1).every((x, k) => x === prev[k]) ? blank() : { kind: 'key', field, raw: rk[i] }))
      : [title(tr('Total'))];
    const cells: GridCell[] = shownCols.flatMap((c) => spec.values.map((_, v) => ({ kind: 'number' as const, value: p.cell(r, c, v), v })));
    if (totalCols) cells.push(...spec.values.map((_, v) => ({ kind: 'number' as const, value: p.rowTotal(r, v), v, total: true })));
    body.push([...leftCells, ...cells]);
  });
  if (totalRow) {
    body.push([
      title(tr('Total')), ...Array.from({ length: left - 1 }, () => blank()),
      ...shownCols.flatMap((c) => spec.values.map((_, v) => ({ kind: 'number' as const, value: p.colTotal(c, v), v, total: true }))),
      ...(totalCols ? spec.values.map((_, v) => ({ kind: 'number' as const, value: p.grandTotal(v), v, total: true })) : []),
    ]);
  }
  return { header, body, left, totalRow, rows: p.rowKeys.length, cols: p.colKeys.length };
}

// ---------------------------------------------------------------- the Excel export

/** What GET /api/query/tasks/{id}/export.xlsx?pivot=… is told (backend/app/query/xlsx.py PivotLayout). */
export interface PivotExport {
  rows: string[];
  columns: string[];
  values: { column: string; agg: AggregateFn; label: string; format: ColumnFormat }[];
  totals: boolean;
  titles: Record<string, string>;   // names of the row and column fields
  dates: Record<string, DateStyle>; // date fields: how their values are shown
  texts: { total: string; empty: string; week: string; quarter: string };
  lang: string;
}

/**
 * The pivot layout for the Excel export of a result shown as a pivot table, else null (the
 * export then writes the rows as they are). Formats: the chart's own over the data model's.
 */
export function pivotExport(viz: VizSpec | null | undefined, t: Table, lang: string): PivotExport | null {
  if (!viz || viz.type !== 'pivot') return null;
  const spec = effectivePivot(viz, t.columns);
  if (spec.values.length === 0) return null;
  const formatOf = (name: string): ColumnFormat => ({ ...((t.columns.find((c) => c.name === name)?.format as ColumnFormat | null) ?? {}), ...(viz.format?.[name] ?? {}) });
  const fields = [...spec.rows, ...spec.columns];
  const dates: Record<string, DateStyle> = {};
  for (const name of fields) {
    const col = t.columns.find((c) => c.name === name);
    if (col && isDate(col)) {
      const own = formatOf(name).date;
      dates[name] = own && own !== 'auto' ? own : dateStyleFromName(name);
    }
  }
  return {
    rows: spec.rows,
    columns: spec.columns,
    values: spec.values.map((v) => ({ ...v, label: valueLabel(t.columns, v), format: v.agg === 'count' ? {} : formatOf(v.column) })),
    totals: spec.totals !== false,
    titles: Object.fromEntries(fields.map((n) => [n, titleOf(t.columns, n)])),
    dates,
    texts: { total: tr('Total'), empty: tr('(empty)'), week: tr('Week of {date}'), quarter: tr('Q{q} {year}') },
    lang,
  };
}

/** Query parameters of the Excel export: the pivot layout when the result is shown as a pivot. */
export function xlsxExportParams(viz: VizSpec | null | undefined, t: Table | null | undefined, lang: string): Record<string, string> | undefined {
  const layout = t ? pivotExport(viz, t, lang) : null;
  return layout ? { pivot: JSON.stringify(layout) } : undefined;
}
