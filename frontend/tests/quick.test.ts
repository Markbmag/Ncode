// The quick question (M12): what it offers for a table, the builder question it makes, Top N, ready questions.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { ColumnType, Relationship, SchemaTable } from '../src/api.ts';
import { setLangForTests } from '../src/i18n/index.ts';
import { questionCaption } from '../src/query/caption.ts';
import { columnOptions, prepareSpec, queryTables } from '../src/query/draft.ts';
import type { SchemaInfo } from '../src/query/draft.ts';
import { namerFromOptions } from '../src/query/outputs.ts';
import type { QuerySpec } from '../src/query/types.ts';
import { canTop, editorMode, presetCondition, quickModel, quickNamer, quickSpec, rankable, startParts, topNOf, withTopN } from '../src/quick/quick.ts';
import type { QuickModel, QuickParts } from '../src/quick/quick.ts';
import { suggestQuestions } from '../src/quick/suggest.ts';

// The Factory demo as GET /api/connections/demo/schema answers it (backend app/demo.py), without the descriptions:
// [table, name, Russian name, [[column, type, semantic type, name, Russian name, foreign key]]]
type Col = [string, ColumnType, string | null, string, string, string | null];
const DEMO: [string, string, string, Col[]][] = [
  ["downtime_events", "Downtime events", "Простои", [["id", "number", "id", "Event ID", "ID простоя", null], ["line_id", "number", null, "Line", "Линия", "production_lines.id"], ["shift_id", "number", null, "Shift", "Смена", "shifts.id"], ["reason_id", "number", null, "Reason", "Причина", "downtime_reasons.id"], ["work_order_id", "number", null, "Work order", "Заказ", "work_orders.id"], ["started_at", "datetime", "created", "Started at", "Начало простоя", null], ["minutes", "number", "quantity", "Duration, min", "Длительность, мин", null], ["comment", "string", "description", "Comment", "Комментарий", null]]],
  ["downtime_reasons", "Downtime reasons", "Причины простоев", [["id", "number", "id", "Reason ID", "ID причины", null], ["code", "string", "category", "Reason code", "Код причины", null], ["name", "string", "category", "Reason", "Причина", null], ["category", "string", "category", "Reason group", "Группа причин", null]]],
  ["parts", "Parts", "Детали", [["id", "number", "id", "Part ID", "ID детали", null], ["part_number", "string", "id", "Part number", "Номер детали по чертежу", null], ["name", "string", "name", "Part", "Деталь", null], ["category", "string", "category", "Category", "Категория", null], ["line_id", "number", null, "Line", "Линия", "production_lines.id"], ["unit_cost", "number", "currency", "Unit cost", "Себестоимость", null]]],
  ["production_lines", "Production lines", "Производственные линии", [["id", "number", "id", "Line ID", "ID линии", null], ["code", "string", "category", "Line code", "Код линии", null], ["name", "string", "name", "Line", "Линия", null], ["hall", "string", "category", "Hall", "Корпус", null], ["parts_per_hour", "number", "quantity", "Rated speed", "Паспортная скорость", null], ["commissioned_on", "date", null, "Commissioned on", "Дата запуска", null]]],
  ["production_output", "Production output", "Выпуск продукции", [["id", "number", "id", "Report ID", "ID отчёта", null], ["work_order_id", "number", null, "Work order", "Заказ", "work_orders.id"], ["reported_at", "datetime", "created", "Reported at", "Время отчёта", null], ["good_qty", "number", "quantity", "Good pieces", "Годные, шт.", null], ["scrap_qty", "number", "quantity", "Scrapped pieces", "Брак, шт.", null]]],
  ["quality_inspections", "Quality inspections", "Контроль качества", [["id", "number", "id", "Inspection ID", "ID проверки", null], ["vehicle_id", "number", null, "Vehicle", "Автомобиль", "vehicles.id"], ["inspected_at", "datetime", "created", "Inspected at", "Время проверки", null], ["inspector", "string", "name", "Inspector", "Контролёр", null], ["result", "string", "category", "Result", "Результат", null], ["defects", "number", "quantity", "Defects", "Дефекты", null], ["notes", "string", "description", "Notes", "Заметки", null]]],
  ["scrap_reasons", "Scrap reasons", "Причины брака", [["id", "number", "id", "Reason ID", "ID причины", null], ["code", "string", "category", "Reason code", "Код дефекта", null], ["name", "string", "category", "Reason", "Причина брака", null]]],
  ["scrap_records", "Scrap records", "Записи о браке", [["id", "number", "id", "Record ID", "ID записи", null], ["work_order_id", "number", null, "Work order", "Заказ", "work_orders.id"], ["reason_id", "number", null, "Reason", "Причина", "scrap_reasons.id"], ["qty", "number", "quantity", "Scrapped pieces", "Брак, шт.", null], ["recorded_at", "datetime", "created", "Recorded at", "Время записи", null]]],
  ["shifts", "Shifts", "Смены", [["id", "number", "id", "Shift ID", "ID смены", null], ["name", "string", "category", "Shift", "Смена", null], ["starts_at", "string", null, "Starts at", "Начало", null], ["ends_at", "string", null, "Ends at", "Окончание", null]]],
  ["vehicles", "Vehicles", "Автомобили", [["id", "number", "id", "Vehicle ID", "ID автомобиля", null], ["vin", "string", "id", "VIN", "VIN", null], ["model", "string", "category", "Model", "Модель", null], ["color", "string", "category", "Colour", "Цвет", null], ["market", "string", "category", "Market", "Рынок", null], ["work_order_id", "number", null, "Work order", "Заказ", "work_orders.id"], ["built_at", "datetime", "created", "Built at", "Время сборки", null]]],
  ["work_orders", "Work orders", "Производственные заказы", [["id", "number", "id", "Work order ID", "ID заказа", null], ["order_number", "string", "id", "Order number", "Номер заказа", null], ["part_id", "number", null, "Part", "Деталь", "parts.id"], ["line_id", "number", null, "Line", "Линия", "production_lines.id"], ["shift_id", "number", null, "Shift", "Смена", "shifts.id"], ["production_date", "date", "created", "Production date", "Дата производства", null], ["planned_qty", "number", "quantity", "Planned quantity", "План, шт.", null], ["status", "string", "category", "Status", "Статус", null], ["started_at", "datetime", null, "Started at", "Начат", null], ["finished_at", "datetime", null, "Finished at", "Завершён", null]]],
];

