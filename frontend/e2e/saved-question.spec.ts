import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalScroll, signIn, unique, watchErrors } from './helpers';

// M12: a saved question opens as its result (chart full width, caption, description, parameters);
// "Edit" opens the builder or the SQL editor around it, "Done" goes back.
const COUNT_BY_STATUS = {
  version: 1, connection: 'shop', source: { table: 'q_orders' },
  aggregations: [{ fn: 'count', alias: 'orders' }], breakouts: [{ ref: 'status' }],
};
const CHART = { mode: 'chart', spec: null };

test('a saved question opens as its result; Edit opens the builder and Done goes back', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Orders per status'), description: 'How many orders each status has', kind: 'builder', spec: COUNT_BY_STATUS, viz: CHART,
  });
  await signIn(page, 'carol', `/questions/${q.id}`);
  await expect(page.getByTestId('question-view')).toBeVisible();
  await expect(page.getByTestId('echart').first()).toBeVisible();
  await expect(page.getByTestId('result-caption')).toBeVisible();
  await expect(page.getByTestId('question-description')).toHaveText('How many orders each status has');
  await expect(page.getByTestId('builder')).toHaveCount(0);
  await expect(page.getByTestId('save-question')).toHaveCount(0);
  // the chart gets the whole width
  const width = await page.getByTestId('question-result').evaluate((el) => el.getBoundingClientRect().width);
  expect(width).toBeGreaterThan(1000);

  await page.getByTestId('edit-question').click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page).toHaveURL(/edit=1/);
  await expect(page.getByTestId('echart').first()).toBeVisible();

  // a change, then Done: asked whether to save; dropping it goes back to the saved chart
  await page.getByTestId('view-table').click();
  await page.getByTestId('done-editing').click();
  await expect(page.getByTestId('leave-editor')).toBeVisible();
  await page.getByTestId('leave-discard').click();
  await expect(page.getByTestId('question-view')).toBeVisible();
  await expect(page).not.toHaveURL(/edit=1/);
  await expect(page.getByTestId('echart').first()).toBeVisible();

  // ... and saving it keeps the change
  await page.getByTestId('edit-question').click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await page.getByTestId('view-table').click();
  await page.getByTestId('done-editing').click();
  await page.getByTestId('leave-save').click();
  await expect(page.getByTestId('question-view')).toBeVisible();
  await expect(page.getByRole('columnheader').first()).toBeVisible();
  await expect(page.getByTestId('echart')).toHaveCount(0);
  expect((await api(page.request, 'carol', 'GET', `/api/questions/${q.id}`)).viz.mode).toBe('table');

  // without changes, Done goes straight back
  await page.getByTestId('edit-question').click();
  await page.getByTestId('done-editing').click();
  await expect(page.getByTestId('question-view')).toBeVisible();

  // the chart and its settings can also be changed and saved right here
  await page.getByTestId('view-chart').click();
  await expect(page.getByTestId('chart-settings')).toBeVisible();
  await page.getByTestId('save-chart').click();
  await expect(page.getByTestId('save-chart')).toHaveCount(0);
  expect((await api(page.request, 'carol', 'GET', `/api/questions/${q.id}`)).viz.mode).toBe('chart');
  expect(errors).toEqual([]);
});

test('an SQL question shows its parameters in the result and opens the SQL editor to edit', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Orders of one status'), kind: 'sql', connection: 'shop',
    spec: { sql: 'SELECT status, COUNT(*) AS orders FROM q_orders WHERE status = {{status}} GROUP BY status', limit: 100 },
    parameters: [{ name: 'status', label: 'Status', type: 'text', default: 'paid' }],
  });
  await signIn(page, 'carol', `/questions/${q.id}`);
  const view = page.getByTestId('question-view');
  await expect(view.getByText('paid', { exact: true })).toBeVisible();
  await page.getByTestId('parameters').getByRole('textbox').first().fill('refunded');
  await expect(view.getByText('refunded', { exact: true })).toBeVisible();
  await expect(page).toHaveURL(/p\.status=refunded/);
  await page.getByTestId('edit-question').click();
  await expect(page.getByTestId('sql-editor')).toBeVisible();
  await expect(page.getByTestId('done-editing')).toBeVisible();
  expect(errors).toEqual([]);
});

test('someone who may only view gets the result and "Duplicate to edit"', async ({ page }) => {
  const errors = watchErrors(page);
  const shared = await api(page.request, 'carol', 'POST', '/api/collections', { name: unique('Read only') });
  await api(page.request, 'carol', 'PUT', `/api/collections/${shared.id}/permissions`, { grants: [{ user: 'alice', level: 'view' }] });
  const name = unique('Carol\'s count');
  const q = await api(page.request, 'carol', 'POST', '/api/questions', { name, kind: 'builder', spec: COUNT_BY_STATUS, collection_id: shared.id });
  await signIn(page, 'alice', `/questions/${q.id}?edit=1`); // an editor link does not open the editor for a viewer
  await expect(page.getByTestId('question-view')).toBeVisible();
  await expect(page.getByTestId('edit-question')).toHaveCount(0);
  await expect(page.getByTestId('save-question')).toHaveCount(0);
  await page.getByTestId('view-table').click(); // another look for now, nothing to save
  await expect(page.getByTestId('save-chart')).toHaveCount(0);
  await page.getByTestId('duplicate-to-edit').click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page.getByTestId('question-title')).toHaveText(`${name} (copy)`);
  await expect(page.getByTestId('save-question')).toBeVisible();
  expect(errors).toEqual([]);
});

test('in a short window the result fills it without pushing past it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 560 });
  const q = await api(page.request, 'carol', 'POST', '/api/questions', { name: unique('Short window'), description: 'Orders per status', kind: 'builder', spec: COUNT_BY_STATUS, viz: CHART });
  await signIn(page, 'carol', `/questions/${q.id}`);
  await expect(page.getByTestId('echart').first()).toBeVisible();
  await expect(page.getByTestId('chart-settings')).toBeVisible(); // the chart settings stay at hand
  const box = (await page.getByTestId('question-result').boundingBox())!;
  expect(box.y + box.height).toBeLessThanOrEqual(560);
  expect(box.height).toBeGreaterThan(300);
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(561);
});

test('on a phone the result comes first @phone', async ({ page }) => {
  const q = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Phone count'), description: 'Orders per status, for the morning meeting', kind: 'builder', spec: COUNT_BY_STATUS, viz: CHART,
  });
  await signIn(page, 'carol', `/questions/${q.id}`);
  await expect(page.getByTestId('echart').first()).toBeVisible();
  const top = async (id: string) => page.getByTestId(id).evaluate((el) => el.getBoundingClientRect().top);
  expect(await top('question-result')).toBeLessThan(await top('question-description'));
  await expectNoHorizontalScroll(page);
});
