// Pivot like Excel (M12): src/viz/pivot.ts (layout, default, moving fields, the grid, the export).
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ResultColumn } from '../src/api.ts';
import { pivot } from '../src/viz/data.ts';
import type { Table } from '../src/viz/data.ts';
import { defaultPivot, effectivePivot, pivotExport, pivotGrid, placeField, xlsxExportParams } from '../src/viz/pivot.ts';
import type { GridCell } from '../src/viz/pivot.ts';
import type { PivotSpec } from '../src/viz/types.ts';

const col = (name: string, type: ResultColumn['type'], role: ResultColumn['role'] = 'dimension', extra: Partial<ResultColumn> = {}): ResultColumn => ({ name, type, role, ...extra });

// scrap per week and line, as the builder returns it (ordered by week, then line)
const SCRAP: Table = {
  columns: [col('Week', 'date'), col('Line', 'string'), col('Scrapped', 'number', 'measure', { display_name: 'Scrapped pieces' })],
  rows: [
    ['2026-09-07', 'Paint', 5], ['2026-09-07', 'Press', 2],
    ['2026-09-14', 'Paint', 7], ['2026-09-14', 'Press', 1], ['2026-09-14', 'Weld', 4],
  ],
};

const text = (cell: GridCell): string => {
  if (cell.kind === 'title') return cell.text;
  if (cell.kind === 'key') return cell.raw;
  if (cell.kind === 'number') return cell.value === null ? '' : String(cell.value);
  return '';
};
const grid = (t: Table, spec: PivotSpec) => {
  const g = pivotGrid(t, spec);
  return { header: g.header.map((r) => r.map(text)), body: g.body.map((r) => r.map(text)), spans: g.header.map((r) => r.map((c) => ('span' in c ? c.span ?? 1 : 1))) };
};

describe('pivot layout', () => {
  test('the default: numbers as values, time down the rows, the other dimension across', () => {
    assert.deepEqual(defaultPivot(SCRAP.columns), { rows: ['Week'], columns: ['Line'], values: [{ column: 'Scrapped', agg: 'sum' }], totals: true });
    const three = [col('month', 'date'), col('line', 'string'), col('shift', 'string'), col('n', 'number', 'measure')];
    assert.deepEqual(defaultPivot(three).rows, ['month', 'line']);
    assert.deepEqual(defaultPivot(three).columns, ['shift']);
    const one = defaultPivot([col('line', 'string'), col('rate', 'number', 'measure', { format: { style: 'percent' } })]);
    assert.deepEqual(one, { rows: ['line'], columns: [], values: [{ column: 'rate', agg: 'avg' }], totals: true }); // shares are averaged
    assert.deepEqual(defaultPivot([col('vin', 'string'), col('model', 'string')]).values, [{ column: 'vin', agg: 'count' }]);
  });

  test('a saved layout is kept while it fits; choosing Pivot (no layout) or a changed question gets the default', () => {
    const own: PivotSpec = { rows: ['Line'], columns: [], values: [{ column: 'Scrapped', agg: 'max' }] };
    assert.equal(effectivePivot({ pivot: own }, SCRAP.columns), own);
    assert.deepEqual(effectivePivot({}, SCRAP.columns).columns, ['Line']);
    assert.deepEqual(effectivePivot({ pivot: { ...own, rows: ['gone'] } }, SCRAP.columns).rows, ['Week']);
  });

  test('moving fields between the areas, like dragging them', () => {
    const start: PivotSpec = { rows: ['Week'], columns: ['Line'], values: [{ column: 'Scrapped', agg: 'sum' }] };
    const across = placeField(start, { name: 'Week', from: 'rows', index: 0 }, 'columns', 0, SCRAP.columns);
    assert.deepEqual([across.rows, across.columns], [[], ['Week', 'Line']]);
    const back = placeField(across, { name: 'Line', from: 'columns', index: 1 }, 'rows', undefined, SCRAP.columns);
    assert.deepEqual([back.rows, back.columns], [['Line'], ['Week']]);
    // reorder inside one area: moving the first behind the second
    const two = { ...start, rows: ['Week', 'Line'], columns: [] };
    assert.deepEqual(placeField(two, { name: 'Week', from: 'rows', index: 0 }, 'rows', 2, SCRAP.columns).rows, ['Line', 'Week']);
    assert.deepEqual(placeField(two, { name: 'Line', from: 'rows', index: 1 }, 'rows', 0, SCRAP.columns).rows, ['Line', 'Week']);
    // a field is in Rows or in Columns, never both
    assert.deepEqual(placeField(start, { name: 'Line', from: 'fields', index: 0 }, 'rows', undefined, SCRAP.columns).columns, []);
    // Values: a second total of the same column; a text column is counted; taking a value out
    const counted = placeField(start, { name: 'Scrapped', from: 'fields', index: 0 }, 'values', undefined, SCRAP.columns);
    assert.deepEqual(counted.values.map((v) => v.agg), ['sum', 'sum']);
    const lines = placeField(start, { name: 'Line', from: 'columns', index: 0 }, 'values', undefined, SCRAP.columns);
    assert.deepEqual([lines.columns, lines.values.at(-1)], [[], { column: 'Line', agg: 'count' }]);
    assert.deepEqual(placeField(start, { name: 'Scrapped', from: 'values', index: 0 }, 'fields', undefined, SCRAP.columns).values, []);
    assert.deepEqual(placeField(start, { name: 'Scrapped', from: 'values', index: 0 }, 'rows', undefined, SCRAP.columns).rows, ['Week', 'Scrapped']);
  });
});