function schemaOf(raw: typeof DEMO): SchemaInfo {
  const tables: SchemaTable[] = raw.map(([name, display, ru, cols]) => ({
    name,
    primary_key: ['id'],
    display_name: display,
    translations: { ru: { display_name: ru } },
    columns: cols.map(([column, type, semantic, cname, cru, fk]) => ({
      name: column, type, db_type: type, nullable: true, primary_key: column === 'id',
      foreign_key: fk ? { table: fk.split('.')[0], column: fk.split('.')[1] } : null,
      semantic_type: semantic, display_name: cname, translations: { ru: { display_name: cru } },
    })),
  }));
  const relationships: Relationship[] = tables.flatMap((t) =>
    t.columns.filter((c) => c.foreign_key).map((c) => ({ from_table: t.name, from_columns: [c.name], to_table: c.foreign_key!.table, to_columns: [c.foreign_key!.column] })));
  return { tables, relationships };
}

const SCHEMA = schemaOf(DEMO);
const model = (table: string, schema = SCHEMA): QuickModel => quickModel(schema, table)!;
const parts = (table: string, extra: Partial<QuickParts>): QuickParts => ({ ...startParts(table), ...extra });
const captionOf = (spec: QuerySpec, m: QuickModel, schema = SCHEMA) => questionCaption(prepareSpec(spec, schema).spec, quickNamer(namerFromOptions(columnOptions(spec, schema)), m));

