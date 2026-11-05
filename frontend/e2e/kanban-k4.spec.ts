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
