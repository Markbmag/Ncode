// Run with: npm test
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { autoMapping, connectFilter, norm } from '../src/dashboards/connect.ts';
import { pickerColumn, unreachedFilters } from '../src/dashboards/logic.ts';
import type { CardQuestion, DashCard, DashFilter } from '../src/dashboards/types.ts';
import type { SchemaInfo } from '../src/query/draft.ts';
import type { SchemaColumn } from '../src/api.ts';

const col = (name: string, type: SchemaColumn['type'], extra: Partial<SchemaColumn> = {}): SchemaColumn => ({
  name, type, db_type: '', nullable: true, primary_key: name === 'id', foreign_key: null, ...extra,
});
const fk = (table: string) => ({ foreign_key: { table, column: 'id' } });

// a small part of the Factory demo, with its data-model names
const SCHEMA: SchemaInfo = {
  tables: [
    { name: 'production_lines', primary_key: ['id'], display_name: 'Production lines',
      columns: [col('id', 'number', { display_name: 'Line ID' }), col('name', 'string', { display_name: 'Line' })] },
    { name: 'downtime_events', primary_key: ['id'], columns: [
      col('id', 'number'), col('line_id', 'number', { display_name: 'Line', ...fk('production_lines') }),
      col('started_at', 'datetime', { semantic_type: 'created' }), col('minutes', 'number', { display_name: 'Duration, min' })] },
    { name: 'work_orders', primary_key: ['id'], columns: [
      col('id', 'number'), col('line_id', 'number', fk('production_lines')), col('production_date', 'date'), col('started_at', 'datetime')] },
    { name: 'scrap_records', primary_key: ['id'], columns: [
      col('id', 'number'), col('work_order_id', 'number', fk('work_orders')), col('qty', 'number'), col('recorded_at', 'datetime')] },
  ],
  relationships: [
    { from_table: 'downtime_events', from_columns: ['line_id'], to_table: 'production_lines', to_columns: ['id'] },
    { from_table: 'work_orders', from_columns: ['line_id'], to_table: 'production_lines', to_columns: ['id'] },
    { from_table: 'scrap_records', from_columns: ['work_order_id'], to_table: 'work_orders', to_columns: ['id'] },
  ],
};
const schemaOf = (connection: string) => (connection === 'demo' ? SCHEMA : null);

const builder = (spec: Record<string, unknown>): CardQuestion => ({ state: 'ok', kind: 'builder', connection: 'demo', spec: { version: 1, connection: 'demo', ...spec } });
const DOWNTIME = builder({ source: { table: 'downtime_events' }, breakouts: [{ ref: 'downtime_events.started_at', bucket: 'month' }], aggregations: [{ fn: 'count' }] });
const SCRAP = builder({ source: { table: 'scrap_records' }, joins: [{ table: 'work_orders' }], aggregations: [{ fn: 'sum', ref: 'scrap_records.qty' }] });
const LINES = builder({ source: { table: 'production_lines' } });
const SQL: CardQuestion = { state: 'ok', kind: 'sql', connection: 'demo', parameters: [{ name: 'line', type: 'text', label: 'Line' }] };
const HIDDEN: CardQuestion = { state: 'hidden' };

const card = (key: string, question: CardQuestion, mappings: DashCard['mappings'] = {}): DashCard => ({
  key, kind: 'question', question_id: 1, layout: { x: 0, y: 0, w: 6, h: 4 }, question, mappings,
});
const PERIOD: DashFilter = { id: 'period', label: 'Period', type: 'date_range' };
const LINE: DashFilter = { id: 'line', label: 'Line', type: 'category' };