describe('what the quick question offers for a table', () => {
  test('scrap records: its number and date, and the names of related rows to split by', () => {
    setLangForTests('en');
    const m = model('scrap_records');
    assert.deepEqual(m.numbers.map((c) => [c.ref, c.label]), [['scrap_records.qty', 'Scrapped pieces']]);
    assert.deepEqual(m.dates.map((c) => c.ref), ['scrap_records.recorded_at']);
    // the reason directly, the order's part, line and shift through the work order, then the order's status
    assert.deepEqual(m.categories.map((c) => [c.label, c.ref, c.hops]), [
      ['Reason', 'scrap_reasons.name', 1],
      ['Part', 'parts.name', 2],
      ['Line', 'production_lines.name', 2],
      ['Shift', 'shifts.name', 2],
      ['Status', 'work_orders.status', 1],
    ]);
    assert.deepEqual(m.categories.find((c) => c.label === 'Line')?.via, ['Work orders']);
  });

  test('downtime events: ids, codes and long texts are not offered, the related names and groups are', () => {
    setLangForTests('en');
    const m = model('downtime_events');
    assert.deepEqual(m.numbers.map((c) => c.label), ['Duration, min']);
    assert.deepEqual(m.categories.map((c) => c.label), ['Line', 'Shift', 'Reason', 'Part', 'Hall', 'Reason group', 'Status']);
  });

  test('vehicles: its own categories first; the VIN (an identifier) is not one', () => {
    setLangForTests('en');
    assert.deepEqual(model('vehicles').categories.slice(0, 3).map((c) => c.label), ['Model', 'Colour', 'Market']);
    assert.ok(!model('vehicles').categories.some((c) => c.column === 'vin'));
  });

  test('in Russian, with the data model’s translations', () => {
    setLangForTests('ru');
    try {
      assert.deepEqual(model('scrap_records').categories.slice(0, 3).map((c) => c.label), ['Причина брака', 'Деталь', 'Линия']);
    } finally {
      setLangForTests('en');
    }
  });

  test('without a data model: the related table names its rows, its categories say their table', () => {
    setLangForTests('en');
    const col = (name: string, type: ColumnType, pk = false) => ({ name, type, db_type: type, nullable: true, primary_key: pk, foreign_key: null });
    const shop: SchemaInfo = {
      tables: [
        { name: 'customers', primary_key: ['id'], columns: [col('id', 'number', true), col('name', 'string'), col('region', 'string'), col('email', 'string')] },
        { name: 'orders', primary_key: ['id'], columns: [col('id', 'number', true), col('customer_id', 'number'), col('status', 'string'), col('total', 'number'), col('created_at', 'datetime'), col('note', 'string')] },
      ],
      relationships: [{ from_table: 'orders', from_columns: ['customer_id'], to_table: 'customers', to_columns: ['id'] }],
    };
    const m = model('orders', shop);
    assert.deepEqual(m.numbers.map((c) => c.ref), ['orders.total']);
    assert.deepEqual(m.categories.map((c) => [c.label, c.ref]), [['Status', 'orders.status'], ['Customers', 'customers.name'], ['Customers → Region', 'customers.region']]);
  });
});

