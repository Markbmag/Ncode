// Preview per step and "ask before removing" (M12): src/query/preview.ts, src/query/loss.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { SchemaTable } from '../src/api.ts';
import { lossText, stepLoss, tableChangeLoss, withoutStep } from '../src/query/loss.ts';
import { PREVIEW_ROWS, previewRequest, specUpTo } from '../src/query/preview.ts';
import type { QuerySpec } from '../src/query/types.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const col = (name: string, type: SchemaTable['columns'][number]['type']) => ({ name, type, db_type: type, nullable: true, primary_key: false, foreign_key: null });
const SCHEMA = {
  tables: [
    { name: 'orders', primary_key: ['id'], columns: [col('id', 'number'), col('customer_id', 'number'), col('status', 'string'), col('total', 'number')] },
    { name: 'customers', primary_key: ['id'], columns: [col('id', 'number'), col('region', 'string')] },
  ] as SchemaTable[],
  relationships: [{ from_table: 'orders', from_columns: ['customer_id'], to_table: 'customers', to_columns: ['id'] }],
};

const FULL: QuerySpec = {
  version: 1,
  connection: 'shop',
  source: { table: 'orders' },
  joins: [{ table: 'customers', type: 'left' }],
  expressions: [{ name: 'double', expr: { op: '*', args: [{ ref: 'orders.total' }, { value: 2 }] } }],
  filters: { op: 'and', rules: [{ ref: 'orders.status', op: '=', value: 'paid' }, { op: '=', value: '' }, { op: 'or', rules: [{ ref: 'customers.region', op: 'in', param: 'region' }] }] },
  aggregations: [{ fn: 'sum', ref: 'orders.total' }],
  breakouts: [{ ref: 'customers.region' }],
  having: { op: 'and', rules: [{ ref: 'sum_total', op: '>', value: 10 }] },
  order: [{ ref: 'sum_total', dir: 'desc' }],
  transforms: [{ type: 'pct_of_total', column: 'sum_total' }],
  limit: 5,
};

describe('preview per step', () => {
  test('each step sees what comes before it, and only the first rows', () => {
    assert.deepEqual(specUpTo(FULL, 'data'), { version: 1, connection: 'shop', source: { table: 'orders' }, limit: PREVIEW_ROWS });
    const joined = specUpTo(FULL, 'join');
    assert.deepEqual(joined.joins, FULL.joins);
    assert.equal(joined.expressions, undefined);
    const filtered = specUpTo(FULL, 'filter');
    assert.ok(filtered.expressions && filtered.filters);
    assert.equal(filtered.aggregations, undefined, 'rows before the summary');
    const summarised = specUpTo(FULL, 'summarise');
    assert.deepEqual([summarised.aggregations, summarised.breakouts, summarised.having, summarised.order], [FULL.aggregations, FULL.breakouts, undefined, undefined]);
    const sorted = specUpTo(FULL, 'sort');
    assert.ok(sorted.having && sorted.order && !sorted.transforms);
    assert.equal(specUpTo(FULL, 'limit').limit, 5, "the question's own smaller limit");
    assert.equal(specUpTo({ ...FULL, limit: 500 }, 'limit').limit, PREVIEW_ROWS);
    assert.equal(specUpTo(FULL, 'calculate').limit, PREVIEW_ROWS);
  });

  test('the request is cleaned like the question and fills in parameter values', () => {
    const defs = [{ name: 'region', type: 'text' as const, label: 'Region' }];
    const asked = previewRequest(FULL, 'filter', SCHEMA, defs, { region: 'EU' });
    assert.deepEqual(asked.problems, []);
    assert.deepEqual(asked.spec.filters, { op: 'and', rules: [{ ref: 'orders.status', op: '=', value: 'paid' }, { op: 'or', rules: [{ ref: 'customers.region', op: 'in', value: ['EU'] }] }] });
    const missing = previewRequest(FULL, 'filter', SCHEMA, [{ ...defs[0], required: true }], {});
    assert.equal(missing.problems.length, 1);
    const data = previewRequest(FULL, 'data', SCHEMA, defs, {});
    assert.deepEqual(data.spec, { version: 1, connection: 'shop', source: { table: 'orders' }, limit: PREVIEW_ROWS });
  });
});

describe('what a destructive change removes', () => {
  test('changing the table names everything but the row limit', () => {
    setLangForTests('en');
    const loss = tableChangeLoss(FULL);
    assert.equal(loss.filters, 2, 'the empty filter row does not count');
    assert.equal(loss.limit, false);
    assert.equal(
      lossText(loss),
      'the data from 1 other table, 1 formula column, 2 filters, the summary, the sorting and 1 calculation',
    );
    const simple: QuerySpec = { version: 1, connection: 'shop', source: { table: 'orders' }, filters: { op: 'and', rules: [{ ref: 'orders.status', op: '=', value: 'paid' }, { ref: 'orders.total', op: '>', value: 1 }] }, aggregations: [{ fn: 'count' }] };
    assert.equal(lossText(tableChangeLoss(simple)), '2 filters and the summary');
    assert.equal(lossText(tableChangeLoss({ version: 1, connection: 'shop', source: { table: 'orders' }, limit: 10 })), null, 'nothing to ask');
    assert.equal(lossText(tableChangeLoss(null)), null);
  });

  test('in Russian', () => {
    setLangForTests('ru');
    const simple: QuerySpec = { version: 1, connection: 'shop', source: { table: 'orders' }, filters: { op: 'and', rules: [{ ref: 'orders.status', op: '=', value: 'paid' }, { ref: 'orders.total', op: '>', value: 1 }] }, aggregations: [{ fn: 'count' }] };
    assert.equal(lossText(tableChangeLoss(simple)), '2 фильтра и итоги');
    setLangForTests('en');
  });

  test('removing a step removes only what it holds', () => {
    assert.equal(lossText(stepLoss(FULL, 'sort')), 'the sorting');
    assert.equal(lossText(stepLoss(FULL, 'having')), '1 filter');
    assert.equal(lossText(stepLoss(FULL, 'limit')), 'the row limit');
    assert.equal(lossText(stepLoss({ ...FULL, order: [{ ref: '', dir: 'asc' }] }, 'sort')), null, 'an empty sort row is not worth asking');
    const cleared = withoutStep(FULL, 'join');
    assert.deepEqual(cleared.joins, []);
    assert.deepEqual(cleared.filters, FULL.filters);
    assert.equal(withoutStep(FULL, 'limit').limit, null);
  });
});
