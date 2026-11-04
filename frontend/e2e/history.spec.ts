import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

// History and undo (M15): every save keeps a version; a version can be looked at and restored;
// edits of a dashboard can be undone before saving.

const text = (key: string, value: string, y = 0) => ({ key, kind: 'text', text: value, layout: { x: 0, y, w: 6, h: 3 } });

test('change a dashboard twice, then restore the first version', async ({ page }) => {
  const errors = watchErrors(page);
  const d = await api(page.request, 'carol', 'POST', '/api/dashboards', { name: unique('Morning board') });
  await api(page.request, 'carol', 'PUT', `/api/dashboards/${d.id}`, { cards: [text('a', 'Alpha notes'), text('b', 'Beta notes', 3)] });
  await signIn(page, 'carol', `/dashboards/${d.id}`);
  const cards = page.getByTestId('text-card');
  await expect(cards).toHaveCount(2);

  // two changes, each saved
  for (const gone of ['Beta notes', 'Alpha notes']) {
    await page.getByTestId('edit-dashboard').click();
    await page.getByTestId('dash-card').filter({ hasText: gone }).getByTestId('card-remove').click();
    await page.getByTestId('save-dashboard').click();
    await expect(page.getByTestId('edit-dashboard')).toBeVisible();
  }
  await expect(cards).toHaveCount(0);

  await page.getByTestId('dashboard-menu').click();
  await page.getByTestId('dashboard-history').click();
  const drawer = page.getByTestId('history-drawer');
  await expect(drawer.getByTestId('history-list')).toContainText('Removed 1 card');
  await expect(drawer.getByTestId('history-version-2')).toContainText('Added 2 cards');
  await drawer.getByTestId('history-version-2').click();
  await expect(drawer.getByTestId('history-cards')).toContainText('Alpha notes');
  await expect(drawer.getByTestId('history-cards')).toContainText('Beta notes');
  await drawer.getByTestId('history-restore').click();
  await expect(page.getByRole('dialog').getByText('What you see now stays in the history')).toBeVisible();
  await page.getByTestId('dialog-submit').click();
  await expect(drawer).toHaveCount(0);
  await expect(page.getByTestId('dashboard').getByTestId('text-card')).toHaveCount(2);
  await expect(page.getByTestId('dashboard').getByText('Beta notes')).toBeVisible();

  // restoring is itself a version
  const listed = await api(page.request, 'carol', 'GET', `/api/dashboards/${d.id}/versions`);
  expect(listed.versions[0].summary).toBe('Restored version 2');
  expect(errors).toEqual([]);
});

test('a removed card comes back with Undo while editing', async ({ page }) => {
  const errors = watchErrors(page);
  const d = await api(page.request, 'carol', 'POST', '/api/dashboards', { name: unique('Undo board') });
  await api(page.request, 'carol', 'PUT', `/api/dashboards/${d.id}`, { cards: [text('a', 'Keep me'), text('b', 'Remove me', 3)] });
  await signIn(page, 'carol', `/dashboards/${d.id}`);
  await page.getByTestId('edit-dashboard').click();
  const removed = page.getByTestId('dash-card').filter({ hasText: 'Remove me' });
  await removed.getByTestId('card-remove').click();
  await expect(removed).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  await expect(removed).toHaveCount(1);
  await page.getByTestId('redo').click();
  await expect(removed).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(removed).toHaveCount(1);
  await expect(page.getByTestId('undo')).toBeDisabled();

  // "Cancel changes" asks first when something changed, then leaves the saved dashboard as it was
  await removed.getByTestId('card-remove').click();
  await page.getByTestId('cancel-dashboard-edit').click();
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('edit-dashboard')).toBeVisible();
  await expect(page.getByTestId('text-card')).toHaveCount(2);
  const saved = await api(page.request, 'carol', 'GET', `/api/dashboards/${d.id}`);
  expect(saved.cards).toHaveLength(2);
  expect(errors).toEqual([]);
});

test('an older version of a SQL question shows its SQL and result, and can be restored', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Order count'), kind: 'sql', connection: 'shop', spec: { sql: 'SELECT COUNT(*) AS orders FROM q_orders' },
  });
  await api(page.request, 'carol', 'PATCH', `/api/questions/${q.id}`, { spec: { sql: 'SELECT 7 AS orders' } });
  await signIn(page, 'carol', `/questions/${q.id}`);
  await page.getByTestId('question-menu').click();
  await page.getByTestId('question-history').click();
  const drawer = page.getByTestId('history-drawer');
  await expect(drawer.getByTestId('history-version-2')).toContainText('Changed the SQL');
  await drawer.getByTestId('history-version-1').click();
  await expect(drawer.getByTestId('history-sql')).toHaveText('SELECT COUNT(*) AS orders FROM q_orders');
  await expect(drawer.getByTestId('history-result')).toContainText('orders');
  await drawer.getByTestId('history-restore').click();
  await page.getByTestId('dialog-submit').click();
  await expect(drawer).toHaveCount(0);
  const now = await api(page.request, 'carol', 'GET', `/api/questions/${q.id}`);
  expect(now.spec.sql).toBe('SELECT COUNT(*) AS orders FROM q_orders');
  expect(errors).toEqual([]);
});
