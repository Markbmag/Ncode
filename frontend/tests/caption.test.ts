// Run with: npm test
// M11: readable result names (src/query/outputs.ts) and the "what am I looking at" caption (src/query/caption.ts).
import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import type { ResultColumn, SchemaTable } from '../src/api.ts';
import { setLangForTests } from '../src/i18n/index.ts';
import { captionOf, questionCaption, relativeText, sqlCaption } from '../src/query/caption.ts';
import { columnOptions, prepareSpec } from '../src/query/draft.ts';
import { labelColumns, namerFromModel, namerFromOptions, outputLabels, plainNamer } from '../src/query/outputs.ts';
import { applicableSteps, usedSteps } from '../src/query/steps.ts';
import type { QuerySpec } from '../src/query/types.ts';

const col = (name: string, type: SchemaTable['columns'][number]['type'], extra: Partial<SchemaTable['columns'][number]> = {}) => ({
  name, type, db_type: type, nullable: true, primary_key: false, foreign_key: null, ...extra,
});

const TABLES: SchemaTable[] = [
  {
    name: 'orders', primary_key: ['id'],
    display_name: 'Orders', translations: { ru: { display_name: 'Заказы' } },
    columns: [
      col('id', 'number'),
      col('customer_id', 'number'),
      col('total', 'number', { display_name: 'Total', description: 'Order value after discounts', translations: { ru: { display_name: 'Итого', description: 'Сумма заказа со скидками' } } }),
      col('status', 'string', { translations: { ru: { display_name: 'Статус' } } }),
      col('created_at', 'datetime', { translations: { ru: { display_name: 'Создано' } } }),
    ],
  },
  { name: 'customers', primary_key: ['id'], columns: [col('id', 'number'), col('name', 'string'), col('region', 'string')] },
];
const SCHEMA = {
  tables: TABLES,
  relationships: [{ from_table: 'orders', from_columns: ['customer_id'], to_table: 'customers', to_columns: ['id'] }],
};

const base = (extra: Partial<QuerySpec> = {}): QuerySpec => ({ version: 1, connection: 'shop', source: { table: 'orders' }, ...extra });

/** The lead's example: sum per month, paid only, the last 90 days, top 10. */
const TOP10: QuerySpec = base({
  aggregations: [{ fn: 'sum', ref: 'orders.total' }],
  breakouts: [{ ref: 'orders.created_at', bucket: 'month' }],
  filters: {
    op: 'and',
    rules: [
      { ref: 'orders.status', op: '=', value: 'paid' },
      { ref: 'orders.created_at', op: 'last', value: { amount: 90, unit: 'day' } },
    ],
  },
  order: [{ ref: 'sum_total', dir: 'desc' }],
  limit: 10,
});

const namer = (spec: QuerySpec) => {
  const options = columnOptions(spec, SCHEMA);
  return {
    options,
    namer: namerFromOptions(options, { table: (name) => (name === 'orders' ? 'Orders' : name) }),
  };
};

afterEach(() => setLangForTests('en'));

