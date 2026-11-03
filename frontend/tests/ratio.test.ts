// Ratio metrics in the metric dialog (M12): src/semantic/ratio.ts.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { columnsOfPlus, definitionOf, definitionReady, draftOf, emptyGroup, exampleSpec, exampleValues, partOf } from '../src/semantic/ratio.ts';
import type { MetricDefinition } from '../src/semantic/api.ts';

const DEMO_SCRAP_RATE: MetricDefinition = {
  fn: 'ratio',
  numerator: { fn: 'sum', ref: 'production_output.scrap_qty' },
  denominator: { fn: 'sum', expr: { op: '+', args: [{ ref: 'production_output.good_qty' }, { ref: 'production_output.scrap_qty' }] } },
};

describe('ratio metrics in the dialog', () => {
  test('the demo scrap rate opens as two totals, the second of two columns added up, and saves unchanged', () => {
    const top = draftOf(DEMO_SCRAP_RATE.numerator, 'production_output');
    const bottom = draftOf(DEMO_SCRAP_RATE.denominator, 'production_output');
    assert.deepEqual(top.columns, ['production_output.scrap_qty']);
    assert.deepEqual(bottom.columns, ['production_output.good_qty', 'production_output.scrap_qty']);
    assert.equal(bottom.formula, undefined);
    const total = draftOf(undefined, 'production_output');
    assert.deepEqual(definitionOf('ratio', total, top, bottom, emptyGroup()), DEMO_SCRAP_RATE);
    assert.ok(definitionReady('ratio', total, top, bottom));
  });

  test('a bare column name means the metric table; any other formula is kept as it is', () => {
    assert.deepEqual(draftOf({ fn: 'sum', ref: 'qty' }, 'orders').columns, ['orders.qty']);
    const formula = { op: '/' as const, args: [{ ref: 'minutes' }, { value: 60 }] as [{ ref: string }, { value: number }] };
    const d = draftOf({ fn: 'sum', expr: formula }, 'downtime_events');
    assert.deepEqual(d.columns, []);
    assert.deepEqual(partOf(d), { fn: 'sum', expr: formula });
    assert.equal(columnsOfPlus(formula, 't'), null);
  });

  test('only sums and averages add columns up; count needs no column; empty conditions are left out', () => {
    const where = { op: 'and' as const, rules: [{ op: '=' as const, value: '' }] }; // a condition without a column yet
    assert.deepEqual(partOf({ fn: 'max', columns: ['t.a', 't.b'], where }), { fn: 'max', ref: 't.a' });
    assert.deepEqual(partOf({ fn: 'count', columns: ['t.a'], where: emptyGroup() }), { fn: 'count' });
    const paid = { op: 'and' as const, rules: [{ ref: 't.status', op: '=' as const, value: 'paid' }] };
    assert.deepEqual(partOf({ fn: 'count', columns: [], where: paid }), { fn: 'count', where: paid });
    assert.equal(definitionReady('ratio', draftOf(undefined, 't'), { fn: 'sum', columns: [''], where: emptyGroup() }, { fn: 'count', columns: [], where: emptyGroup() }), false);
  });

  test('one total keeps the shape of the metrics made before M12', () => {
    const paid = { op: 'and' as const, rules: [{ ref: 'orders.status', op: '=' as const, value: 'paid' }] };
    const empty = draftOf(undefined, 'orders');
    const d = definitionOf('total', { fn: 'sum', columns: ['orders.total'], where: emptyGroup() }, empty, empty, paid);
    assert.deepEqual(d, { fn: 'sum', ref: 'orders.total', where: paid });
  });

  test('the live example asks for the ratio and its two totals over all rows', () => {
    const both = { op: 'and' as const, rules: [{ ref: 'production_output.good_qty', op: '>' as const, value: 0 }] };
    const spec = exampleSpec('demo', 'production_output', { ...DEMO_SCRAP_RATE, where: both }) as { aggregations: Record<string, unknown>[]; source: unknown };
    assert.deepEqual(spec.source, { table: 'production_output' });
    assert.deepEqual(spec.aggregations.map((a) => a.alias), ['value', 'top', 'bottom']);
    assert.deepEqual(spec.aggregations[1], { fn: 'sum', ref: 'production_output.scrap_qty', where: both, alias: 'top' });
    assert.equal((exampleSpec('demo', 't', { fn: 'count' }) as { aggregations: unknown[] }).aggregations.length, 1);
    assert.deepEqual(exampleValues([0.024, 1234, '51000']), { value: 0.024, top: 1234, bottom: 51000 });
    assert.deepEqual(exampleValues([null, 5, 0]), { value: null, top: 5, bottom: 0 });
  });
});
