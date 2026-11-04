import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { guessPeriod, kpiView, parseDay, periodStart, shiftPeriod } from '../src/viz/kpi.ts';
import type { Table } from '../src/viz/data.ts';
import type { VizSpec } from '../src/viz/types.ts';
import type { ResultColumn } from '../src/api.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const NOW = new Date(2026, 10, 3, 9, 15); // Tuesday 3 Nov 2026, local time
const col = (name: string, type: ResultColumn['type'], extra: Partial<ResultColumn> = {}): ResultColumn => ({ name, type, role: type === 'number' ? 'measure' : 'dimension', ...extra });
const kpi = (extra: Partial<VizSpec> = {}): VizSpec => ({ version: 1, type: 'kpi', value: 'Work orders', ...extra });
const weekly = (rows: [string, number][]): Table => ({ columns: [col('Week', 'date'), col('Work orders', 'number')], rows });

describe('KPI periods', () => {
  test('period starts and steps (weeks start on Monday)', () => {
    const day = parseDay('2026-11-03')!;
    assert.equal(periodStart(day, 'week'), parseDay('2026-11-02'));
    assert.equal(periodStart(day, 'month'), parseDay('2026-11-01'));
    assert.equal(periodStart(day, 'quarter'), parseDay('2026-10-01'));
    assert.equal(periodStart(day, 'year'), parseDay('2026-01-01'));
    assert.equal(shiftPeriod(parseDay('2026-01-01')!, 'month', -1), parseDay('2025-12-01'));
    assert.equal(shiftPeriod(parseDay('2026-01-01')!, 'quarter', -1), parseDay('2025-10-01'));
    assert.equal(parseDay('2026-03-30T00:00:00'), parseDay('2026-03-30')); // a timestamp's day; DST-safe
    assert.equal(shiftPeriod(parseDay('2026-03-23')!, 'week', 1), parseDay('2026-03-30'));
  });

  test('the step is guessed from the dates', () => {
    const days = (xs: string[]) => xs.map((x) => parseDay(x)!);
    assert.equal(guessPeriod(days(['2026-10-12', '2026-10-19', '2026-10-26'])), 'week');
    assert.equal(guessPeriod(days(['2026-08-01', '2026-09-01', '2026-10-01'])), 'month');
    assert.equal(guessPeriod(days(['2026-11-02', '2026-10-19'])), 'week'); // a week without rows is still weeks
    assert.equal(guessPeriod(days(['2025-01-01', '2026-01-01'])), 'year');
    assert.equal(guessPeriod(days(['2026-07-01', '2026-10-01'])), 'quarter');
    assert.equal(guessPeriod(days(['2026-10-14', '2026-10-15'])), 'day');
    assert.equal(guessPeriod([]), null);
  });
});

