// K3: the board's calendar.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setLangForTests } from '../src/i18n/index.ts';
import { agenda, calendarDate, dayTitle, monthGrid, monthTitle, shiftMonth, tasksByDate, weekdayNames } from '../src/kanban/logic.ts';
import type { CardSummary } from '../src/kanban/types.ts';

const card = (id: number, over: Partial<CardSummary> = {}): CardSummary => ({
  id, column_id: 1, title: `Task ${id}`, priority: 'normal', start_date: null, due_date: null, position: id * 1024, assignees: [], labels: [],
  checklist: { done: 0, total: 0 }, comments: 0, attachments: 0, cover: null, completed_at: null, updated_at: 0, ...over,
});

test('a month is whole weeks from Monday', () => {
  const nov = monthGrid(2026, 10); // November 2026 starts on a Sunday
  assert.equal(nov.length, 6);
  assert.deepEqual(nov[0], ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30', '2026-10-31', '2026-11-01']);
  assert.equal(nov[5][0], '2026-11-30');
  const feb = monthGrid(2027, 1); // February 2027 starts on a Monday and has exactly 4 weeks
  assert.equal(feb.length, 4);
  assert.equal(feb[0][0], '2027-02-01');
  assert.equal(feb[3][6], '2027-02-28');
  assert.ok(monthGrid(2026, 0).every((w) => w.length === 7));
});

test('months before and after, across years', () => {
  assert.deepEqual(shiftMonth(2026, 0, -1), { year: 2025, month: 11 });
  assert.deepEqual(shiftMonth(2026, 11, 1), { year: 2027, month: 0 });
  assert.deepEqual(shiftMonth(2026, 10, 14), { year: 2028, month: 0 });
});

test('a task sits on its due date, else its start date', () => {
  assert.equal(calendarDate(card(1, { due_date: '2026-11-10', start_date: '2026-11-02' })), '2026-11-10');
  assert.equal(calendarDate(card(1, { start_date: '2026-11-02' })), '2026-11-02');
  assert.equal(calendarDate(card(1)), null);
  const map = tasksByDate([card(1, { due_date: '2026-11-04' }), card(2, { due_date: '2026-11-04', priority: 'urgent' }), card(3)]);
  assert.deepEqual(map.get('2026-11-04')?.map((c) => c.id), [2, 1]); // urgent first
  assert.equal(map.size, 1);
});

test('the phone list: late first, then the days of the month, today always there', () => {
  const cards = [
    card(1, { due_date: '2026-10-20' }),                       // late, from last month
    card(2, { due_date: '2026-10-21', completed_at: 1 }),      // done: not late
    card(3, { due_date: '2026-11-12' }),
    card(4, { start_date: '2026-11-02' }),
    card(5, { due_date: '2026-12-01' }),                       // next month
  ];
  const days = agenda(cards, 2026, 10, '2026-11-04', (c) => c.completed_at !== null);
  assert.deepEqual(days.map((d) => [d.date, d.cards.map((c) => c.id)]), [[null, [1]], ['2026-11-02', [4]], ['2026-11-04', []], ['2026-11-12', [3]]]);
  assert.deepEqual(agenda(cards, 2026, 11, '2026-11-04', () => false).map((d) => d.date), [null, '2026-12-01']);
});

test('month and day names in both languages', () => {
  setLangForTests('en');
  assert.equal(monthTitle(2026, 10), 'November 2026');
  assert.match(dayTitle('2026-11-04'), /^Wednesday,? 4 November$/);
  assert.equal(weekdayNames()[0], 'Mon');
  setLangForTests('ru');
  assert.equal(monthTitle(2026, 10), 'Ноябрь 2026');
  assert.equal(dayTitle('2026-11-04'), 'Среда, 4 ноября');
  assert.deepEqual(weekdayNames(), ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']);
  setLangForTests('en');
});

test('timeline: six weeks from the Monday before this week; bars from start to due', async () => {
  const { barOf, daysBetween, movedDates, shiftIso, timelineDays } = await import('../src/kanban/logic.ts');
  const days = timelineDays('2026-11-04'); // a Wednesday
  assert.equal(days.length, 42);
  assert.equal(days[0], '2026-10-26');      // the Monday of the week before
  assert.equal(timelineDays('2026-11-04', 2)[0], '2026-11-09');
  assert.equal(shiftIso('2026-02-27', 3), '2026-03-02');
  assert.equal(daysBetween('2026-10-26', '2026-11-04'), 9);
  assert.deepEqual(barOf({ start_date: '2026-11-02', due_date: '2026-11-06' }, days), { from: 7, to: 11, cutStart: false, cutEnd: false });
  assert.deepEqual(barOf({ start_date: null, due_date: '2026-11-04' }, days), { from: 9, to: 9, cutStart: false, cutEnd: false });
  assert.deepEqual(barOf({ start_date: '2026-10-01', due_date: '2026-10-28' }, days), { from: 0, to: 2, cutStart: true, cutEnd: false });
  assert.equal(barOf({ start_date: '2026-09-01', due_date: '2026-09-02' }, days), null);
  assert.equal(barOf({ start_date: null, due_date: null }, days), null);
  // dragging: the whole bar, or one end, never past the other
  assert.deepEqual(movedDates({ start_date: '2026-11-02', due_date: '2026-11-06' }, 3, 'bar'), { start_date: '2026-11-05', due_date: '2026-11-09' });
  assert.deepEqual(movedDates({ start_date: '2026-11-02', due_date: '2026-11-06' }, -10, 'end'), { start_date: '2026-11-02', due_date: '2026-11-02' });
  assert.deepEqual(movedDates({ start_date: '2026-11-02', due_date: '2026-11-06' }, 2, 'start'), { start_date: '2026-11-04', due_date: '2026-11-06' });
  assert.deepEqual(movedDates({ start_date: null, due_date: '2026-11-06' }, 2, 'end'), { start_date: null, due_date: '2026-11-08' });
  assert.deepEqual(movedDates({ start_date: null, due_date: '2026-11-06' }, -3, 'start'), { start_date: '2026-11-03', due_date: '2026-11-06' });
});
