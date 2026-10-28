// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLangForTests } from '../src/i18n/index.ts';
import {
  byLabel,
  cleanTranslations,
  connectionLabel,
  columnDescription,
  columnLabel,
  descriptionIn,
  descriptionOf,
  differsFromTechnical,
  labelIn,
  metricDescription,
  metricName,
  nameMatches,
  nameOf,
  pickText,
  prettify,
  setTranslation,
  tableDescription,
  tableLabel,
} from '../src/lib/names.ts';
import { queryClient, queryKeys } from '../src/lib/queryClient.ts';

const RU = { ru: { display_name: 'Заказы', description: 'Все заказы' } };

test('pickText: the UI language first, then the base text, blank counts as missing', () => {
  setLangForTests('en');
  assert.equal(pickText('Orders', RU, 'display_name'), 'Orders');
  assert.equal(pickText(null, RU, 'display_name'), null);
  setLangForTests('ru');
  assert.equal(pickText('Orders', RU, 'display_name'), 'Заказы');
  assert.equal(pickText('Orders', { ru: { display_name: '  ' } }, 'display_name'), 'Orders');
  assert.equal(pickText('Orders', { ru: null }, 'display_name'), 'Orders');
  assert.equal(pickText('Orders', null, 'display_name'), 'Orders');
  assert.equal(pickText('', undefined, 'display_name'), null);
  assert.equal(pickText(null, RU, 'description'), 'Все заказы');
  setLangForTests('en');
});

test('names fall back to the technical name made readable', () => {
  setLangForTests('en');
  assert.equal(prettify('order_items'), 'Order items');
  assert.equal(prettify('orderId'), 'Order Id');
  assert.equal(nameOf('order_items'), 'Order items');
  assert.equal(nameOf('order_items', { display_name: 'Order lines' }), 'Order lines');
  assert.equal(nameOf('orders', { display_name: null, translations: RU }), 'Orders');
  setLangForTests('ru');
  assert.equal(nameOf('orders', { display_name: null, translations: RU }), 'Заказы');
  assert.equal(descriptionOf({ description: 'All orders', translations: RU }), 'Все заказы');
  assert.equal(descriptionOf(null), null);
  setLangForTests('en');
  assert.equal(differsFromTechnical('order_items', 'Order items'), false);
  assert.equal(differsFromTechnical('order_items', 'Order lines'), true);
});

test('metrics translate name and description', () => {
  const m = { name: 'Scrap rate', description: 'Scrapped / produced', translations: { ru: { name: 'Доля брака' } } };
  setLangForTests('en');
  assert.equal(metricName(m), 'Scrap rate');
  setLangForTests('ru');
  assert.equal(metricName(m), 'Доля брака');
  assert.equal(metricDescription(m), 'Scrapped / produced');
  setLangForTests('en');
});

test('searching finds a thing by its technical or its friendly name', () => {
  assert.equal(nameMatches('ord', 'work_orders', 'Production orders'), true);
  assert.equal(nameMatches('заказ', 'work_orders', 'Производственные заказы'), true);
  assert.equal(nameMatches('ORDERS', 'work_orders', null), true);
  assert.equal(nameMatches('downtime', 'work_orders', 'Production orders'), false);
  assert.equal(nameMatches('  ', 'anything'), true);
});

test('tableLabel / columnLabel read the names already loaded for the connection', () => {
  setLangForTests('en');
  queryClient.clear();
  assert.equal(tableLabel('c1', 'work_orders'), 'Work orders');
  assert.equal(columnLabel('c1', 'work_orders', 'qty_ok'), 'Qty ok');

  // the table list (GET /api/connections/{key}/tables) carries the table names
  queryClient.setQueryData(queryKeys.tables('c1'), [
    { name: 'work_orders', columns: 3, searchable: 1, display_name: 'Work orders (plan)', translations: { ru: { display_name: 'Заказы' } } },
  ]);
  assert.equal(tableLabel('c1', 'work_orders'), 'Work orders (plan)');
  setLangForTests('ru');
  assert.equal(tableLabel('c1', 'work_orders'), 'Заказы');

  // GET /api/semantic/{c}/tables wins over the list; another connection has its own names
  queryClient.setQueryData(queryKeys.tableNames('c1'), { work_orders: { display_name: 'Orders', description: 'Plan', translations: null } });
  assert.equal(tableLabel('c1', 'work_orders'), 'Orders');
  assert.equal(tableDescription('c1', 'work_orders'), 'Plan');
  assert.equal(tableLabel('c2', 'work_orders'), 'Work orders');

  // columns come from the schema
  queryClient.setQueryData(queryKeys.schema('c1'), {
    connection: 'c1', version: 2, relationships: [],
    tables: [{ name: 'work_orders', primary_key: [], columns: [
      { name: 'qty_ok', type: 'number', display_name: 'Good parts', description: 'Without scrap', translations: { ru: { display_name: 'Годные детали' } } },
      { name: 'line_id', type: 'number' },
    ] }],
  });
  assert.equal(columnLabel('c1', 'work_orders', 'qty_ok'), 'Годные детали');
  assert.equal(columnDescription('c1', 'work_orders', 'qty_ok'), 'Without scrap');
  assert.equal(columnLabel('c1', 'work_orders', 'line_id'), 'Line id');
  assert.equal(columnDescription('c1', 'work_orders', 'line_id'), null);
  setLangForTests('en');
  queryClient.clear();
});

test('lists sort by the friendly name and say when to show the technical one', () => {
  setLangForTests('ru');
  const tables = [
    { name: 'work_orders', display_name: 'Work orders', translations: { ru: { display_name: 'Заказы' } } },
    { name: 'shifts', display_name: 'Shifts', translations: { ru: { display_name: 'Смены' } } },
    { name: 'audit_log' },
  ];
  const listed = byLabel(tables);
  assert.deepEqual(listed.map((l) => l.label), ['Заказы', 'Смены', 'Audit log']); // Russian collation: Cyrillic first
  assert.deepEqual(listed.map((l) => l.showTechnical), [true, true, false]);
  assert.equal(labelIn(tables, 'shifts'), 'Смены');
  assert.equal(labelIn(tables, 'unknown_table'), 'Unknown table');
  assert.equal(labelIn(null, 'x_y'), 'X y');
  assert.equal(descriptionIn(tables, 'shifts'), null);
  setLangForTests('en');
  assert.deepEqual(byLabel(tables).map((l) => l.name), ['audit_log', 'shifts', 'work_orders']);
});

test('translations are cleaned before they are saved', () => {
  assert.equal(cleanTranslations(null), null);
  assert.equal(cleanTranslations({ ru: { display_name: '  ', description: '' } }), null);
  assert.deepEqual(cleanTranslations({ ru: { display_name: ' Заказы ', description: '' }, de: null }), { ru: { display_name: 'Заказы' } });
  const tr = setTranslation(null, 'ru', 'display_name', 'Смены');
  assert.deepEqual(setTranslation(tr, 'ru', 'description', 'Три смены'), { ru: { display_name: 'Смены', description: 'Три смены' } });
  assert.deepEqual(tr, { ru: { display_name: 'Смены' } }); // not changed in place
});

test('the demo database is named in the UI language', () => {
  setLangForTests('ru');
  assert.equal(connectionLabel({ label: 'Factory demo', source: 'demo' }), 'Демо: завод');
  assert.equal(connectionLabel({ label: 'Factory demo', source: 'ui' }), 'Factory demo'); // an admin's own database
  setLangForTests('en');
  assert.equal(connectionLabel({ label: 'Factory demo', source: 'demo' }), 'Factory demo');
});
