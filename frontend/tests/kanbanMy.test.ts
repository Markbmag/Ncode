// K3: My tasks, grouped the way a person works through them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { myGroups } from '../src/kanban/logic.ts';
import type { CardSummary } from '../src/kanban/types.ts';

const card = (id: number, over: Partial<CardSummary> = {}): CardSummary => ({
  id, column_id: 1, title: `Task ${id}`, priority: 'normal', start_date: null, due_date: null, position: id, assignees: [], labels: [],
  checklist: { done: 0, total: 0 }, comments: 0, attachments: 0, cover: null, completed_at: null, updated_at: 0, ...over,
});

test('late, today, next 7 days, later, no date, done this week', () => {
  const cards = [
    card(1, { due_date: '2026-11-10' }),                       // 6 days ahead: next 7 days
    card(2, { due_date: '2026-11-11' }),                       // 7 days ahead: later
    card(3, { due_date: '2026-11-04', priority: 'low' }),
    card(4, { due_date: '2026-11-04', priority: 'urgent' }),
    card(5, { due_date: '2026-10-30' }),
    card(6),
    card(7, { due_date: '2026-10-01', completed_at: 100 }),    // done: not late
    card(8, { completed_at: 200 }),
  ];
  const groups = myGroups(cards, '2026-11-04', (c) => c.completed_at !== null);
  assert.deepEqual(groups.map((g) => [g.key, g.cards.map((c) => c.id)]), [
    ['late', [5]], ['today', [4, 3]], ['week', [1]], ['later', [2]], ['nodate', [6]], ['done', [8, 7]],
  ]);
  assert.deepEqual(myGroups([], '2026-11-04', () => false), []);
  // the week runs over the end of the month
  assert.equal(myGroups([card(1, { due_date: '2026-12-03' })], '2026-11-30', () => false)[0].key, 'week');
});
