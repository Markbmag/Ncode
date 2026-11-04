// K3: My tasks — everything assigned to me on all boards; Done and Move to work from the list.
import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

const day = (offset: number) => {
  const d = new Date(Date.now() + offset * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('my tasks across boards: grouped by date, done from the list, opened in place', async ({ page }) => {
  const errors = watchErrors(page);
  const press = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Press') });
  const paint = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Paint') });
  const dp = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${press.id}`);
  const dq = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${paint.id}`);
  const carol = dp.people.find((p: { username: string }) => p.username === 'carol').id;
  const late = unique('Check the gauge');
  const soon = unique('Clean the filter');
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${press.id}/cards`, { column_id: dp.columns[0].id, title: late, assignees: [carol], due_date: day(-2) });
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${paint.id}/cards`, { column_id: dq.columns[0].id, title: soon, assignees: [carol], due_date: day(3) });

  await signIn(page, 'carol', '/kanban');
  await expect(page.getByTestId('my-tasks-count')).toContainText('late');
  await page.getByTestId('my-tasks-button').click();
  await expect(page).toHaveURL(/\/kanban\/my/);
  const task = (title: string) => page.locator(`[data-testid=my-task][data-title="${title}"]`);
  const group = (key: string) => page.locator(`[data-testid=my-group][data-group="${key}"]`);
  await expect(group('late').locator(`[data-title="${late}"]`)).toBeVisible();
  await expect(group('week').locator(`[data-title="${soon}"]`)).toBeVisible();
  await expect(task(late)).toContainText(press.name);

  // done from the list, and back with Undo
  await task(late).getByTestId('my-task-done').click();
  await expect(group('done').locator(`[data-title="${late}"]`)).toBeVisible();
  await expect(page.getByTestId('notice').filter({ hasText: `Moved “${late}” to Done` })).toBeVisible();
  await page.getByTestId('notice-undo').click();
  await expect(group('late').locator(`[data-title="${late}"]`)).toBeVisible();

  // a task opens right here; closing it returns to the list
  await task(soon).getByTestId('card-face').click();
  await expect(page.getByTestId('card-drawer').getByTestId('card-title')).toHaveValue(soon);
  await page.getByTestId('card-close').click();
  await expect(page.getByTestId('card-drawer')).toHaveCount(0);
  await expect(page).toHaveURL(/\/kanban\/my$/);
  expect(errors).toEqual([]);
});
