// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  canPick, labelsOf, listText, optionText, pickInList, recentValues, rememberValues, searchTerm, splitList, typedValues, valueSourceOf,
} from '../src/query/valuePicker.ts';
import type { SchemaInfo } from '../src/query/draft.ts';
import type { SchemaColumn } from '../src/api.ts';

const col = (name: string, type: SchemaColumn['type'], fk: SchemaColumn['foreign_key'] = null): SchemaColumn => ({
  name, type, db_type: '', nullable: true, primary_key: name === 'id', foreign_key: fk,
});

const SCHEMA: SchemaInfo = {
  tables: [
    { name: 'downtime_events', primary_key: ['id'], columns: [col('id', 'number'), col('line_id', 'number', { table: 'production_lines', column: 'id' }), col('comment', 'string')] },
    { name: 'production_lines', primary_key: ['id'], columns: [col('id', 'number'), col('name', 'string')] },
  ],
  relationships: [{ from_table: 'downtime_events', from_columns: ['line_id'], to_table: 'production_lines', to_columns: ['id'] }],
};

class MemoryStore {
  items = new Map<string, string>();
  getItem(key: string) {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.items.set(key, value);
  }
}

describe('value pickers', () => {
  test('an id reads with its name', () => {
    assert.equal(optionText({ value: 3, label: 'Paint line' }), '3 · Paint line');
    assert.equal(optionText({ value: 'paid' }), 'paid');
    assert.equal(optionText({ value: 'A', label: 'A' }), 'A');
  });

  test('typing a list: commas separate, numbers stay numbers in a number column', () => {
    assert.deepEqual(splitList(' a, b , ,c'), ['a', 'b', 'c']);
    assert.deepEqual(typedValues('3, 4, x', 'number'), [3, 4, 'x']);
    assert.deepEqual(typedValues('3, 4', 'string'), ['3', '4']);
    assert.equal(listText([3, 'b']), '3, b');
  });

  test('the list is narrowed only by what was typed, in a list by the last part', () => {
    assert.equal(searchTerm('paid', false, false), ''); // just opened: every value
    assert.equal(searchTerm(' pai ', false, true), 'pai');
    assert.equal(searchTerm('3, 4, pa', true, true), 'pa');
  });

  test('picking in a list adds or removes a value and replaces the letters typed to find it', () => {
    assert.deepEqual(pickInList('3, pa', 4, true, 'number'), [3, 4]);
    assert.deepEqual(pickInList('3, 4', 4, false, 'number'), [3]);
    assert.deepEqual(pickInList('', 'paid', false), ['paid']);
    assert.deepEqual(pickInList('paid, ', 'refunded', false), ['paid', 'refunded']);
  });

  test('chosen ids show their names from the loaded list', () => {
    const list = [{ value: 3, label: 'Paint line', count: 9 }, { value: 4, label: 'Final assembly', count: 2 }];
    assert.deepEqual(labelsOf(['4', 3, 7], list), ['Final assembly', 'Paint line']);
    assert.deepEqual(labelsOf([3], undefined), []);
  });

  test('only text, number and yes/no columns get a list', () => {
    assert.ok(canPick('string') && canPick('number') && canPick('boolean') && canPick(undefined));
    assert.ok(!canPick('date') && !canPick('datetime') && !canPick('json'));
  });
});

describe('recent values', () => {
  const source = { connection: 'demo', table: 'downtime_events', column: 'line_id' };

  test('remembered per column, the latest first, without repeats, at most 8', () => {
    const store = new MemoryStore();
    rememberValues(source, [3], store);
    rememberValues(source, [4], store);
    rememberValues(source, ['3'], store); // the same value as text
    assert.deepEqual(recentValues(source, store), ['3', 4]);
    assert.deepEqual(recentValues({ ...source, column: 'shift_id' }, store), []);
    for (let i = 10; i < 20; i++) rememberValues(source, [i], store);
    assert.equal(recentValues(source, store).length, 8);
    assert.equal(recentValues(source, store)[0], 19);
  });

  test('a broken or missing store never fails', () => {
    const store = new MemoryStore();
    store.setItem('ncode_recent_values', '{not json');
    assert.deepEqual(recentValues(source, store), []);
    rememberValues(source, [1], store);
    assert.deepEqual(recentValues(source, store), [1]);
    assert.deepEqual(recentValues(source, null), []);
    rememberValues(source, [1], null);
  });

  test('only the 50 columns used last are kept', () => {
    const store = new MemoryStore();
    for (let i = 0; i < 55; i++) rememberValues({ ...source, column: `c${i}` }, ['x'], store);
    assert.deepEqual(recentValues({ ...source, column: 'c0' }, store), []);
    assert.deepEqual(recentValues({ ...source, column: 'c54' }, store), ['x']);
  });
});

describe('the column behind a filter', () => {
  const spec = { version: 1 as const, connection: 'demo', source: { table: 'downtime_events' }, joins: [{ table: 'production_lines', alias: 'pl', type: 'left' as const }] };

  test('alias.column, a bare unique column, not a formula', () => {
    assert.deepEqual(valueSourceOf(spec, SCHEMA, 'downtime_events.line_id'), { connection: 'demo', table: 'downtime_events', column: 'line_id', type: 'number' });
    assert.deepEqual(valueSourceOf(spec, SCHEMA, 'pl.name'), { connection: 'demo', table: 'production_lines', column: 'name', type: 'string' });
    assert.deepEqual(valueSourceOf(spec, SCHEMA, 'comment')?.table, 'downtime_events');
    assert.equal(valueSourceOf(spec, SCHEMA, 'id'), null); // in both tables
    assert.equal(valueSourceOf({ ...spec, expressions: [{ name: 'x', expr: { ref: 'comment' } }] }, SCHEMA, 'x'), null);
    assert.equal(valueSourceOf(spec, null, 'pl.name'), null);
    assert.equal(valueSourceOf(spec, SCHEMA, undefined), null);
  });
});