describe('the builder question it makes', () => {
  test('scrap per line per week for the last quarter (the M12 done-when)', () => {
    setLangForTests('en');
    const m = model('scrap_records');
    const p = parts('scrap_records', {
      see: { fn: 'sum', ref: 'scrap_records.qty' },
      category: 'production_lines.name',
      time: { ref: 'scrap_records.recorded_at', bucket: 'week' },
      when: { ref: 'scrap_records.recorded_at', preset: 'last_quarter' },
    });
    const spec = quickSpec('demo', p, m, SCHEMA);
    assert.deepEqual(spec, {
      version: 1,
      connection: 'demo',
      source: { table: 'scrap_records' },
      breakouts: [{ ref: 'production_lines.name' }, { ref: 'scrap_records.recorded_at', bucket: 'week' }],
      aggregations: [{ fn: 'sum', ref: 'scrap_records.qty' }],
      joins: [{ table: 'production_lines', type: 'left' }], // the foreign keys lead there through the work order
      filters: { op: 'and', rules: [{ ref: 'scrap_records.recorded_at', op: 'last', value: { amount: 1, unit: 'quarter' } }] },
    });
    assert.deepEqual(queryTables(spec, SCHEMA).map((t) => t.table), ['scrap_records', 'work_orders', 'production_lines']);
    assert.deepEqual(prepareSpec(spec, SCHEMA).problems, []);
    assert.equal(captionOf(spec, m), 'Sum of Scrapped pieces per Line and per week · last quarter');
  });

  test('a fresh question counts the rows', () => {
    const spec = quickSpec('demo', startParts('downtime_events'), model('downtime_events'), SCHEMA);
    assert.deepEqual(spec, { version: 1, connection: 'demo', source: { table: 'downtime_events' }, aggregations: [{ fn: 'count' }] });
  });

  test('just the rows: the names of related rows in place of their ids', () => {
    const m = model('downtime_events');
    const spec = quickSpec('demo', parts('downtime_events', { see: { fn: 'rows' } }), m, SCHEMA);
    assert.deepEqual(spec.fields?.map((f) => f.ref), [
      'downtime_events.id', 'production_lines.name', 'shifts.name', 'downtime_reasons.name', 'downtime_events.work_order_id',
      'downtime_events.started_at', 'downtime_events.minutes', 'downtime_events.comment',
    ]);
    assert.deepEqual(spec.joins, [{ table: 'production_lines', type: 'left' }, { table: 'shifts', type: 'left' }, { table: 'downtime_reasons', type: 'left' }]);
    assert.equal(spec.aggregations, undefined);
  });

  test('conditions: half-typed ones are left out, related columns are joined', () => {
    const m = model('downtime_events');
    const p = parts('downtime_events', { where: [{ ref: 'downtime_reasons.category', op: 'in', value: ['Mechanical'] }, { ref: 'shifts.name', op: 'in', value: [] }] });
    const spec = quickSpec('demo', p, m, SCHEMA);
    assert.deepEqual(spec.filters, { op: 'and', rules: [{ ref: 'downtime_reasons.category', op: 'in', value: ['Mechanical'] }] });
    assert.deepEqual(spec.joins, [{ table: 'downtime_reasons', type: 'left' }]);
  });

  test('the period presets', () => {
    assert.deepEqual(presetCondition('t.d', 'last_30_days'), { ref: 't.d', op: 'last', value: { amount: 30, unit: 'day' } });
    assert.deepEqual(presetCondition('t.d', 'this_year'), { ref: 't.d', op: 'current', value: { unit: 'year' } });
    assert.deepEqual(presetCondition('t.d', 'last_12_months'), { ref: 't.d', op: 'last', value: { amount: 12, unit: 'month' } });
  });

  test('when the automatic join would go another way (through rows pointing back), the steps are spelled out', () => {
    const col = (name: string, fk?: string) => ({ name, type: (name.endsWith('name') ? 'string' : 'number') as ColumnType, db_type: 'x', nullable: true, primary_key: name === 'id', foreign_key: fk ? { table: fk, column: 'id' } : null });
    const tables: SchemaTable[] = [
      { name: 'orders', primary_key: ['id'], columns: [col('id'), col('store_id', 'stores'), col('amount')] },
      { name: 'stores', primary_key: ['id'], columns: [col('id'), col('region_id', 'regions')] },
      { name: 'regions', primary_key: ['id'], columns: [col('id'), col('name')] },
      // audits point at an order and a region: the shortest way from orders to regions, but it repeats orders
      { name: 'audits', primary_key: ['id'], columns: [col('id'), col('order_id', 'orders'), col('region_id', 'regions')] },
    ];
    const relationships = tables.flatMap((t) => t.columns.filter((c) => c.foreign_key).map((c) => ({ from_table: t.name, from_columns: [c.name], to_table: c.foreign_key!.table, to_columns: ['id'] })));
    const schema = { tables, relationships };
    const m = quickModel(schema, 'orders')!;
    assert.deepEqual(m.categories.map((c) => c.ref), ['regions.name']);
    const spec = quickSpec('c', parts('orders', { see: { fn: 'sum', ref: 'orders.amount' }, category: 'regions.name' }), m, schema);
    assert.deepEqual(spec.joins, [
      { table: 'stores', type: 'left', on: [{ left: 'orders.store_id', right: 'stores.id' }] },
      { table: 'regions', type: 'left', on: [{ left: 'stores.region_id', right: 'regions.id' }] },
    ]);
    assert.deepEqual(queryTables(spec, schema).map((t) => t.table), ['orders', 'stores', 'regions']);
  });
});