describe('readable result names', () => {
  test('generated names read like the builder: Sum of Total, Created at: month, Count', () => {
    setLangForTests('en');
    const spec = prepareSpec(base({ aggregations: [{ fn: 'sum', ref: 'orders.total' }, { fn: 'count' }], breakouts: [{ ref: 'orders.created_at', bucket: 'month' }] }), SCHEMA).spec;
    const labels = outputLabels(spec, namer(spec).namer);
    assert.deepEqual([...labels.entries()].map(([k, v]) => [k, v.label]), [
      ['created_at_month', 'Created at: month'],
      ['sum_total', 'Sum of Total'],
      ['count', 'Count'],
    ]);
    assert.equal(labels.get('sum_total')?.description, 'Order value after discounts');
  });

  test('in Russian, with the data model’s translations', () => {
    setLangForTests('ru');
    const spec = prepareSpec(base({ aggregations: [{ fn: 'sum', ref: 'orders.total' }, { fn: 'count' }], breakouts: [{ ref: 'orders.created_at', bucket: 'month' }, { ref: 'orders.total', bin_width: 10 }] }), SCHEMA).spec;
    const labels = outputLabels(spec, namer(spec).namer);
    assert.deepEqual([...labels.values()].map((v) => v.label), ['Создано: месяц', 'Итого: диапазоны по 10', 'Сумма «Итого»', 'Количество']);
    assert.equal(labels.get('sum_total')?.description, 'Сумма заказа со скидками');
  });

  test('a name someone typed stays; duplicates get the server’s _2', () => {
    setLangForTests('en');
    const spec = prepareSpec(base({ aggregations: [{ fn: 'sum', ref: 'orders.total', alias: 'Revenue' }, { fn: 'sum', ref: 'orders.total' }, { fn: 'sum', ref: 'orders.total' }] }), SCHEMA).spec;
    const labels = outputLabels(spec, namer(spec).namer);
    assert.deepEqual([...labels.entries()].map(([k, v]) => [k, v.label]), [
      ['Revenue', 'Revenue'],
      ['sum_total', 'Sum of Total'],
      ['sum_total_2', 'Sum of Total'],
    ]);
  });

  test('raw rows: every column, with its table when the question reads two; calculations name their base', () => {
    setLangForTests('en');
    const spec = base({ joins: [{ table: 'customers', type: 'left' }], transforms: [{ type: 'running_total', column: 'total' }, { type: 'previous_period', column: 'total', period: 'year' }] });
    const { options, namer: n } = namer(spec);
    const labels = outputLabels(spec, n, options);
    assert.equal(labels.get('total')?.label, 'Orders → Total');
    assert.equal(labels.get('id_2')?.label, 'Customers → Id'); // the second "id", as the server names it
    assert.equal(labels.get('total_running_total')?.label, 'Orders → Total: running total');
    assert.equal(labels.get('total_prev_year')?.label, 'Orders → Total: last year');
    assert.equal(labels.get('total_vs_prev_year')?.label, 'Orders → Total: change vs last year');
  });

  test('saved metrics show their name, not the slug', () => {
    setLangForTests('en');
    const spec = base({ aggregations: [{ fn: 'metric', metric: 3, alias: 'revenue' }] });
    const n = namerFromOptions([], { metric: (id) => (id === 3 ? { label: 'Net revenue', description: 'Paid orders only', slug: 'revenue' } : undefined) });
    assert.deepEqual(outputLabels(spec, n).get('revenue'), { label: 'Net revenue', description: 'Paid orders only' });
  });

  test('labelColumns fills display names and keeps the technical name', () => {
    setLangForTests('ru');
    const columns: ResultColumn[] = [
      { name: 'sum_total', type: 'number', role: 'measure' },
      { name: 'status', type: 'string', role: 'dimension', description: 'Order status', translations: { ru: { description: 'Статус заказа' } } },
      { name: 'other', type: 'string', role: 'dimension' },
    ];
    const out = labelColumns(columns, new Map([['sum_total', { label: 'Сумма «Итого»' }], ['status', { label: 'Статус' }]]));
    assert.deepEqual(out.map((c) => [c.name, c.display_name ?? null, c.description ?? null]), [
      ['sum_total', 'Сумма «Итого»', null],
      ['status', 'Статус', 'Статус заказа'],
      ['other', null, null],
    ]);
    assert.equal(labelColumns(columns, null), columns);
  });
});

