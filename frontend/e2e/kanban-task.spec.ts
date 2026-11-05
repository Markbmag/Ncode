// The task page, simpler (after Mark's review): the essentials first, the rest under "More".
import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

// a 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

test('a task shows the essentials; the rest is one click away', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Task page') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const card = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Order new gloves' });
  await signIn(page, 'carol', `/kanban/b/${board.id}/c/${card.id}`);
  const drawer = page.getByTestId('card-drawer');

  // what shows at first: the name, one card of facts, steps, photos, comments
  await expect(drawer.getByTestId('card-facts').getByTestId('fact-row')).toHaveCount(4);
  await expect(drawer.getByTestId('card-start')).toHaveCount(0);   // start date and repeat wait under the due date
  await expect(drawer.getByTestId('history')).toBeHidden();       // history, links and removing wait under "More"
  await expect(drawer.getByTestId('archive-card')).toBeHidden();
  await expect(drawer.getByTestId('save-state')).toBeHidden();     // "Saved" appears only after a change

  // a step, renamed and removed from its own menu
  await drawer.getByTestId('new-step').fill('Count the sizes');
  await drawer.getByTestId('add-step').click();
  await drawer.getByTestId('step-menu').click();
  await page.getByRole('menuitem', { name: 'Change the text' }).click();
  await drawer.getByTestId('checklist-item').locator('input:not([type=checkbox])').fill('Count the sizes needed');
  await page.keyboard.press('Enter');
  await expect(drawer.getByTestId('checklist-item')).toHaveText(/Count the sizes needed/);
  await expect(drawer.getByTestId('save-state')).toHaveText('Saved');
  await drawer.getByTestId('step-menu').click();
  await page.getByTestId('step-remove').click();
  await expect(drawer.getByTestId('checklist-item')).toHaveCount(0);

  // a photo shows once; it is deleted from the picture viewer
  await drawer.getByTestId('file-input').setInputFiles({ name: 'glove.png', mimeType: 'image/png', buffer: PNG });
  await expect(drawer.getByTestId('attachment-thumb')).toHaveCount(1);
  await expect(drawer.getByTestId('attachment-row')).toHaveCount(0);
  await drawer.getByTestId('attachment-thumb').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('preview-delete').click();
  await expect(drawer.getByTestId('attachment-thumb')).toHaveCount(0);

  // start date and repeat
  await drawer.getByTestId('date-more').click();
  await expect(drawer.getByTestId('card-start')).toBeVisible();
  await expect(drawer.getByTestId('card-repeat')).toBeVisible();

  // More: history and removing
  await drawer.getByTestId('card-more').click();
  await expect(drawer.getByTestId('history')).toContainText('carol created the task');
  await expect(drawer.getByTestId('archive-card')).toBeVisible();

  // Done in one tap
  await drawer.getByTestId('mark-done').click();
  await expect(drawer.getByTestId('card-column')).toContainText('Done');
  await expect(drawer.getByTestId('mark-done')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('anyone can be put on a task by name, not only Ncode users', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('People') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const card = await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Fix the gate' });
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Paint the fence' });
  await signIn(page, 'carol', `/kanban/b/${board.id}/c/${card.id}`);
  const drawer = page.getByTestId('card-drawer');

  // a name typed and Enter: on the task, marked as not an Ncode user
  await drawer.getByTestId('assignees-button').click();
  await page.getByTestId('assignee-name-input').fill('Ivan Petrov');
  await expect(page.getByTestId('assignee-name-add')).toContainText('Add “Ivan Petrov”');
  await page.getByTestId('assignee-name-input').press('Enter');
  await expect(drawer.getByTestId('assignee-name')).toHaveCount(1);
  await expect(drawer.getByTestId('assignee-name')).toContainText('Ivan Petrov');
  // the same field finds Ncode users
  await page.getByTestId('assignee-name-input').fill('ali');
  await expect(page.getByTestId('assignee-option')).toHaveCount(1);
  await expect(page.getByTestId('assignee-option')).toContainText('alice');
  await expect(page.getByTestId('assignee-name-add')).toBeVisible(); // "ali" could still be a name
  await page.getByTestId('assignee-option').click();
  await expect(drawer.getByTestId('assignee')).toHaveCount(1);
  await expect(drawer.getByTestId('assignee')).toContainText('alice');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await api(page.request, 'carol', 'GET', `/api/kanban/cards/${card.id}`)).assignee_names).toEqual(['Ivan Petrov']);

  // the board: filter by the name
  await drawer.getByTestId('card-close').click();
  await page.getByTestId('filter-more').click();
  await page.getByTestId('filter-person').selectOption({ label: 'Ivan Petrov' });
  await expect(page.getByTestId('card-face')).toHaveText([/Fix the gate/]);
  expect(errors).toEqual([]);
});
