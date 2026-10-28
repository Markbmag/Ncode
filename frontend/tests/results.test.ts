// Run with: npm test
// M11: what a result says about itself - readable column titles, descriptions on hover, axis
// titles by default, and plain notes instead of badges.
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ResultColumn } from '../src/api.ts';
import { resultNotes, savedAgo } from '../src/components/data/notes.ts';
import { setLangForTests } from '../src/i18n/index.ts';
import type { Table } from '../src/viz/data.ts';
import { pivot } from '../src/viz/data.ts';
import { columnDescription, columnTitle, titleOf, typeWord } from '../src/viz/labels.ts';
import { buildOption, describingTooltip } from '../src/viz/options.ts';
import { assignColors, chartTheme } from '../src/viz/palette.ts';
import type { VizSpec } from '../src/viz/types.ts';

const light = chartTheme('light');
afterEach(() => setLangForTests('en'));

const col = (name: string, type: ResultColumn['type'], extra: Partial<ResultColumn> = {}): ResultColumn => ({
  name, type, role: type === 'number' ? 'measure' : 'dimension', ...extra,
});

/** A builder result whose columns got their readable names (src/query/outputs.ts labelColumns). */
const BY_MONTH: Table = {
  columns: [
    col('created_at_month', 'date', { display_name: 'Created at: month' }),
    col('sum_revenue', 'number', { display_name: 'Sum of Revenue', description: 'Paid orders, after discounts' }),
    col('count', 'number', { display_name: 'Count' }),
  ],
  rows: [['2026-01-01', 1200, 12], ['2026-02-01', 1500, 14], ['2026-03-01', 900, 9]],
};

type Axis = { name?: string };
type Series = { name?: string };

describe('column titles and descriptions', () => {
  test('friendly when there is one, else the name the query gave (SQL aliases stay)', () => {
    setLangForTests('ru');
    const c = col('total', 'number', { display_name: 'Total', description: 'Order value', translations: { ru: { display_name: 'Итого', description: 'Сумма заказа' } } });
    assert.equal(columnTitle(c), 'Итого');
    assert.equal(columnDescription(c), 'Сумма заказа');
    assert.equal(columnTitle(col('n_orders', 'number')), 'n_orders');
    assert.equal(columnDescription(col('n_orders', 'number')), null);
    assert.equal(titleOf(BY_MONTH.columns, 'sum_revenue'), 'Sum of Revenue');
    assert.equal(titleOf(BY_MONTH.columns, 'gone'), 'gone');
    assert.equal(typeWord('datetime'), 'дата и время');
    setLangForTests('en');
    assert.equal(typeWord('string'), 'text');
  });
});