describe('caption: what am I looking at', () => {
  test('the example in English', () => {
    setLangForTests('en');
    assert.equal(questionCaption(TOP10, namer(TOP10).namer), 'Sum of Total per month · Status is paid · last 90 days · top 10');
  });

  test('the example in Russian', () => {
    setLangForTests('ru');
    assert.equal(questionCaption(TOP10, namer(TOP10).namer), 'Сумма «Итого» по месяцам · Статус — paid · последние 90 дней · первые 10');
  });

  test('the prepared spec (aliases set) reads the same', () => {
    setLangForTests('en');
    assert.equal(questionCaption(prepareSpec(TOP10, SCHEMA).spec, namer(TOP10).namer), 'Sum of Total per month · Status is paid · last 90 days · top 10');
  });

  test('count, several groupings, a grouping by a column', () => {
    setLangForTests('en');
    const spec = base({ aggregations: [{ fn: 'count' }, { fn: 'avg', ref: 'orders.total' }], breakouts: [{ ref: 'orders.status' }, { ref: 'orders.created_at', bucket: 'week' }] });
    assert.equal(questionCaption(spec, namer(spec).namer), 'Count of Orders and average of Total per Status and per week');
    setLangForTests('ru');
    assert.equal(
      questionCaption(spec, namerFromOptions(columnOptions(spec, SCHEMA), { table: () => 'Заказы' })),
      'Количество строк таблицы «Заказы» и среднее «Итого» по столбцу «Статус» и по неделям',
    );
  });

  test('raw rows, with joined tables', () => {
    setLangForTests('en');
    assert.equal(questionCaption(base(), plainNamer), 'Rows of Orders');
    const joined = base({ joins: [{ table: 'customers', type: 'left' }], limit: 50 });
    assert.equal(questionCaption(joined, plainNamer), 'Rows of Orders with Customers · first 50 rows');
    setLangForTests('ru');
    assert.equal(questionCaption(joined, { ...plainNamer, table: (n) => ({ orders: 'Заказы', customers: 'Клиенты' })[n] ?? n }), 'Строки таблицы «Заказы» с данными из «Клиенты» · первые 50 строк');
  });

  test('filters of every kind, in both languages', () => {
    const spec = base({
      filters: {
        op: 'and',
        rules: [
          { ref: 'orders.status', op: 'in', value: ['paid', 'shipped', 'refunded', 'new', 'lost'] },
          { ref: 'orders.total', op: 'between', value: [10, 1000] },
          { ref: 'orders.created_at', op: '>=', value: '2026-01-31' },
          { op: 'or', rules: [{ ref: 'orders.status', op: 'contains', value: 'ship' }, { ref: 'orders.customer_id', op: 'is_null' }] },
          { ref: 'orders.status', op: '=', param: 'status' },
          { ref: 'orders.status', op: '=', value: '' }, // half typed: still shown as empty
        ],
      },
    });
    setLangForTests('en');
    assert.equal(
      questionCaption(spec, namer(spec).namer),
      'Rows of Orders · Status is paid, shipped, refunded or 2 more · Total between 10 and 1,000 · Created at on or after 31 Jan 2026'
        + ' · (Status contains “ship” or Customer id is empty) · Status: chosen when it runs · Status is —',
    );
    setLangForTests('ru');
    assert.equal(
      questionCaption(spec, namer(spec).namer),
      'Строки таблицы «Orders» · Статус — paid, shipped, refunded или ещё 2 · Итого от 10 до 1 000 · Создано с 31.01.2026'
        + ' · (Статус содержит «ship» или Customer id — пусто) · Статус: выбирается при запуске · Статус — —',
    );
  });

  test('"or" at the top is one part; several date filters name their column', () => {
    setLangForTests('en');
    const spec = base({
      filters: {
        op: 'or',
        rules: [
          { ref: 'orders.created_at', op: 'current', value: { unit: 'month' } },
          { ref: 'orders.created_at', op: 'last', value: { amount: 1, unit: 'year' } },
        ],
      },
    });
    assert.equal(questionCaption(spec, namer(spec).namer), 'Rows of Orders · Created at: this month or Created at: last year');
  });

  test('relative dates', () => {
    setLangForTests('en');
    assert.equal(relativeText('last', { amount: 1, unit: 'day' }), 'yesterday');
    assert.equal(relativeText('last', { amount: 3, unit: 'month', include_current: true }), 'last 3 months incl. this month');
    assert.equal(relativeText('current', { unit: 'quarter' }), 'this quarter');
    setLangForTests('ru');
    assert.equal(relativeText('last', { amount: 2, unit: 'week' }), 'последние 2 недели');
    assert.equal(relativeText('last', { amount: 5, unit: 'year' }), 'последние 5 лет');
    assert.equal(relativeText('last', { amount: 1, unit: 'month' }), 'прошлый месяц');
    assert.equal(relativeText('current', { unit: 'day' }), 'сегодня');
  });

  test('filter the summary, and "top N by" when the sort is not the only number', () => {
    setLangForTests('en');
    const spec = base({
      aggregations: [{ fn: 'sum', ref: 'orders.total' }, { fn: 'count' }],
      breakouts: [{ ref: 'orders.status' }],
      having: { op: 'and', rules: [{ ref: 'sum_total', op: '>', value: 1000 }] },
      order: [{ ref: 'count', dir: 'asc' }],
      limit: 3,
    });
    assert.equal(questionCaption(spec, namer(spec).namer), 'Sum of Total and count of Orders per Status · Sum of Total > 1,000 · bottom 3 by Count');
    setLangForTests('ru');
    assert.equal(
      questionCaption(spec, namerFromOptions(columnOptions(spec, SCHEMA), { table: () => 'Заказы' })),
      'Сумма «Итого» и количество строк таблицы «Заказы» по столбцу «Статус» · Сумма «Итого» > 1 000 · первые 3 по возрастанию: Количество',
    );
  });

  test('the latest rows by a date; a limit sorted by text is just the first rows', () => {
    setLangForTests('en');
    const byDate = base({ order: [{ ref: 'orders.created_at', dir: 'desc' }], limit: 20 });
    assert.equal(questionCaption(byDate, namer(byDate).namer), 'Rows of Orders · latest 20 by Created at');
    const byText = base({ order: [{ ref: 'orders.status', dir: 'asc' }], limit: 1 });
    assert.equal(questionCaption(byText, namer(byText).namer), 'Rows of Orders · first 1 row');
  });

  test('SQL and multi-source questions', () => {
    setLangForTests('en');
    assert.equal(sqlCaption(null), 'Written in SQL');
    assert.equal(sqlCaption('  \nScrap per line, from the MES.\nSecond line'), 'Written in SQL · Scrap per line, from the MES.');
    assert.equal(captionOf({ kind: 'sql', spec: { sql: 'select 1' }, description: 'Daily check' }), 'Written in SQL · Daily check');
    assert.equal(captionOf({ kind: 'federated', spec: {}, description: null }), 'Combines data from several sources');
    assert.equal(captionOf({ kind: 'builder', spec: TOP10 }), 'Sum of Total per month · Status is paid · last 90 days · top 10');
    assert.equal(captionOf({ kind: 'builder', spec: null, description: 'Old' }), 'Old');
    setLangForTests('ru');
    assert.equal(sqlCaption('Брак по линиям'), 'Написан на SQL · Брак по линиям');
  });

  test('from the data model alone (dashboard cards): aliases, custom columns, missing names', () => {
    const spec = base({
      source: { table: 'orders', alias: 'o' },
      joins: [{ table: 'customers', type: 'left', alias: 'c' }],
      expressions: [{ name: 'Net', expr: { ref: 'o.total' } }],
      aggregations: [{ fn: 'sum', ref: 'Net' }],
      breakouts: [{ ref: 'c.region' }],
    });
    const meta: Record<string, Record<string, { display_name?: string; translations?: Record<string, Record<string, string>> }>> = {
      customers: { region: { display_name: 'Sales region', translations: { ru: { display_name: 'Регион продаж' } } } },
    };
    const lookup = (table: string, column: string) => meta[table]?.[column] ?? null;
    setLangForTests('en');
    assert.equal(questionCaption(spec, namerFromModel(spec, lookup)), 'Sum of Net per Sales region');
    setLangForTests('ru');
    assert.equal(questionCaption(spec, namerFromModel(spec, lookup)), 'Сумма «Net» по столбцу «Регион продаж»');
  });
});

