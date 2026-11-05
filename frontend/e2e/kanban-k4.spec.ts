// K4: private boards and how long finished tasks stay on a board.
import { expect, test } from '@playwright/test';
import { API, api, signIn, token, unique, watchErrors } from './helpers';

test('a board only its members see; the owner opens it to everyone later', async ({ page }) => {
  const errors = watchErrors(page);
  const name = unique('Management');
  await signIn(page, 'carol', '/kanban');
  await page.getByTestId('new-board').click();
  await page.getByTestId('board-name').fill(name);
  await page.getByTestId('visibility-members').click();
  await page.getByTestId('create-board').click();
  await expect(page.getByTestId('board-title')).toHaveText(name);
  await expect(page.getByTestId('board-private')).toBeVisible();
  const boardId = Number(new URL(page.url()).pathname.split('/').pop());

  // alice does not see it, and cannot open it by its address
  const alice = await api(page.request, 'alice', 'GET', '/api/kanban/boards');
  expect(alice.boards.map((b: { id: number }) => b.id)).not.toContain(boardId);
  const res = await page.request.get(`${API}/api/kanban/boards/${boardId}`, { headers: { Authorization: `Bearer ${await token(page.request, 'alice')}` } });
  expect(res.status()).toBe(404);

  // settings: open it to everyone, finished tasks stay 30 days
  await page.getByTestId('board-more').click();
  await page.getByTestId('board-settings').click();
  await expect(page.getByTestId('visibility-members')).toHaveAttribute('aria-checked', 'true');
  await page.getByTestId('visibility-everyone').click();
  await page.getByTestId('board-keep').selectOption('30');
  await page.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByTestId('board-private')).toHaveCount(0);
  const board = await api(page.request, 'alice', 'GET', `/api/kanban/boards/${boardId}`);
  expect([board.board.private, board.board.done_keep_days]).toEqual([false, 30]);
  expect(errors).toEqual([]);
});

test('a board prints as a plain sheet and downloads as Excel', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Morning meeting') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Check the gauge', assignee_names: ['Ivan Petrov'], due_date: '2020-01-10' });
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[1].id, title: 'Replace the belt' });
  await signIn(page, 'carol', `/kanban/b/${board.id}`, 'ru');
  await expect(page.getByTestId('card-face')).toHaveCount(2);

  // Excel
  await page.getByTestId('board-more').click();
  const download = page.waitForEvent('download');
  await page.getByTestId('board-excel').click();
  expect((await download).suggestedFilename()).toMatch(/\.xlsx$/);

  // print: window.print is replaced, the sheet is looked at in print mode
  await page.evaluate(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await page.getByTestId('board-more').click();
  await page.getByTestId('board-print').click();
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1);
  await page.evaluate(() => document.body.classList.add('printing-sheet'));
  await page.emulateMedia({ media: 'print' });
  const sheet = page.getByTestId('print-sheet');
  await expect(sheet).toBeVisible();
  await expect(page.locator('#root')).toBeHidden();
  await expect(sheet.locator('h2')).toHaveText(['To do (1)', 'In progress (1)', 'Done (0)']); // the stages as the board names them
  await expect(sheet).toContainText('Check the gauge');
  await expect(sheet).toContainText('Ivan Petrov');
  await expect(sheet).toContainText('Напечатано');
  await page.emulateMedia({ media: 'screen' });
  await expect(sheet).toBeHidden();
  expect(errors).toEqual([]);
});