describe('dashboard filters connect themselves', () => {
  test('names compare without case, spaces and a plural s, in any alphabet', () => {
    assert.equal(norm('Production lines'), norm('production_line'));
    assert.equal(norm('Линия'), 'линия');
  });

  test('a date range: the date the card is grouped by, else its own main date', () => {
    assert.deepEqual(autoMapping(PERIOD, DOWNTIME, SCHEMA), { field: 'downtime_events.started_at' });
    assert.deepEqual(autoMapping(PERIOD, SCRAP, SCHEMA), { field: 'scrap_records.recorded_at' }); // not the joined order's dates
    assert.equal(autoMapping(PERIOD, LINES, SCHEMA), null); // no date at all
    assert.equal(autoMapping(PERIOD, HIDDEN, SCHEMA), null);
  });

  test('a list of values: the column of the same name, the id rather than the name', () => {
    assert.deepEqual(autoMapping(LINE, DOWNTIME, SCHEMA), { field: 'downtime_events.line_id' });
    // a column referring to the lines is a "line" even without a data-model name
    assert.deepEqual(autoMapping(LINE, SCRAP, SCHEMA), { field: 'work_orders.line_id' });
    assert.deepEqual(autoMapping(LINE, SQL, SCHEMA), { param: 'line' }); // a parameter of that name first
    assert.equal(autoMapping({ id: 'list_of_values', label: 'List of values', type: 'category' }, DOWNTIME, SCHEMA), null); // nothing obvious
    const minutes: DashFilter = { id: 'duration', label: 'Duration, min', type: 'number' };
    assert.deepEqual(autoMapping(minutes, DOWNTIME, SCHEMA), { field: 'downtime_events.minutes' });
    assert.equal(autoMapping(minutes, LINES, SCHEMA), null);
  });

  test('every card compares the same values: line ids, not line names', () => {
    const cards = [card('a', DOWNTIME), card('b', SCRAP), card('c', LINES), card('d', SQL), card('e', HIDDEN), { ...card('t', DOWNTIME), kind: 'text' as const }];
    const { cards: out, connected } = connectFilter(LINE, cards, schemaOf);
    assert.deepEqual(connected, ['a', 'b', 'c', 'd']);
    assert.deepEqual(out.map((c) => c.mappings?.line ?? null), [
      { field: 'downtime_events.line_id' }, { field: 'work_orders.line_id' }, { field: 'production_lines.id' }, { param: 'line' }, null, null,
    ]);
    // a card connected by hand to the line names sets what the values are
    const byHand = [card('c', LINES, { line: { field: 'production_lines.name' } }), card('a', DOWNTIME)];
    const named = connectFilter(LINE, byHand, schemaOf, (c) => c.key === 'c');
    assert.deepEqual(named.cards.map((c) => c.mappings?.line ?? null), [{ field: 'production_lines.name' }, null]);
    assert.deepEqual(named.connected, []);
  });

  test('connecting again replaces what was connected automatically, not what was set by hand', () => {
    const start = connectFilter(PERIOD, [card('a', DOWNTIME), card('b', SCRAP, { period: { field: 'work_orders.production_date' } })], schemaOf, (c) => c.key === 'b');
    assert.deepEqual(start.cards.map((c) => c.mappings?.period), [{ field: 'downtime_events.started_at' }, { field: 'work_orders.production_date' }]);
    const first = connectFilter(LINE, [card('a', DOWNTIME)], schemaOf).cards;
    const renamed = connectFilter({ ...LINE, label: 'Nothing like it' }, first, schemaOf); // the same id, a name that fits nothing
    assert.deepEqual(renamed.cards[0].mappings?.line, { field: 'downtime_events.line_id' }); // the id still says "line"
    const other = connectFilter({ id: 'shift', label: 'Shift', type: 'category' }, [card('a', LINES)], schemaOf);
    assert.equal(other.cards[0].mappings?.shift, undefined);
  });

  test('a card the database has not answered for yet stays unconnected', () => {
    assert.deepEqual(connectFilter(LINE, [card('a', DOWNTIME)], () => null).connected, []);
  });
});

describe('cards a filter does not reach', () => {
  const filters: DashFilter[] = [PERIOD, LINE, { id: 'q', label: 'Search', type: 'text' }];
  test('filters with a value the card is not connected to', () => {
    const c = card('a', DOWNTIME, { period: { field: 'downtime_events.started_at' } });
    assert.deepEqual(unreachedFilters(c, filters, { period: ['2026-01-01', ''], line: ['3'] }).map((f) => f.id), ['line']);
    assert.deepEqual(unreachedFilters(c, filters, {}), []); // nothing chosen: nothing to miss
    assert.deepEqual(unreachedFilters({ ...c, kind: 'text' }, filters, { line: ['3'] }), []);
  });

  test('a filter offers the values of the first card connected to it by a column', () => {
    const cards = [card('d', SQL, { line: { param: 'line' } }), card('a', DOWNTIME, { line: { field: 'downtime_events.line_id' } })];
    assert.deepEqual(pickerColumn(LINE, cards), { connection: 'demo', spec: DOWNTIME.spec, ref: 'downtime_events.line_id' });
    assert.equal(pickerColumn(PERIOD, cards), null); // dates have a calendar
    assert.equal(pickerColumn(LINE, [cards[0]]), null);
  });
});
