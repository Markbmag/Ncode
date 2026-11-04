// K3: repeating tasks (the next one appears when one is done) and links from tasks to Search & BI.
import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

test('a weekly task comes back when it is done; Undo takes the new one away', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Safety') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const title = unique('Safety walk');
  const card = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title, due_date: '2026-11-09' });
  await api(page.request, 'carol', 'POST', `/api/kanban/cards/${card.id}/checklist`, { text: 'Fire exits free' });
  await signIn(page, 'carol', `/kanban/b/${board.id}/c/${card.id}`);

  const drawer = page.getByTestId('card-drawer');
  await drawer.getByTestId('card-repeat').selectOption('weekly');
  await expect(drawer.getByTestId('repeat-hint')).toContainText('the next one appears in “To do”');
  await drawer.getByTestId('checklist-item').locator('label').first().click();
  await expect(drawer.getByTestId('plan-progress')).toHaveText('1 of 1 steps done');
  await drawer.getByTestId('card-close').click();
  const faces = page.getByTestId('card-face').filter({ hasText: title });
  await expect(faces.getByTestId('repeat-chip')).toHaveText('Every week');

  // done: the next one is in To do, with its step not ticked
  await faces.getByTestId('move-to').click();
  await page.getByTestId('move-to-stage').filter({ hasText: 'Done' }).click();
  await expect(page.getByTestId('notice').filter({ hasText: 'It repeats: the next one is due' })).toBeVisible();
  await expect(faces).toHaveCount(2);
  const todo = page.locator('[data-testid=column][data-column-name="To do"]').getByTestId('card-face').filter({ hasText: title });
  await expect(todo.getByTestId('repeat-chip')).toBeVisible();
  await expect(todo.getByTestId('card-progress')).toHaveText('0 of 1 steps done');

  // Undo: back in To do, one task, still repeating
  await page.getByTestId('notice-undo').click();
  await expect(faces).toHaveCount(1);
  await expect(page.locator('[data-testid=column][data-column-name="To do"]').getByTestId('card-face').filter({ hasText: title }).getByTestId('repeat-chip')).toBeVisible();
  await expect.poll(async () => (await api(page.request, 'carol', 'GET', `/api/kanban/cards/${card.id}`)).repeat).toBe('weekly');
  expect(errors).toEqual([]);
});

test('a task links a dashboard; it opens from the task', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Scrap') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const card = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Look into the scrap rise' });
  const name = unique('Scrap overview');
  const dash = await api(page.request, 'carol', 'POST', '/api/dashboards', { name });
  await signIn(page, 'carol', `/kanban/b/${board.id}/c/${card.id}`);

  const drawer = page.getByTestId('card-drawer');
  await drawer.getByTestId('add-link').click();
  await page.getByTestId('link-search').fill(name);
  await page.getByTestId('link-option').filter({ hasText: name }).click();
  await expect(drawer.getByTestId('card-link-open')).toHaveText(name);
  await drawer.getByTestId('card-link-open').click();
  await expect(page).toHaveURL(new RegExp(`/dashboards/${dash.id}$`));
  await expect(page.getByTestId('dashboard-title')).toHaveText(name);
  // back to the task: the link can be removed again
  await page.goBack();
  await expect(page.getByTestId('card-drawer').getByTestId('card-link')).toHaveCount(1);
  await page.getByTestId('card-link-remove').click();
  await expect(page.getByTestId('card-drawer').getByTestId('card-link')).toHaveCount(0);
  expect(errors).toEqual([]);
});