describe('builder steps shown at first (M11)', () => {
  test('only the steps a question uses come out from under "More steps"', () => {
    assert.deepEqual([...usedSteps(base())], []);
    assert.deepEqual([...usedSteps(null)], []);
    assert.deepEqual([...usedSteps(TOP10)].sort(), ['limit', 'sort']);
    const all = base({
      joins: [{ table: 'customers', type: 'left' }],
      expressions: [{ name: 'Net', expr: { ref: 'orders.total' } }],
      having: { op: 'and', rules: [{ ref: 'count', op: '>', value: 1 }] },
      fields: [{ ref: 'orders.id' }],
      transforms: [{ type: 'rank', column: 'total' }],
    });
    assert.deepEqual([...usedSteps(all)].sort(), ['calculate', 'columns', 'custom', 'having', 'join']);
    assert.deepEqual([...usedSteps(base({ having: { op: 'and', rules: [] }, order: [] }))], []);
  });

  test('"Filter the summary" only for a summary, "Columns" only for rows', () => {
    assert.deepEqual(applicableSteps(base()), ['join', 'custom', 'columns', 'sort', 'calculate', 'limit']);
    assert.deepEqual(applicableSteps(TOP10), ['join', 'custom', 'having', 'sort', 'calculate', 'limit']);
  });
});
