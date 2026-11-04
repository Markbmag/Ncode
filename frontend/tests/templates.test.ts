import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NO_ANSWERS, answer, canSkip, parseMinutes, requestMapping, roleGroups } from '../src/templates/logic.ts';
import type { Answers } from '../src/templates/logic.ts';
import type { TemplateInfo, TemplateRole } from '../src/templates/types.ts';

const role = (key: string, kind: TemplateRole['kind'], table: string | null, required = true): TemplateRole => ({
  key, kind, ask: `${key}?`, help: null, table, required, default: kind === 'value' ? 480 : null,
});

const OEE: TemplateInfo = {
  id: 'oee', name: 'OEE', description: '',
  roles: [
    role('output', 'table', null), role('good', 'number', 'output'), role('rate', 'number', 'output', false),
    role('events', 'table', null, false), role('minutes', 'number', 'events'), role('planned_minutes', 'value', null, false),
  ],
};

test('a role answered "not in my data" is sent as null, so the server does not suggest it again', () => {
  let a: Answers = { mapping: { output: 'production_output', good: 'production_output.good_qty', rate: 'production_lines.parts_per_hour' }, skipped: [] };
  a = answer(OEE, a, 'rate', null);
  assert.deepEqual(a.mapping, { output: 'production_output', good: 'production_output.good_qty' });
  assert.deepEqual(requestMapping(a), { output: 'production_output', good: 'production_output.good_qty', rate: null });
  a = answer(OEE, a, 'rate', 'production_lines.parts_per_hour'); // changed her mind
  assert.deepEqual(a.skipped, []);
  assert.equal(requestMapping(a).rate, 'production_lines.parts_per_hour');
});

test('another table clears the columns asked about it (the server suggests them again), not the others', () => {
  const a = answer(OEE, { mapping: { output: 'out', good: 'out.good', events: 'stops', minutes: 'stops.min' }, skipped: ['rate'] }, 'output', 'reports');
  assert.deepEqual(a.mapping, { output: 'reports', events: 'stops', minutes: 'stops.min' });
  assert.deepEqual(a.skipped, []);
  // the same table again changes nothing
  const same = answer(OEE, { mapping: { output: 'out', good: 'out.good' }, skipped: [] }, 'output', 'out');
  assert.deepEqual(same.mapping, { output: 'out', good: 'out.good' });
});

test('questions come in order: a table, then its columns once it is chosen; typed numbers last', () => {
  const groups = roleGroups(OEE, { mapping: { output: 'out' }, skipped: ['events'] });
  assert.deepEqual(groups.map((g) => [g.table?.key ?? null, g.columns.map((c) => c.key)]), [
    ['output', ['good', 'rate']], ['events', []], [null, ['planned_minutes']],
  ]);
  assert.equal(roleGroups(OEE, NO_ANSWERS)[0].columns.length, 0);
  assert.equal(canSkip(OEE.roles[1]), false);
  assert.equal(canSkip(OEE.roles[3]), true);
});

test('minutes typed in: plain numbers, a decimal comma, nothing silly', () => {
  assert.equal(parseMinutes('480'), 480);
  assert.equal(parseMinutes(' 7,5 '), 7.5);
  assert.equal(parseMinutes(''), null);
  assert.equal(parseMinutes('0'), null);
  assert.equal(parseMinutes('eight hours'), null);
});
