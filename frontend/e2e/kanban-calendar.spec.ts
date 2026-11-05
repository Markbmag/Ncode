// K3: a board's tasks on a calendar. Dates are the 15th and the 20th of this month, so the test does
// not depend on the day it runs.
import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { api, expectNoHorizontalScroll, signIn, unique, watchErrors } from './helpers';

const now = new Date();
const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const D15 = `${ym}-15`;
const D20 = `${ym}-20`;

async function dragTo(page: Page, from: Locator, to: Locator) {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2);
  await page.mouse.down();
  for (let i = 1; i <= 15; i++) await page.mouse.move(a.x + a.width / 2 + ((b.x + b.width / 2 - a.x - a.width / 2) * i) / 15, a.y + a.height / 2 + ((b.y + 30 - a.y - a.height / 2) * i) / 15);
  await page.mouse.up();
}

async function setup(page: Page) {
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Calendar') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const col = detail.columns[0].id;
  const a = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: col, title: 'Service the compressor', due_date: D15 });
  const b = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: col, title: 'Order new gloves' });
  return { board, a, b };
}

test('tasks on their dates; dragging changes the due date, with Undo', async ({ page }) => {
  const errors = watchErrors(page);
  const { board, a, b } = await setup(page);
  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  await page.getByTestId('view-calendar').locator('visible=true').click();
  await expect(page).toHaveURL(/view=calendar/);
  const day = (iso: string) => page.locator(`[data-testid=calendar-day][data-date="${iso}"]`);
  await expect(day(D15).getByTestId('calendar-task')).toHaveText(['Service the compressor']);
  await expect(page.getByTestId('calendar-no-date').getByTestId('calendar-task')).toHaveText(['Order new gloves']);

  // drag to the 20th
  await dragTo(page, day(D15).getByTestId('calendar-task'), day(D20));
  await expect(day(D20).getByTestId('calendar-task')).toHaveText(['Service the compressor']);
  await expect(page.getByTestId('notice').filter({ hasText: '“Service the compressor” is now due' })).toBeVisible();
  await expect.poll(async () => (await api(page.request, 'carol', 'GET', `/api/kanban/cards/${a.id}`)).due_date).toBe(D20);
  await page.getByTestId('notice-undo').click();
  await expect(day(D15).getByTestId('calendar-task')).toHaveText(['Service the compressor']);
  await expect.poll(async () => (await api(page.request, 'carol', 'GET', `/api/kanban/cards/${a.id}`)).due_date).toBe(D15);

  // a task without a date gets one by dropping it on a day
  await dragTo(page, page.getByTestId('calendar-no-date').getByTestId('calendar-task'), day(D15));
  await expect(day(D15).getByTestId('calendar-task')).toHaveCount(2);
  await expect.poll(async () => (await api(page.request, 'carol', 'GET', `/api/kanban/cards/${b.id}`)).due_date).toBe(D15);

  // a click opens the task; back on the board view the stages are there again
  await day(D15).getByTestId('calendar-task').filter({ hasText: 'Order new gloves' }).click();
  await expect(page.getByTestId('card-drawer').getByTestId('card-title')).toHaveValue('Order new gloves');
  await page.getByTestId('card-close').click();
  await expect(page).toHaveURL(/view=calendar/);
  await page.getByTestId('view-board').locator('visible=true').click();
  await expect(page.getByTestId('column')).toHaveCount(3);
  expect(errors).toEqual([]);
});

test('on a phone the calendar is a list of days @phone', async ({ page }) => {
  const errors = watchErrors(page);
  const { board } = await setup(page);
  await signIn(page, 'carol', `/kanban/b/${board.id}?view=calendar`);
  await expect(page.locator(`[data-testid=agenda-day][data-date="${D15}"]`).getByTestId('calendar-task')).toHaveText(/Service the compressor/);
  await expect(page.getByTestId('calendar-no-date')).toContainText('Order new gloves');
  await expect(page.getByTestId('view-switch').locator('visible=true')).toBeVisible();
  await expect(page.getByTestId('board-title')).toBeVisible();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
