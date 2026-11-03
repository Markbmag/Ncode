import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLangForTests } from '../src/i18n/index.ts';
import {
  applyMove, boardProgress, cardsByColumn, colorHex, dueState, dueText, filterActive, filterCount, guessType, historySentence, isOverdue, liveSentence,
  matchesFilter, NO_FILTER, personId, personName, positionAt, positionBetween, progressOf, progressText, thumbSize, todayIso, withAlpha,
} from '../src/kanban/logic.ts';
import type { CardSummary, Column, Label } from '../src/kanban/types.ts';
import { entryTarget, serviceOf } from '../src/launcher/service.ts';

const card = (over: Partial<CardSummary>): CardSummary => ({
  id: 1, column_id: 10, title: 'Fix the pump', priority: 'normal', start_date: null, due_date: null, position: 1024,
  assignees: [], labels: [], checklist: { done: 0, total: 0 }, comments: 0, attachments: 0, cover: null, completed_at: null, updated_at: 0,
  ...over,
});

test('a position between neighbours, at the top, at the bottom and in an empty column', () => {
  assert.equal(positionBetween(1024, 2048), 1536);
  assert.equal(positionBetween(undefined, 1024), 0);
  assert.equal(positionBetween(2048, undefined), 3072);
  assert.equal(positionBetween(null, null), 1024);
  const a = positionBetween(1, 2);
  const b = positionBetween(1, a);
  assert.ok(1 < b && b < a && a < 2);
});

test('the position for a drop index leaves the moving card out', () => {
  const list = [{ id: 1, position: 100 }, { id: 2, position: 200 }, { id: 3, position: 300 }];
  assert.equal(positionAt(list, 0), 100 - 1024); // on top
  assert.equal(positionAt(list, 3), 300 + 1024); // at the bottom
  assert.equal(positionAt(list, 1, 1), 250); // card 1 moved down by one: between 2 and 3
  assert.equal(positionAt(list, 0, 3), 100 - 1024); // card 3 moved to the top
  assert.equal(positionAt([], 0), 1024);
});

test('cards are grouped per column in position order, and a move shows before the server answers', () => {
  const columns: Column[] = [{ id: 10, name: 'To do', color: null, position: 1, is_done: false }, { id: 20, name: 'Done', color: null, position: 2, is_done: true }];
  const cards = [card({ id: 1, position: 300 }), card({ id: 2, position: 100 }), card({ id: 3, column_id: 20 })];
  const grouped = cardsByColumn(cards, columns);
  assert.deepEqual(grouped.get(10)?.map((c) => c.id), [2, 1]);
  assert.deepEqual(grouped.get(20)?.map((c) => c.id), [3]);
  const moved = applyMove(cards, 1, 20, 50, new Set([20]));
  assert.equal(moved.find((c) => c.id === 1)?.column_id, 20);
  assert.ok(moved.find((c) => c.id === 1)?.completed_at);
  const back = applyMove(moved, 1, 10, 1, new Set([20]));
  assert.equal(back.find((c) => c.id === 1)?.completed_at, null);
});

