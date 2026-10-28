import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { formatValue } from '../src/lib/format.ts';
import { histogram, kpiValues, seriesData, toNumber } from '../src/viz/data.ts';
import type { Table } from '../src/viz/data.ts';
import { formatCell } from '../src/viz/format.ts';
import { buildOption } from '../src/viz/options.ts';
import { chartTheme } from '../src/viz/palette.ts';
import type { VizSpec } from '../src/viz/types.ts';

// The backend sends integers beyond 2^53 and decimals with more than 15 digits as exact text (M10).
const mixed: Table = {
  columns: [
    { name: 'month', type: 'date', role: 'dimension' },
    { name: 'amount', type: 'number', role: 'measure' },
  ],
  rows: [
    ['2026-01-01', 10],
    ['2026-02-01', '12345678901234567890'],
    ['2026-03-01', '1E+400'],
    ['infinity', null],
  ],
};

describe('numbers that arrive as text', () => {
  test('are shown unchanged', () => {
    assert.equal(formatValue('12345678901234567890', 'number', 'measure'), '12345678901234567890');
    assert.equal(formatValue('12345678901234567890.123', 'number', 'measure', { smartDates: true }), '12345678901234567890.123');
    assert.equal(formatCell('9007199254740993', 'number', 'id'), '9007199254740993');
    assert.equal(formatValue('infinity', 'datetime'), 'infinity');
    assert.equal(formatValue('838:59:59', 'unknown'), '838:59:59');
  });

  test('charts read them as numbers when finite and skip the rest', () => {
    assert.equal(toNumber('12345678901234567890'), Number('12345678901234567890'));
    assert.equal(toNumber('1E+400'), null);
    assert.equal(toNumber('-Infinity'), null);
    assert.equal(toNumber('abc'), null);
    const viz: VizSpec = { type: 'line', x: 'month', series: [{ y: 'amount' }] } as VizSpec;
    const data = seriesData(mixed, viz);
    assert.deepEqual(data.series[0].values, [10, Number('12345678901234567890'), null, null]);
    assert.ok(kpiValues(mixed, 'amount').trend.every(Number.isFinite));
    assert.ok(histogram(mixed, 'amount').every((b) => Number.isFinite(b.from) && Number.isFinite(b.to)));
    for (const type of ['line', 'bar', 'kpi', 'histogram', 'table'] as const) {
      const option = buildOption(mixed, { ...viz, type } as VizSpec, chartTheme('light'));
      assert.ok(option === null || JSON.stringify(option) !== undefined);
    }
  });
});