describe('pivot grid', () => {
  test('rows × columns with totals, header rows like Excel', () => {
    const g = grid(SCRAP, defaultPivot(SCRAP.columns));
    assert.deepEqual(g.header, [
      ['Sum of Scrapped pieces', 'Line', ''],
      ['Week', 'Paint', 'Press', 'Weld', 'Total'],
    ]);
    assert.deepEqual(g.spans[0], [1, 3, 1]);
    assert.deepEqual(g.body, [
      ['2026-09-07', '5', '2', '', '7'],
      ['2026-09-14', '7', '1', '4', '12'],
      ['Total', '12', '3', '4', '19'],
    ]);
  });

  test('no totals; several values get a header row of their own', () => {
    const spec: PivotSpec = { rows: ['Line'], columns: ['Week'], values: [{ column: 'Scrapped', agg: 'sum' }, { column: 'Scrapped', agg: 'count' }], totals: false };
    const g = grid(SCRAP, spec);
    assert.deepEqual(g.header, [
      ['', 'Week'],
      ['', '2026-09-07', '2026-09-14'],
      ['Line', 'Sum of Scrapped pieces', 'Count of Scrapped pieces', 'Sum of Scrapped pieces', 'Count of Scrapped pieces'],
    ]);
    assert.deepEqual(g.spans[1], [1, 2, 2]);
    assert.deepEqual(g.body[0], ['Paint', '5', '1', '7', '1']);
    assert.equal(g.body.length, 3);
  });

  test('without column fields: one header row and no total column; without row fields: one row', () => {
    const byLine = grid(SCRAP, { rows: ['Line'], columns: [], values: [{ column: 'Scrapped', agg: 'max' }] });
    assert.deepEqual(byLine.header, [['Line', 'Max of Scrapped pieces']]);
    assert.deepEqual(byLine.body.at(-1), ['Total', '7']);
    const across = grid(SCRAP, { rows: [], columns: ['Line'], values: [{ column: 'Scrapped', agg: 'sum' }] });
    assert.deepEqual(across.body, [['Total', '12', '3', '4', '19']]);
  });

  test('nested rows stay together under their outer value, which shows once', () => {
    const spec: PivotSpec = { rows: ['Line', 'Week'], columns: [], values: [{ column: 'Scrapped', agg: 'sum' }], totals: false };
    const p = pivot(SCRAP, spec);
    assert.deepEqual(p.rowKeys.map((k) => k.join('/')), ['Paint/2026-09-07', 'Paint/2026-09-14', 'Press/2026-09-07', 'Press/2026-09-14', 'Weld/2026-09-14']);
    assert.deepEqual(grid(SCRAP, spec).body.map((r) => r[0]), ['Paint', '', 'Press', '', 'Weld']);
  });
});

describe('pivot export', () => {
  test('the export is told the layout, names, formats and date styles of a pivot', () => {
    const t: Table = { ...SCRAP, columns: SCRAP.columns.map((c) => (c.name === 'Scrapped' ? { ...c, format: { style: 'number', decimals: 0 } } : c)) };
    const viz = { version: 1 as const, type: 'pivot' as const, format: { Scrapped: { suffix: ' pcs' } } };
    const out = pivotExport(viz, t, 'en')!;
    assert.deepEqual([out.rows, out.columns, out.totals], [['Week'], ['Line'], true]);
    assert.deepEqual(out.values, [{ column: 'Scrapped', agg: 'sum', label: 'Sum of Scrapped pieces', format: { style: 'number', decimals: 0, suffix: ' pcs' } }]);
    assert.deepEqual(out.titles, { Week: 'Week', Line: 'Line' });
    assert.deepEqual(out.dates, { Week: 'auto' });
    assert.equal(out.texts.total, 'Total');
    assert.equal(pivotExport({ version: 1, type: 'bar' }, t, 'en'), null);
    assert.equal(xlsxExportParams({ version: 1, type: 'table' }, t, 'en'), undefined);
    assert.deepEqual(JSON.parse(xlsxExportParams(viz, t, 'en')!.pivot).rows, ['Week']);
    // a count is a plain number, whatever the column's format
    const counted = pivotExport({ ...viz, pivot: { rows: ['Line'], columns: [], values: [{ column: 'Scrapped', agg: 'count' }] } }, t, 'en')!;
    assert.deepEqual(counted.values[0].format, {});
  });
});