test('due dates: overdue, today, soon, later; done cards are never overdue', () => {
  const today = '2026-11-03';
  assert.equal(dueState('2026-11-02', today), 'overdue');
  assert.equal(dueState('2026-11-03', today), 'today');
  assert.equal(dueState('2026-11-05', today), 'soon');
  assert.equal(dueState('2026-12-01', today), 'later');
  assert.equal(dueState('2026-11-01', today, true), 'done');
  assert.equal(dueState(null, today), null);
  assert.equal(dueState('2027-01-01', '2026-12-31'), 'soon'); // across the year
  assert.ok(isOverdue(card({ due_date: '2026-10-01' }), today, new Set()));
  assert.ok(!isOverdue(card({ due_date: '2026-10-01', column_id: 20 }), today, new Set([20])));
  assert.match(todayIso(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('due dates in plain words', () => {
  setLangForTests('en');
  const today = '2026-11-03';
  assert.equal(dueText('2026-11-03', today), 'Due today');
  assert.equal(dueText('2026-11-04', today), 'Due tomorrow');
  assert.equal(dueText('2026-11-06', today), 'Due in 3 days');
  assert.equal(dueText('2026-11-02', today), '1 day late');
  assert.equal(dueText('2026-10-31', today), '3 days late');
  assert.match(dueText('2026-12-20', today), /^Due 20 Dec/);
  assert.match(dueText('2026-10-01', today, true), /^Was due/);
  setLangForTests('ru');
  assert.equal(dueText('2026-10-31', today), 'Просрочено на 3 дня');
  assert.equal(dueText('2026-11-04', today), 'Срок завтра');
  setLangForTests('en');
});

test('filters: my cards, person, label, priority, overdue and search', () => {
  const labels: Label[] = [{ id: 7, name: 'Maintenance', color: 'teal' }];
  const ctx = { me: 5, today: '2026-11-03', doneColumns: new Set<number>(), labels };
  const c = card({ assignees: [5, 6], labels: [7], priority: 'high', due_date: '2026-11-01', title: 'Replace the belt of line 2' });
  assert.ok(matchesFilter(c, NO_FILTER, ctx));
  assert.ok(matchesFilter(c, { ...NO_FILTER, mine: true }, ctx));
  assert.ok(!matchesFilter(c, { ...NO_FILTER, mine: true }, { ...ctx, me: 9 }));
  assert.ok(!matchesFilter(c, { ...NO_FILTER, mine: true }, { ...ctx, me: null }));
  assert.ok(matchesFilter(c, { ...NO_FILTER, person: 6 }, ctx));
  assert.ok(!matchesFilter(c, { ...NO_FILTER, person: 8 }, ctx));
  assert.ok(matchesFilter(c, { ...NO_FILTER, label: 7 }, ctx));
  assert.ok(!matchesFilter(c, { ...NO_FILTER, label: 8 }, ctx));
  assert.ok(matchesFilter(c, { ...NO_FILTER, priority: 'high' }, ctx));
  assert.ok(!matchesFilter(c, { ...NO_FILTER, priority: 'low' }, ctx));
  assert.ok(matchesFilter(c, { ...NO_FILTER, overdue: true }, ctx));
  assert.ok(!matchesFilter(card({}), { ...NO_FILTER, overdue: true }, ctx));
  assert.ok(matchesFilter(c, { ...NO_FILTER, q: 'line belt' }, ctx)); // any order of words
  assert.ok(matchesFilter(c, { ...NO_FILTER, q: 'maintenance' }, ctx)); // label names count
  assert.ok(!matchesFilter(c, { ...NO_FILTER, q: 'pump' }, ctx));
  assert.ok(!filterActive(NO_FILTER));
  assert.ok(filterActive({ ...NO_FILTER, q: ' x ' }));
  assert.equal(filterCount({ ...NO_FILTER, mine: true, overdue: true }), 2);
});

test('steps progress: "3 of 5 steps done", never above the total', () => {
  setLangForTests('en');
  assert.deepEqual(progressOf({ done: 3, total: 5 }), { done: 3, total: 5, percent: 60 });
  assert.equal(progressText(progressOf({ done: 3, total: 5 })), '3 of 5 steps done');
  assert.deepEqual(progressOf({ done: 0, total: 0 }), { done: 0, total: 0, percent: 0 });
  assert.equal(progressOf({ done: 9, total: 2 }).done, 2);
  assert.equal(progressOf(null).total, 0);
  assert.equal(boardProgress({ cards_open: 1, cards_done: 3 }).percent, 75);
  setLangForTests('ru');
  assert.equal(progressText(progressOf({ done: 1, total: 3 })), 'Выполнено шагов: 1 из 3');
  setLangForTests('en');
});

test('history rows read as sentences in English and Russian', () => {
  setLangForTests('en');
  const s = (action: string, details: Record<string, unknown> | null = null, user = 'carol') => historySentence({ user, action, details });
  assert.equal(s('card_moved', { from: 'To do', to: 'Done' }), 'carol moved the task from To do to Done');
  assert.equal(s('card_created', { title: 'Pump', column: 'To do' }), 'carol created the task in To do');
  assert.equal(s('item_done', { text: 'Order parts' }), 'carol ticked off the step “Order parts”');
  assert.equal(s('item_added', { text: 'Call Bob' }), 'carol added the step “Call Bob”');
  assert.equal(s('attachment_added', { filename: 'photo.png' }), 'carol attached photo.png');
  assert.equal(s('card_updated', { changes: { priority: ['normal', 'urgent'] } }), 'carol set the priority to Urgent');
  assert.equal(s('card_updated', { changes: { assignees: { added: ['alice'], removed: [] } } }), 'carol assigned alice');
  assert.equal(s('card_updated', { changes: { title: ['a', 'b'], description: true } }), 'carol renamed the task to “b”, changed the description');
  assert.equal(s('card_updated', { changes: { due_date: ['2026-11-01', null] } }), 'carol removed the due date');
  assert.equal(s('comment_added', { excerpt: 'Done!' }), 'carol commented: “Done!”');
  assert.equal(s('something_new'), 'carol changed the task');
  assert.equal(historySentence({ user: null, action: 'card_archived', details: null }), 'someone hid the task');
  assert.equal(historySentence({ user: 'bob', action: 'item_undone', details: '{"text": "Check"}' }), 'bob unticked the step “Check”'); // JSON text
  setLangForTests('ru');
  assert.equal(s('card_moved', { from: 'К выполнению', to: 'Готово' }), 'carol перенёс(ла) задачу из «К выполнению» в «Готово»');
  assert.equal(s('item_done', { text: 'Заказать детали' }), 'carol выполнил(а) шаг «Заказать детали»');
  assert.equal(s('card_updated', { changes: { priority: ['normal', 'high'] } }), 'carol установил(а) приоритет «Высокий»');
  setLangForTests('en');
});

test('notes about changes by others name the person and the task', () => {
  setLangForTests('en');
  assert.equal(liveSentence({ type: 'board_changed', by: 'carol', action: 'card_moved', card_id: 1 }, 'Fix the pump'), 'carol moved “Fix the pump”');
  assert.equal(liveSentence({ type: 'board_changed', by: 'carol', action: 'column_created' }, null), 'carol changed the stages');
  assert.equal(liveSentence({ type: 'board_changed', by: 'alice', action: 'comment_added', card_id: 1 }, 'X'), 'alice commented on “X”');
});

test('people, colours, thumbnails and file types', () => {
  const people = [{ id: 1, username: 'carol' }, { id: 2, username: 'alice' }];
  assert.equal(personName(2, people), 'alice');
  assert.equal(personName('bob', people), 'bob');
  assert.equal(personName({ id: 1 }, people), 'carol');
  assert.equal(personId('carol', people), 1);
  assert.equal(personId(7, people), 7);
  assert.equal(colorHex('teal'), '#14b8a6');
  assert.equal(colorHex('#123456'), '#123456');
  assert.equal(colorHex('nonsense'), '#6366f1');
  assert.equal(withAlpha('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
  assert.deepEqual(thumbSize(4000, 3000), { width: 400, height: 300 });
  assert.deepEqual(thumbSize(300, 1200), { width: 100, height: 400 });
  assert.deepEqual(thumbSize(200, 100), { width: 200, height: 100 }); // never enlarged
  assert.equal(guessType('report.DOCX', ''), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  assert.equal(guessType('x.png', 'image/png'), 'image/png');
});

test('the launcher opens on a fresh start until a service was chosen; Kanban is reopened when it was the last', () => {
  assert.equal(entryTarget(0, null), '/start');
  assert.equal(entryTarget(undefined, null), '/start');
  assert.equal(entryTarget(0, 'kanban'), '/kanban');
  assert.equal(entryTarget(0, 'bi'), null);
  assert.equal(entryTarget(3, null), null); // back on the BI home from inside the app
  assert.equal(serviceOf('/kanban/b/1'), 'kanban');
  assert.equal(serviceOf('/kanban'), 'kanban');
  assert.equal(serviceOf('/kanbanx'), 'bi');
  assert.equal(serviceOf('/dashboards/2'), 'bi');
});