describe('KPI comparison', () => {
  test('the running week is not compared: last complete week vs the week before', () => {
    setLangForTests('en');
    const v = kpiView(weekly([['2026-10-12', 300], ['2026-10-19', 400], ['2026-10-26', 448], ['2026-11-02', 87]]), kpi(), NOW);
    assert.equal(v.period, 'week');
    assert.equal(v.value, 448);
    assert.equal(v.label, 'Last week');
    assert.equal(v.partial, 'So far this week: 87');
    assert.equal(v.comparison?.previous, 400);
    assert.equal(v.comparison?.direction, 'up');
    assert.equal(v.comparison?.tone, 'good');
    assert.match(v.comparison!.text, /^▲ 12\s?% vs the week before$/);
    assert.match(v.comparison!.hint, /Week of 26 Oct 2026 \(448\) compared with Week of 19 Oct 2026 \(400\)/);
    assert.deepEqual(v.trend, [300, 400, 448]); // the half week would look like a drop
  });

  test('rows in any order; without a current period the last one is compared', () => {
    const v = kpiView(weekly([['2026-10-19', 400], ['2026-10-12', 500]]), kpi(), NOW);
    assert.equal(v.value, 400);
    assert.equal(v.label, 'Week of 19 Oct 2026');
    assert.equal(v.partial, null);
    assert.equal(v.comparison?.direction, 'down');
    assert.equal(v.comparison?.tone, 'bad');
    assert.match(v.comparison!.text, /^▼ 20\s?% vs the week before$/);
  });

  test('a missing week before is not replaced by an older one', () => {
    const v = kpiView(weekly([['2026-10-12', 300], ['2026-10-26', 448]]), kpi(), NOW);
    assert.equal(v.value, 448);
    assert.equal(v.comparison, null);
    assert.equal(v.noComparison, 'No data for the week before');
  });

  test('only the running period: its value, no comparison', () => {
    const v = kpiView(weekly([['2026-11-02', 87]]), kpi(), NOW);
    assert.equal(v.value, 87);
    assert.equal(v.label, 'This week so far');
    assert.equal(v.comparison, null);
  });

  test('months are named; Russian says "к сентябрю"', () => {
    const t: Table = { columns: [col('Month', 'date'), col('Work orders', 'number')], rows: [['2026-09-01', 100], ['2026-10-01', 97], ['2026-11-01', 5]] };
    const en = kpiView(t, kpi(), NOW);
    assert.equal(en.label, 'October');
    assert.match(en.comparison!.text, /^▼ 3(\.0)?\s?% vs September$/);
    setLangForTests('ru');
    const ru = kpiView(t, kpi(), NOW);
    assert.equal(ru.label, 'Октябрь');
    assert.match(ru.comparison!.text, /к сентябрю$/);
    assert.equal(ru.partial?.startsWith('Пока в этом месяце'), true);
    setLangForTests('en');
    // across the new year the year is said
    const jan: Table = { columns: t.columns, rows: [['2025-12-01', 10], ['2026-01-01', 12]] };
    assert.match(kpiView(jan, kpi(), NOW).comparison!.text, /vs December 2025$/);
  });

  test('going down can be good; neutral has no colour', () => {
    const t = weekly([['2026-10-19', 400], ['2026-10-26', 300]]);
    assert.equal(kpiView(t, kpi({ kpi: { upIsGood: false } }), NOW).comparison?.tone, 'good');
    assert.equal(kpiView(t, kpi({ kpi: { neutral: true } }), NOW).comparison?.tone, 'neutral');
    const flat = kpiView(weekly([['2026-10-19', 300], ['2026-10-26', 300]]), kpi(), NOW).comparison!;
    assert.equal(flat.direction, 'flat');
    assert.equal(flat.tone, 'neutral');
    assert.equal(flat.text, 'Unchanged vs the week before');
    assert.equal(kpiView(t, kpi({ kpi: { compare: false } }), NOW).comparison, null);
  });

  test('a share changes by points, not by "% of a %"; a target is told with its gap', () => {
    const t: Table = {
      columns: [col('Week', 'date'), col('Scrap rate', 'number', { format: { style: 'percent', decimals: 1 } })],
      rows: [['2026-10-19', 0.018], ['2026-10-26', 0.021], ['2026-11-02', 0.05]],
    };
    const v = kpiView(t, { version: 1, type: 'kpi', value: 'Scrap rate', kpi: { upIsGood: false, target: 0.02 } }, NOW);
    assert.equal(v.value, 0.021);
    assert.equal(v.comparison?.text, '▲ 0.3 points vs the week before');
    assert.equal(v.comparison?.tone, 'bad');
    assert.match(v.target!.text, /^Target 2\.0\s?% · 0\.1 points above$/);
    assert.equal(v.target?.tone, 'bad'); // lower is better and it is above
    const ok = kpiView(t, { version: 1, type: 'kpi', value: 'Scrap rate', kpi: { upIsGood: false, target: 0.025 } }, NOW);
    assert.equal(ok.target?.tone, 'good');
    assert.match(ok.target!.text, /0\.4 points below$/);
    const plain = kpiView(weekly([['2026-10-26', 448]]), kpi({ kpi: { target: 500 } }), NOW);
    assert.equal(plain.target?.text, 'Target 500 · 52 below');
    assert.equal(plain.target?.tone, 'bad');
    assert.equal(kpiView(weekly([['2026-10-26', 500]]), kpi({ kpi: { target: 500 } }), NOW).target?.text, 'Target 500 · on target');
  });

  test('the "vs previous period" calculation\'s value is used, with its period', () => {
    const t: Table = {
      columns: [col('Month', 'date'), col('Work orders', 'number'), col('Work orders_prev_month', 'number', { generated: true }), col('Work orders_vs_prev_month', 'number', { generated: true })],
      rows: [['2026-10-01', 120, 100, 0.2], ['2026-11-01', 4, 120, -0.97]],
    };
    const v = kpiView(t, kpi(), NOW);
    assert.equal(v.period, 'month');
    assert.equal(v.value, 120);
    assert.equal(v.comparison?.previous, 100);
    assert.match(v.comparison!.text, /^▲ 20\s?% vs September$/);
    // one row of a SQL question with the same columns, no date
    const single: Table = { columns: [col('Work orders', 'number'), col('Work orders_prev_week', 'number', { generated: true })], rows: [[90, 100]] };
    const s = kpiView(single, kpi(), NOW);
    assert.match(s.comparison!.text, /^▼ 10\s?% vs the week before$/);
  });

  test('no date: the last row vs the row before; one number alone has no comparison and no colour', () => {
    const rows: Table = { columns: [col('Work orders', 'number')], rows: [[10], [20]] };
    assert.match(kpiView(rows, kpi(), NOW).comparison!.text, /^▲ 100\s?% vs the row before$/);
    const one = kpiView({ columns: [col('Work orders', 'number')], rows: [[2000]] }, kpi(), NOW);
    assert.equal(one.value, 2000);
    assert.equal(one.comparison, null);
    assert.equal(one.noComparison, null);
  });
});