describe('with "Show values as" in the data model (the related name in place of an id)', () => {
  // the demo's settings (backend app/demo.py LABELS): the compiler then shows the names for these key columns
  const LABELS: Record<string, string> = {
    'parts.line_id': 'name', 'work_orders.part_id': 'name', 'work_orders.line_id': 'name', 'work_orders.shift_id': 'name',
    'production_output.work_order_id': 'order_number', 'downtime_events.line_id': 'name', 'downtime_events.shift_id': 'name',
    'downtime_events.reason_id': 'name', 'downtime_events.work_order_id': 'order_number', 'scrap_records.work_order_id': 'order_number',
    'scrap_records.reason_id': 'name', 'vehicles.work_order_id': 'order_number', 'quality_inspections.vehicle_id': 'vin',
  };
  const shown: SchemaInfo = {
    ...SCHEMA,
    tables: SCHEMA.tables.map((t) => ({ ...t, columns: t.columns.map((c) => (LABELS[`${t.name}.${c.name}`] ? { ...c, label_column: LABELS[`${t.name}.${c.name}`] } : c)) })),
  };

  test('the key columns themselves are offered, under their own names; order numbers come last', () => {
    setLangForTests('en');
    const m = model('scrap_records', shown);
    assert.deepEqual(m.categories.map((c) => [c.label, c.ref, c.filterRef ?? null]), [
      ['Reason', 'scrap_records.reason_id', 'scrap_reasons.name'],
      ['Part', 'work_orders.part_id', 'parts.name'],
      ['Line', 'work_orders.line_id', 'production_lines.name'],
      ['Shift', 'work_orders.shift_id', 'shifts.name'],
      ['Status', 'work_orders.status', null],
      ['Work order', 'scrap_records.work_order_id', 'work_orders.order_number'],
    ]);
  });

  test('scrap per line per week groups by the order’s line: one join, the compiler shows the names', () => {
    setLangForTests('en');
    const m = model('scrap_records', shown);
    const p = parts('scrap_records', {
      see: { fn: 'sum', ref: 'scrap_records.qty' }, category: 'work_orders.line_id',
      time: { ref: 'scrap_records.recorded_at', bucket: 'week' }, when: { ref: 'scrap_records.recorded_at', preset: 'last_quarter' },
    });
    const spec = quickSpec('demo', p, m, shown);
    assert.deepEqual(spec.joins, [{ table: 'work_orders', type: 'left' }]);
    assert.deepEqual(spec.breakouts, [{ ref: 'work_orders.line_id' }, { ref: 'scrap_records.recorded_at', bucket: 'week' }]);
    assert.equal(captionOf(spec, m, shown), 'Sum of Scrapped pieces per Line and per week · last quarter');
  });

  test('ready questions on downtime events need no join at all', () => {
    setLangForTests('en');
    const list = suggestQuestions(model('downtime_events', shown), shown, 'demo');
    assert.equal(list[0].title, 'Total Duration, min per Line');
    assert.deepEqual(list[0].spec, {
      version: 1, connection: 'demo', source: { table: 'downtime_events' },
      breakouts: [{ ref: 'downtime_events.line_id' }], aggregations: [{ fn: 'sum', ref: 'downtime_events.minutes' }],
    });
    assert.equal(list.find((s) => s.key === 'average')!.title, 'Average Duration, min per Reason');
  });

  test('just the rows shows the work order’s number in place of its id', () => {
    const spec = quickSpec('demo', parts('scrap_records', { see: { fn: 'rows' } }), model('scrap_records', shown), shown);
    assert.deepEqual(spec.fields?.map((f) => f.ref), ['scrap_records.id', 'work_orders.order_number', 'scrap_reasons.name', 'scrap_records.qty', 'scrap_records.recorded_at']);
  });
});

