import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

const COUNT_BY_STATUS = {
  version: 1, connection: 'shop', source: { table: 'q_orders' },
  aggregations: [{ fn: 'count', alias: 'orders' }], breakouts: [{ ref: 'status' }],
};

test('build a question without SQL, chart it, save it and find it in the library', async ({ page }) => {
  const errors = watchErrors(page);
  const name = unique('Orders by status');
  await signIn(page, 'carol', '/questions');
  await page.getByLabel('Table').selectOption({ label: 'Q orders' });
  await page.getByTestId('add-metric').click();
  await page.getByTestId('add-group').click();
  await page.getByTestId('group-row').first().getByLabel('Group by column').selectOption({ label: 'Status' });
  await expect(page.getByText('refunded', { exact: true }).first()).toBeVisible();
  await page.getByTestId('view-chart').click();
  await expect(page.getByTestId('echart').first()).toBeVisible();
  await page.getByTestId('save-question').click();
  await page.getByTestId('save-name').fill(name);
  await page.getByTestId('dialog-submit').click();
  await page.waitForURL(/\/questions\/\d+/);
  await expect(page.getByTestId('question-title')).toHaveText(name);
  await page.goto('/library');
  await page.getByTestId('question-row').filter({ hasText: name }).first().click();
  await expect(page.getByTestId('question-title')).toHaveText(name);
  await expect(page.getByTestId('echart').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('a dashboard filter narrows its cards', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', { name: unique('By status'), kind: 'builder', spec: COUNT_BY_STATUS });
  const d = await api(page.request, 'carol', 'POST', '/api/dashboards', { name: unique('Orders board') });
  await api(page.request, 'carol', 'PUT', `/api/dashboards/${d.id}`, {
    filters: [{ id: 'status', label: 'Status', type: 'text' }],
    cards: [{ key: 'c1', kind: 'question', question_id: q.id, layout: { x: 0, y: 0, w: 6, h: 4 }, mappings: { status: { field: 'q_orders.status' } } }],
  });
  await signIn(page, 'carol', `/dashboards/${d.id}`);
  const card = page.getByTestId('question-card').first();
  await expect(card.getByText('refunded', { exact: true })).toBeVisible();
  await page.getByTestId('filter-status').fill('paid');
  await page.keyboard.press('Enter');
  await expect(card.getByText('refunded', { exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/f\.status=paid/);
  expect(errors).toEqual([]);
});

test('saving over someone else\'s newer save asks first', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', { name: unique('Shared draft'), kind: 'builder', spec: COUNT_BY_STATUS });
  await signIn(page, 'carol', `/questions/${q.id}`);
  await expect(page.getByTestId('question-title')).toBeVisible();
  // meanwhile, in another browser, the same question is renamed
  await api(page.request, 'carol', 'PATCH', `/api/questions/${q.id}`, { name: 'Renamed elsewhere' });
  await page.getByTestId('view-chart').click();
  await page.getByTestId('save-question').click();
  const dialog = page.getByTestId('edit-conflict');
  await expect(dialog).toBeVisible();
  await dialog.getByTestId('conflict-reload').click();
  await expect(page.getByTestId('question-title')).toHaveText('Renamed elsewhere');
  expect(errors).toEqual([]);
});

test('an admin limits a group to some rows, and a member sees only those', async ({ page, browser }) => {
  const errors = watchErrors(page);
  await signIn(page, 'admin', '/admin?tab=people');
  const group = unique('EU team');
  await page.getByTestId('add-group').click();
  await page.getByTestId('group-name').fill(group);
  await page.getByTestId('group-members').getByText('alice', { exact: true }).click();
  await page.getByTestId('dialog-submit').click();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
  await page.getByTestId('rule-group').selectOption({ label: group });
  await page.getByTestId('rule-connection').selectOption('shop');
  await page.getByTestId('rule-table').selectOption('q_customers');
  await page.getByTestId('rule-column').selectOption('region');
  await page.getByTestId('rule-values').fill('EU');
  await page.getByTestId('add-rule').click();
  await expect(page.getByTestId('rule-row').filter({ hasText: group })).toBeVisible();

  const alice = await (await browser.newContext()).newPage();
  await signIn(alice, 'alice', '/browse');
  await alice.getByText('q_customers', { exact: true }).filter({ visible: true }).first().click();
  await expect(alice.getByText('Rows 1–2')).toBeVisible();
  await expect(alice.getByText('US', { exact: true })).toHaveCount(0);
  // tidy up: other tests read q_customers as alice too
  const groups = await api(page.request, 'admin', 'GET', '/api/admin/groups');
  const made = (groups.groups ?? groups).find((g: { name: string }) => g.name === group);
  await api(page.request, 'admin', 'DELETE', `/api/admin/groups/${made.id}`);
  expect(errors).toEqual([]);
});

test('an Excel CSV in Windows-1251 with decimal commas uploads as numbers', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/datasets');
  const text = 'Линия;План;Факт\r\nСборка;1 200,5;1 150,25\r\nПокраска;800;812,75\r\n';
  const bytes = Buffer.from([...text].map((ch) => {
    const code = ch.charCodeAt(0);
    if (code >= 0x410 && code <= 0x44f) return code - 0x410 + 0xc0; // А..я in Windows-1251
    if (ch === 'Ё') return 0xa8;
    if (ch === 'ё') return 0xb8;
    return code;
  }));
  await page.getByTestId('upload-file').click();
  await page.getByTestId('upload-input').setInputFiles({ name: 'plan.csv', mimeType: 'text/csv', buffer: bytes });
  await expect(page.getByTestId('upload-detected')).toContainText(/1251/);
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('upload-done')).toBeVisible();
  await expect(page.getByTestId('dataset-row').filter({ hasText: 'plan' }).first()).toBeVisible();
  const listed = await api(page.request, 'carol', 'GET', '/api/datasets');
  const plan = (listed.datasets ?? listed).find((x: { name: string }) => x.name.startsWith('plan'));
  expect(plan.columns).toEqual([{ name: 'Линия', type: 'string' }, { name: 'План', type: 'number' }, { name: 'Факт', type: 'number' }]);
  expect(errors).toEqual([]);
});