describe('charts read like the result (M11)', () => {
  test('one measure: axis titles on by default, the series named readably', () => {
    const o = buildOption(BY_MONTH, { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'sum_revenue' }] }, light)!;
    assert.equal((o.xAxis as Axis).name, 'Created at: month');
    assert.equal((o.yAxis as Axis).name, 'Sum of Revenue');
    assert.equal((o.series as Series[])[0].name, 'Sum of Revenue');
    assert.equal((o.legend as { show: boolean }).show, false); // one series: no legend
  });

  test('two measures: the legend names them, the value axis has no single title', () => {
    const o = buildOption(BY_MONTH, { version: 1, type: 'line', x: 'created_at_month', series: [{ y: 'sum_revenue' }, { y: 'count' }] }, light)!;
    assert.deepEqual((o.series as Series[]).map((s) => s.name), ['Sum of Revenue', 'Count']);
    assert.equal((o.legend as { show: boolean }).show, true);
    assert.equal((o.yAxis as Axis).name, undefined);
    assert.equal((o.xAxis as Axis).name, 'Created at: month');
  });

  test('titles typed in the settings win; they can be switched off', () => {
    const typed = buildOption(BY_MONTH, { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'sum_revenue' }], axis: { yTitle: 'Revenue, €' } }, light)!;
    assert.equal((typed.yAxis as Axis).name, 'Revenue, €');
    const off = buildOption(BY_MONTH, { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'sum_revenue' }], axis: { titles: false } }, light)!;
    assert.equal((off.xAxis as Axis).name, undefined);
    assert.equal((off.yAxis as Axis).name, undefined);
  });

  test('horizontal bars keep each title with its axis', () => {
    const o = buildOption(BY_MONTH, { version: 1, type: 'bar', horizontal: true, x: 'created_at_month', series: [{ y: 'sum_revenue' }] }, light)!;
    assert.equal((o.yAxis as Axis).name, 'Created at: month');
    assert.equal((o.xAxis as Axis).name, 'Sum of Revenue');
  });

  test('colours and highlight still follow the column, not its title', () => {
    const spec: VizSpec = { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'sum_revenue' }, { y: 'count' }], highlight: 'count', colors: { sum_revenue: 3 } };
    const o = buildOption(BY_MONTH, spec, light)!;
    const [revenue, count] = o.series as { itemStyle: { color: string } }[];
    assert.equal(revenue.itemStyle.color, light.deemphasis);
    assert.equal(count.itemStyle.color, assignColors(['sum_revenue', 'count'], spec.colors, light).count);
    const shown = buildOption(BY_MONTH, { ...spec, highlight: null }, light)!.series as { itemStyle: { color: string } }[];
    assert.equal(shown[0].itemStyle.color, light.series[3]); // the colour pinned to sum_revenue
  });

  test('scatter and histogram axes use titles, not technical names', () => {
    const t: Table = { columns: [col('weight', 'number', { display_name: 'Weight, kg' }), col('price', 'number', { display_name: 'Price' })], rows: [[1, 2], [3, 4], [5, 7], [2, 9]] };
    const s = buildOption(t, { version: 1, type: 'scatter', x: 'weight', series: [{ y: 'price' }] }, light)!;
    assert.equal((s.xAxis as Axis).name, 'Weight, kg');
    assert.equal((s.yAxis as Axis).name, 'Price');
    const h = buildOption(t, { version: 1, type: 'histogram', x: 'weight' }, light)!;
    assert.equal((h.xAxis as Axis).name, 'Weight, kg');
  });

  test('pivot value labels use titles', () => {
    const p = pivot(BY_MONTH, { rows: ['created_at_month'], columns: [], values: [{ column: 'sum_revenue', agg: 'sum' }] });
    assert.match(p.valueLabels[0], /Sum of Revenue/);
  });

  test('the tooltip tells what a measure means, escaped', () => {
    const o = buildOption(BY_MONTH, { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'sum_revenue' }] }, light)!;
    const formatter = (o.tooltip as { formatter?: (p: unknown) => string }).formatter;
    assert.ok(formatter, 'a describing tooltip');
    const html = formatter!({ marker: '●', seriesName: 'Sum of Revenue', name: 'Jan 2026', value: 1200 });
    assert.match(html, /Paid orders, after discounts/);
    assert.match(html, /Jan 2026/);
    // no description anywhere: the default tooltip stays
    const plain = buildOption(BY_MONTH, { version: 1, type: 'bar', x: 'created_at_month', series: [{ y: 'count' }] }, light)!;
    assert.equal((plain.tooltip as { formatter?: unknown }).formatter, undefined);
    const f = describingTooltip([{ title: 'A', description: '<script>x</script>' }], String)!;
    const out = f([{ seriesName: '<b>', value: 1 }]);
    assert.ok(!out.includes('<script>') && out.includes('&lt;script&gt;') && out.includes('&lt;b&gt;'));
  });
});

describe('notes above a result instead of badges (M11)', () => {
  const stats = (extra: Partial<{ row_count: number; truncated: boolean; cached: boolean; cached_age_sec: number | null }>) => ({ row_count: 5, truncated: false, cached: false, ...extra });

  test('nothing to say: no notes', () => {
    assert.deepEqual(resultNotes(stats({})), []);
  });

  test('a saved result says how old it is', () => {
    assert.deepEqual(resultNotes(stats({ cached: true, cached_age_sec: 130 })).map((n) => [n.kind, n.text]), [['saved', 'Saved result from 2 min ago']]);
    assert.equal(savedAgo(12), 'Saved result from less than a minute ago');
    assert.equal(savedAgo(null), 'Saved result from less than a minute ago');
    assert.equal(savedAgo(3 * 3600 + 5), 'Saved result from 3 hours ago');
    setLangForTests('ru');
    assert.equal(savedAgo(5 * 60), 'Сохранённый результат: получен 5 мин назад');
    assert.equal(savedAgo(2 * 3600), 'Сохранённый результат: получен 2 часа назад');
  });

  test('rows cut by the server limit are said; rows cut by the question’s own limit ("top 5") are not', () => {
    assert.deepEqual(resultNotes(stats({ truncated: true, row_count: 2000 })).map((n) => n.text), ['Showing the first 2,000 rows']);
    assert.deepEqual(resultNotes(stats({ truncated: true, row_count: 5 }), { rowLimit: 5 }), []);
    assert.deepEqual(resultNotes(stats({ truncated: true, row_count: 2000 }), { rowLimit: 5000 }).map((n) => n.kind), ['cut']);
    setLangForTests('ru');
    assert.deepEqual(resultNotes(stats({ truncated: true, row_count: 5 })).map((n) => n.text), ['Показаны первые 5 строк']);
  });

  test('a stopped run says the previous result is shown', () => {
    assert.deepEqual(resultNotes(stats({}), { stopped: true }).map((n) => n.kind), ['stopped']);
  });
});