describe('Top N by …', () => {
  const m = model('scrap_records');
  test('the quick question: sorted by the value, biggest first, N rows', () => {
    const p = parts('scrap_records', { see: { fn: 'sum', ref: 'scrap_records.qty' }, category: 'parts.name', top: 10 });
    const spec = quickSpec('demo', p, m, SCHEMA);
    assert.deepEqual([spec.order, spec.limit], [[{ ref: 'sum_qty', dir: 'desc' }], 10]);
    assert.deepEqual(prepareSpec(spec, SCHEMA).spec.order, [{ ref: 'sum_qty', dir: 'desc' }]); // the builder keeps it
    assert.equal(captionOf(spec, m), 'Sum of Scrapped pieces per Part · top 10');
  });

  test('only for groups of a category, not over time', () => {
    const p = parts('scrap_records', { category: 'parts.name', time: { ref: 'scrap_records.recorded_at', bucket: 'week' }, top: 10 });
    assert.equal(canTop(p), false);
    assert.equal(quickSpec('demo', p, m, SCHEMA).limit, undefined);
    assert.equal(canTop(parts('scrap_records', { top: 5 })), false);
  });

  test('the builder’s Summarise step reads and writes it as a sort and a row limit', () => {
    const spec: QuerySpec = {
      version: 1, connection: 'demo', source: { table: 'scrap_records' }, joins: [{ table: 'parts', type: 'left' }],
      breakouts: [{ ref: 'parts.name' }], aggregations: [{ fn: 'count' }, { fn: 'sum', ref: 'scrap_records.qty' }, { fn: 'avg' }],
    };
    const options = columnOptions(spec, SCHEMA);
    assert.deepEqual(rankable(spec, options), [{ name: 'count', index: 0 }, { name: 'sum_qty', index: 1 }]); // the half-made average is not
    const top = withTopN(spec, 5, 'sum_qty');
    assert.deepEqual(top, { order: [{ ref: 'sum_qty', dir: 'desc' }], limit: 5 });
    assert.deepEqual(topNOf({ ...spec, ...top }, options), { n: 5, by: 'sum_qty' });
    assert.equal(topNOf({ ...spec, order: [{ ref: 'sum_qty', dir: 'asc' }], limit: 5 }, options), null);
    assert.equal(topNOf({ ...spec, order: [{ ref: 'name', dir: 'desc' }], limit: 5 }, options), null);
    assert.deepEqual(withTopN({ ...spec, ...top }, null, null), { order: [], limit: null });
    // another sort the person set stays when Top N is switched off
    assert.deepEqual(withTopN({ order: [{ ref: 'name', dir: 'asc' }], limit: 20 }, null, null), { order: [{ ref: 'name', dir: 'asc' }], limit: 20 });
  });
});

describe('ready questions after choosing a table', () => {
  test('downtime events: six, with the related names in place of ids', () => {
    setLangForTests('en');
    const list = suggestQuestions(model('downtime_events'), SCHEMA, 'demo');
    assert.deepEqual(list.map((s) => s.title), [
      'Total Duration, min per Line',
      'Top 10 Part by Duration, min',
      'Share by Shift',
      'Count per month',
      'Total Duration, min per Line per week',
      'Average Duration, min per Reason',
    ]);
    const share = list.find((s) => s.key === 'share')!;
    assert.deepEqual(share.viz, { mode: 'chart', spec: { version: 1, type: 'pie', x: 'name', value: 'count' } });
    for (const s of list) assert.deepEqual(prepareSpec(s.spec, SCHEMA).problems, [], s.title);
    const weekly = list.find((s) => s.key === 'weekly')!;
    assert.deepEqual(weekly.spec.breakouts, [{ ref: 'production_lines.name' }, { ref: 'downtime_events.started_at', bucket: 'week' }]);
    assert.deepEqual(list.find((s) => s.key === 'top')!.spec.limit, 10);
  });

  test('scrap records: the reason first, the part for the top 10, the shift for the shares', () => {
    setLangForTests('en');
    const titles = suggestQuestions(model('scrap_records'), SCHEMA, 'demo').map((s) => s.title);
    assert.deepEqual(titles.slice(0, 3), ['Total Scrapped pieces per Reason', 'Top 10 Part by Scrapped pieces', 'Share by Shift']);
  });

  test('a lookup table without numbers or dates still gets a few', () => {
    setLangForTests('en');
    assert.deepEqual(suggestQuestions(model('downtime_reasons'), SCHEMA, 'demo').map((s) => s.title), ['Count per Reason', 'Share by Reason group']);
    assert.deepEqual(suggestQuestions(model('shifts'), SCHEMA, 'demo').map((s) => s.title), ['Count per Shift', 'Share by Shift']);
  });

  test('in Russian', () => {
    setLangForTests('ru');
    try {
      assert.equal(suggestQuestions(model('scrap_records'), SCHEMA, 'demo')[0].title, 'Сумма «Брак, шт.» в разрезе «Причина брака»');
    } finally {
      setLangForTests('en');
    }
  });
});

test('which editor "New question" opens: the link, then the person’s choice, then the quick question', () => {
  assert.equal(editorMode('full', 'quick', 'quick'), 'full');
  assert.equal(editorMode(null, 'full', 'quick'), 'full');
  assert.equal(editorMode(null, undefined, 'full'), 'full');
  assert.equal(editorMode(null, null, null), 'quick');
  assert.equal(editorMode('nonsense', 42, {}), 'quick');
});
