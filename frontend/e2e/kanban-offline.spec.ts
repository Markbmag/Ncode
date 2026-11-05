// K4: changes made without a connection are kept on the device and sent when it is back.
import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('no connection: a tick, a comment, a photo and a move wait, then all are sent', async ({ page, context }) => {
  const errors = watchErrors(page, [/Failed to load resource|ERR_INTERNET_DISCONNECTED|Network Error/]);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Hall 3') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const card = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Check the pump' });
  await api(page.request, 'carol', 'POST', `/api/kanban/cards/${card.id}/checklist`, { text: 'Look at the seal' });
  await signIn(page, 'carol', `/kanban/b/${board.id}/c/${card.id}`);
  const drawer = page.getByTestId('card-drawer');
  await expect(drawer.getByTestId('checklist-item')).toHaveCount(1);
  const banner = page.getByTestId('offline-banner');

  await context.setOffline(true);
  await expect(banner).toContainText('No connection');
  // a tick
  await drawer.getByTestId('checklist-item').locator('.chakra-checkbox__control').click();
  await expect(drawer.getByTestId('save-state')).toHaveText('Kept, sent later');
  await expect(drawer.getByTestId('plan-progress')).toHaveText('1 of 1 steps done');
  await expect(banner).toHaveAttribute('data-waiting', '1');
  // a comment
  await drawer.getByTestId('comment-input').fill('Seal is fine, no leak');
  await drawer.getByTestId('comment-send').click();
  await expect(drawer.getByTestId('waiting-comment')).toContainText('Seal is fine, no leak');
  await expect(drawer.getByTestId('comment-input')).toHaveValue('');
  // a photo
  await drawer.getByTestId('file-input').setInputFiles({ name: 'seal.png', mimeType: 'image/png', buffer: PNG });
  await expect(drawer.getByTestId('waiting-file')).toContainText('seal.png');
  await expect(banner).toHaveAttribute('data-waiting', '3');
  // a move, from the board
  await drawer.getByTestId('card-close').click();
  await page.getByTestId('card-face').filter({ hasText: 'Check the pump' }).getByTestId('move-to').click();
  await page.getByTestId('move-to-stage').filter({ hasText: 'Done' }).click();
  await expect(page.getByTestId('notice').filter({ hasText: 'It is sent when the connection is back' })).toBeVisible();
  await expect(page.locator('[data-testid=column][data-column-name="Done"]').getByTestId('card-face')).toHaveCount(1);
  await expect(banner).toHaveAttribute('data-waiting', '4');
  // a new task needs the connection
  await page.locator('[data-testid=column][data-column-name="To do"]').getByTestId('column-add-card').click();
  await page.getByTestId('new-card-title').fill('Order a seal');
  await page.getByTestId('new-card-save').click();
  await expect(page.getByTestId('notice').filter({ hasText: 'Adding a task needs the connection' })).toBeVisible();

  // back online: everything goes, in order
  await context.setOffline(false);
  await expect(page.getByTestId('notice').filter({ hasText: 'Sent 4 changes made without a connection' })).toBeVisible({ timeout: 15000 });
  await expect(banner).toHaveCount(0);
  const after = await api(page.request, 'carol', 'GET', `/api/kanban/cards/${card.id}`);
  const doneColumn = detail.columns.find((c: { is_done: boolean }) => c.is_done).id;
  expect(after.column_id).toBe(doneColumn);
  expect(after.checklist_items.map((i: { done: boolean }) => i.done)).toEqual([true]);
  expect(after.comments_list.map((c: { body: string }) => c.body)).toEqual(['Seal is fine, no leak']);
  expect(after.attachments_list.map((a: { filename: string }) => a.filename)).toEqual(['seal.png']);
  expect(errors).toEqual([]);
});
