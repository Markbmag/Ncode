import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ageText, dataAsOf, filtersLabel, isNumberCard, phoneCards, readAt } from '../src/dashboards/phone.ts';
import type { DashCard } from '../src/dashboards/types.ts';
import { narrowOption, narrowViz } from '../src/viz/narrow.ts';
import { buildOption } from '../src/viz/options.ts';
import { chartTheme } from '../src/viz/palette.ts';
import { revenueByMonthRegion } from '../src/viz/fixtures.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const card = (key: string, x: number, y: number, kind: DashCard['kind'] = 'question', type = 'bar', h = 6): DashCard => ({
  key, kind, layout: { x, y, w: 3, h }, question: { state: 'ok', viz: { mode: 'chart', spec: { version: 1, type: type as 'bar' } } },
});

test('on a phone: reading order, number cards two per row', () => {
  const cards = [card('chart', 6, 2), card('kpi2', 3, 2, 'question', 'kpi'), card('intro', 0, 0, 'text'), card('kpi1', 0, 2, 'question', 'kpi'), card('lone', 0, 9, 'question', 'kpi'), card('table', 0, 8)];
  const rows = phoneCards(cards);
  assert.deepEqual(rows.map((r) => r.card.key), ['intro', 'kpi1', 'kpi2', 'chart', 'table', 'lone']);
  assert.deepEqual(rows.map((r) => r.span), [2, 1, 1, 2, 2, 2]); // a number card alone takes the row
  assert.ok(rows[3].height! >= 280); // charts get room to be read
  assert.equal(isNumberCard({ ...card('k', 0, 0, 'question', 'kpi'), viz: { mode: 'table', spec: null } }), false); // shown as a table here
});

test('data as of: a reused result is as old as its run', () => {
  setLangForTests('en');
  const done = new Date(2026, 10, 3, 8, 20).getTime();
  assert.equal(readAt(done, { cached: false }), done);
  assert.equal(readAt(done, { cached: true, cached_age_sec: 300 }), done - 300_000);
  assert.equal(readAt(null, null), null);
  assert.equal(ageText(done, done + 20_000), 'just now');
  assert.equal(ageText(done - 180_000, done), '3 min ago');
  assert.equal(ageText(new Date(2026, 10, 3, 6, 5).getTime(), done), '06:05');
  assert.equal(ageText(new Date(2026, 10, 2, 6, 5).getTime(), done), '2 Nov 2026 06:05');
  assert.equal(dataAsOf([done - 180_000, done - 60_000], done), 'Data from 08:17 · 3 min ago');
  assert.equal(dataAsOf([new Date(2026, 10, 3, 6, 5).getTime()], done), 'Data from 06:05');
  assert.equal(dataAsOf([], done), null);
  assert.equal(filtersLabel(0), 'Filters');
  assert.equal(filtersLabel(2), 'Filters (2)');
});

test('narrow charts: legend below, no axis titles, fewer labels', () => {
  const viz = { version: 1 as const, type: 'line' as const, x: 'month', breakout: 'region', series: [{ y: 'revenue' }] };
  const narrow = narrowViz(viz);
  assert.equal(narrow.legend, 'bottom');
  assert.equal(narrow.axis?.titles, false);
  assert.equal(narrowViz({ ...viz, legend: 'none' }).legend, 'none');
  const option = narrowOption(buildOption(revenueByMonthRegion, narrow, chartTheme('light')))!;
  const x = option.xAxis as { name?: string; axisLabel: { interval: unknown } };
  const y = option.yAxis as { name?: string; splitNumber?: number };
  assert.equal(x.axisLabel.interval, 'auto');
  assert.equal(y.splitNumber, 3);
  assert.equal(x.name, undefined);
  assert.ok('bottom' in (option.legend as object));
});
