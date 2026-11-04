import { expect, test } from '@playwright/test';
import { api, expectNoHorizontalScroll, signIn, watchErrors } from './helpers';

// M15: a foreman opens the morning dashboard on a phone: number cards say how the last full week
// compares with the week before (and with a target), every card says when its data was read, the
// filters fold into a sheet, and nothing scrolls sideways.
test('the demo dashboard on a phone: readable number cards, filters in a sheet @phone', async ({ page }) => {
  const errors = watchErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  const boards = (await api(page.request, 'carol', 'GET', '/api/dashboards?q=Production overview')).dashboards as { id: number; name: string }[];
  const board = boards.find((d) => d.name === 'Production overview')!;
  await signIn(page, 'carol', `/dashboards/${board.id}`, 'en', 'demo');

  const kpis = page.getByTestId('kpi');
  await expect(kpis).toHaveCount(2);
  // work orders: a sentence about the week before, the running week told apart
  const orders = kpis.nth(0);
  await expect(orders.getByTestId('kpi-compare')).toHaveText(/^(▲|▼) \d+(\.\d)?\s?% vs the week before$|^Unchanged vs the week before$/);
  await expect(orders.getByTestId('kpi-period')).toHaveText('Last week');
  await expect(orders.getByTestId('kpi-partial')).toContainText('So far this week');
  // the scrap rate: lower is better, in points, against its 2 % target
  const scrap = kpis.nth(1);
  await expect(scrap.getByTestId('kpi-compare')).toContainText(/points? vs the week before|Unchanged/);
  await expect(scrap.getByTestId('kpi-target')).toHaveText(/^Target 2\.0\s?% · /);
  // two number cards side by side, the charts one per row below them
  const [a, b] = [await orders.boundingBox(), await scrap.boundingBox()];
  expect(Math.abs(a!.y - b!.y)).toBeLessThan(2);
  expect(b!.x).toBeGreaterThan(a!.x + a!.width - 1);

  // data as of: the header and every card
  await expect(page.getByTestId('dashboard-data-as-of')).toContainText('Data from');
  await expect(page.getByTestId('card-data-age').first()).toHaveText(/just now|min ago/);
  await expect(page.getByTestId('refresh-dashboard')).toHaveText('Refresh all');

  // filters: one large button, a sheet from the bottom
  await expect(page.getByTestId('filter-bar')).toHaveCount(0);
  const button = page.getByTestId('phone-filters');
  await expect(button).toHaveText('Filters');
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.click();
  const sheet = page.getByTestId('filters-sheet');
  await expect(sheet).toBeVisible();
  await sheet.getByTestId('filter-line').click();
  await page.getByTestId('value-option').filter({ hasText: 'Paint line' }).click();
  await sheet.getByTestId('filters-sheet-done').click();
  await expect(sheet).toBeHidden();
  await expect(button).toHaveText('Filters (1)');
  await expect(page).toHaveURL(/line=/);
  await expect(orders.getByTestId('kpi-value')).toBeVisible();

  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
