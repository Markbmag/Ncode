import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupByKind, problemText } from '../src/admin/brokenContent.ts';
import type { BrokenItem } from '../src/admin/brokenContent.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const item = (over: Partial<BrokenItem>): BrokenItem => ({
  kind: 'question', id: 1, name: 'Q', owner: null, collection: null, problem: 'Server text.', code: 'missing_column',
  params: { column: 'orders.qty' }, link: '/questions/1', connection: 'mes', ...over,
});

test('problems read as sentences in both languages', () => {
  setLangForTests('en');
  assert.equal(problemText(item({})), 'The column orders.qty no longer exists.');
  assert.equal(problemText(item({ code: 'missing_table', params: { table: 'parts', connection: 'mes', source: 'Orders' } })),
    'Source Orders: The table parts no longer exists in mes.');
  assert.equal(problemText(item({ kind: 'dashboard', code: 'archived_question', params: { question: 'Scrap', card: 'Scrap card' } })),
    'Card Scrap card: It shows the question Scrap, which is in the archive.');
  assert.equal(problemText(item({ code: 'something_new', params: {} })), 'Server text.');
  setLangForTests('ru');
  assert.equal(problemText(item({})), 'Столбца orders.qty больше нет.');
  setLangForTests('en');
});

test('items are grouped by kind in a fixed order, empty groups left out', () => {
  const groups = groupByKind([item({ kind: 'dataset', id: 3 }), item({ id: 1 }), item({ kind: 'dataset', id: 4 })]);
  assert.deepEqual(groups.map(([k, list]) => [k, list.map((i) => i.id)]), [['question', [1]], ['dataset', [3, 4]]]);
});
