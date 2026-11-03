import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

// M12: ratio metrics (Data model → Metrics) and the pivot like Excel (Rows / Columns / Values), on the Factory demo.

const SCRAP_BY_WEEK_AND_LINE = {
  version: 1, connection: 'demo', source: { table: 'production_output' },
  joins: [{ table: 'work_orders' }, { table: 'production_lines' }],
  aggregations: [{ fn: 'sum', ref: 'production_output.scrap_qty', alias: 'Scrapped' }],
  breakouts: [{ ref: 'production_output.reported_at', bucket: 'month', alias: 'Month' }, { ref: 'production_lines.name', alias: 'Line' }],
};

test('an admin divides one total by another and sees the value at once', async ({ page }) => {
  const errors = watchErrors(page);
  const name = unique('Scrap share');
  await signIn(page, 'admin', '/admin', 'en', 'demo');
  await page.getByTestId('admin-tab-data-model').click();
  await page.getByTestId('new-metric').click();
  await page.getByTestId('metric-name').fill(name);
  await page.getByTestId('metric-table').selectOption('production_output');
  await page.getByTestId('metric-fn').selectOption({ label: 'Divide one total by another' });
  await page.getByTestId('metric-num-fn').selectOption('sum');
  await page.getByTestId('metric-num-column').selectOption({ label: 'Scrapped pieces' });
  await page.getByTestId('metric-den-fn').selectOption('sum');
  await page.getByTestId('metric-den-column').selectOption({ label: 'Good pieces' });
  await page.getByTestId('metric-den-column-add').click();
  await page.getByTestId('metric-den-column-2').selectOption({ label: 'Scrapped pieces' });
  // the live example: a share shown as percent, with both totals
  await expect(page.getByTestId('metric-example')).toContainText(/On all rows of the table now: [\d.,]+\s?% = [\d,]+ ÷ [\d,]+/);
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByTestId('metric-item').filter({ hasText: name })).toContainText('÷');

  const metric = (await api(page.request, 'admin', 'GET', '/api/metrics?connection=demo')).metrics.find((m: { name: string }) => m.name === name);
  expect(metric.definition.fn).toBe('ratio');
  expect(metric.definition.numerator).toEqual({ fn: 'sum', ref: 'production_output.scrap_qty' });
  expect(metric.definition.denominator.expr.args.map((a: { ref: string }) => a.ref)).toEqual(['production_output.good_qty', 'production_output.scrap_qty']);
  expect(metric.format).toEqual({ style: 'percent' });
  await api(page.request, 'admin', 'PATCH', `/api/metrics/${metric.id}`, { archived: true });
  expect(errors).toEqual([]);
});

test('a pivot starts from a sensible layout, is changed in Rows / Columns / Values and exported with it', async ({ page }) => {
  const errors = watchErrors(page);
  const q = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Scrap per month and line'), kind: 'builder', spec: SCRAP_BY_WEEK_AND_LINE,
    viz: { mode: 'chart', spec: { version: 1, type: 'pivot' } },
  });
  await signIn(page, 'carol', `/questions/${q.id}`, 'en', 'demo');
  const pivot = page.getByTestId('pivot');
  // the default: months down, lines across, totals
  await expect(pivot.locator('th', { hasText: /^Paint line$/ })).toBeVisible();
  await expect(pivot.locator('th', { hasText: /^Sum of Scrapped$/ })).toBeVisible();
  await expect(pivot.getByTestId('pivot-total-row')).toBeVisible();

  await page.getByTestId('chart-settings').click();
  const editor = page.getByTestId('pivot-editor');
  await expect(editor.getByTestId('pivot-area-rows').getByTestId('pivot-chip-rows-Month')).toBeVisible();
  // drag Line from Columns to Rows: one row per month and line, no columns
  await editor.getByTestId('pivot-chip-columns-Line').dragTo(editor.getByTestId('pivot-area-rows'));
  await expect(editor.getByTestId('pivot-area-rows').getByTestId('pivot-chip-rows-Line')).toBeVisible();
  await expect(pivot.locator('th', { hasText: /^Paint line$/ })).toHaveCount(0);
  // pick instead of dragging: Line back across, as the maximum, without totals
  await editor.getByTestId('pivot-menu-rows-Line').click();
  await page.getByTestId('pivot-move-columns').click();
  await editor.getByTestId('pivot-agg-0').selectOption('max');
  await editor.getByTestId('pivot-totals').click();
  await expect(pivot.locator('th', { hasText: /^Max of Scrapped$/ })).toBeVisible();
  await expect(pivot.getByTestId('pivot-total-row')).toHaveCount(0);
  await page.keyboard.press('Escape');

  // a dashboard card shown as a pivot exports that layout to Excel
  const d = await api(page.request, 'carol', 'POST', '/api/dashboards', { name: unique('Scrap board') });
  await api(page.request, 'carol', 'PUT', `/api/dashboards/${d.id}`, {
    cards: [{ key: 'p', kind: 'question', question_id: q.id, layout: { x: 0, y: 0, w: 12, h: 8 } }],
  });
  await page.goto(`/dashboards/${d.id}`);
  await expect(page.getByTestId('pivot').locator('th', { hasText: /^Paint line$/ })).toBeVisible();
  await page.getByTestId('card-menu').click();
  const exported = page.waitForResponse((r) => r.url().includes('/export.xlsx') && r.url().includes('pivot='));
  await page.getByRole('menuitem', { name: /Excel workbook/ }).click();
  const res = await exported;
  expect(res.status()).toBe(200);
  const layout = JSON.parse(new URL(res.url()).searchParams.get('pivot')!);
  expect([layout.rows, layout.columns, layout.values[0].agg]).toEqual([['Month'], ['Line'], 'sum']);
  expect(errors).toEqual([]);
});
