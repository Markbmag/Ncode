// The automatic chart choice says why (M12), and chart types that cannot show a result are named with the reason.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ResultColumn } from '../src/api.ts';
import { chartFit, chooseViz, suggestViz } from '../src/viz/autoViz.ts';
import { FIXTURES, oneNumber, ordersByStatus, revenueByMonth, revenueByMonthRegion, sizes, weekdayHour } from '../src/viz/fixtures.ts';
import type { Table } from '../src/viz/data.ts';
import { CHART_TYPES } from '../src/viz/types.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const c = (name: string, type: ResultColumn['type'], role: ResultColumn['role'] = 'dimension', display_name?: string): ResultColumn => ({ name, type, role, display_name });

describe('the automatic chart says why it was chosen', () => {
  test('one reason per result shape', () => {
    setLangForTests('en');
    assert.equal(chooseViz(oneNumber).reason, 'Number: one value');
    assert.equal(chooseViz({ ...revenueByMonth, columns: revenueByMonth.columns.slice(0, 2), rows: revenueByMonth.rows.map((r) => r.slice(0, 2)) }).reason, 'Line chart: one date and one number');
    assert.equal(chooseViz(revenueByMonth).reason, 'Line chart: one date and 3 numbers');
    assert.equal(chooseViz(ordersByStatus).reason, 'Bars: categories and a number');
    assert.equal(chooseViz(sizes).reason, 'Scatter: numbers only, no categories');
    assert.equal(chooseViz({ columns: [c('name', 'string')], rows: [['a']] }).reason, 'Table: no numbers to compare');
    assert.equal(chooseViz({ columns: [c('n', 'number', 'measure')], rows: [] }).reason, 'Table: no rows to draw');
    assert.match(chooseViz(weekdayHour).reason, /^Stacked bars: .* one colour per hour$/);
  });

  test('a line per value names the column by its friendly name', () => {
    setLangForTests('en');
    const t: Table = { ...revenueByMonthRegion, columns: [revenueByMonthRegion.columns[0], c('region', 'string', 'dimension', 'Sales region'), revenueByMonthRegion.columns[2]] };
    const { spec, reason } = chooseViz(t);
    assert.equal(spec.type, 'line');
    assert.equal(spec.breakout, 'region');
    assert.equal(reason, 'Line chart: a date, a number and one line per Sales region');
  });

  test('scrap per line per week (the M12 done-when) comes out as one line per line', () => {
    const weeks = ['2026-07-06', '2026-07-13', '2026-07-20'];
    const lines = ['Press line', 'Welding line', 'Paint line', 'Final assembly'];
    const t: Table = {
      columns: [c('recorded_at_week', 'date'), c('name', 'string', 'dimension', 'Line'), c('sum_qty', 'number', 'measure')],
      rows: weeks.flatMap((w, i) => lines.map((l, k) => [w, l, 10 + i * 3 + k])),
    };
    const { spec, reason } = chooseViz(t);
    assert.deepEqual([spec.type, spec.x, spec.breakout], ['line', 'recorded_at_week', 'name']);
    assert.equal(reason, 'Line chart: a date, a number and one line per Line');
  });

  test('suggestViz is the spec of chooseViz', () => {
    for (const f of FIXTURES) assert.deepEqual(suggestViz(f.table), chooseViz(f.table).spec);
  });

  test('the reasons are in Russian too', () => {
    setLangForTests('ru');
    try {
      assert.equal(chooseViz(oneNumber).reason, 'Число: одно значение');
      assert.equal(chartFit('scatter', ordersByStatus.columns, 7), 'Нужны два числа');
    } finally {
      setLangForTests('en');
    }
  });
});

describe('chart types that cannot show a result', () => {
  test('every gallery example is allowed for its own result', () => {
    for (const f of FIXTURES) assert.equal(chartFit(f.viz.type, f.table.columns, f.table.rows.length), null, f.name);
  });

  test('a category and a number: no scatter, no heatmap, no combo', () => {
    setLangForTests('en');
    const fit = (type: Parameters<typeof chartFit>[0]) => chartFit(type, ordersByStatus.columns, ordersByStatus.rows.length);
    assert.equal(fit('bar'), null);
    assert.equal(fit('pie'), null);
    assert.equal(fit('kpi'), null);
    assert.equal(fit('scatter'), 'Needs two numbers');
    assert.equal(fit('heatmap'), 'Needs two categories and a number');
    assert.match(fit('combo') ?? '', /^Needs two numbers/);
  });

  test('rows without numbers can only be a table (or a pivot that counts them)', () => {
    const cols = [c('name', 'string'), c('city', 'string')];
    const blocked = CHART_TYPES.filter((x) => chartFit(x.type, cols, 5) !== null).map((x) => x.type);
    assert.deepEqual(blocked, ['bar', 'line', 'area', 'combo', 'pie', 'scatter', 'kpi', 'gauge', 'histogram', 'heatmap', 'funnel']);
    assert.equal(chartFit('bar', cols, 5), 'Needs a number to draw');
  });

  test('an empty result can only be a table', () => {
    assert.equal(chartFit('table', ordersByStatus.columns, 0), null);
    assert.equal(chartFit('bar', ordersByStatus.columns, 0), 'No rows to draw');
  });
});
