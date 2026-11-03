import { expect, test } from '@playwright/test';
import { api, newUser, signIn, unique, watchErrors } from './helpers';

// M12: value pickers, names in place of ids and dashboard filters that connect themselves,
// on the Factory demo (every foreign key there shows the related table's name).

const BY_LINE = {
  version: 1, connection: 'demo', source: { table: 'downtime_events' },
  breakouts: [{ ref: 'downtime_events.line_id' }], aggregations: [{ fn: 'count', alias: 'stops' }],
};

test('a filter offers the values of its column, with names for ids, and the result shows the names', async ({ page }) => {
  const errors = watchErrors(page);
  const who = await newUser(page.request, 'picker');
  const draft = { ...BY_LINE, filters: { op: 'and', rules: [{ ref: 'downtime_events.line_id', op: 'in', value: [] }] } };
  await page.addInitScript((spec) => {
    if (!sessionStorage.getItem('ncode_question_demo')) sessionStorage.setItem('ncode_question_demo', spec);
  }, JSON.stringify(draft));
  await signIn(page, who, '/questions?editor=full', 'en', 'demo');

  const box = page.getByTestId('filter-value');
  await box.click();
  const list = page.getByTestId('value-picker-list');
  await expect(list.getByTestId('value-option').filter({ hasText: '3 · Paint line' })).toBeVisible();
  await list.getByTestId('value-option').filter({ hasText: 'Paint line' }).click();
  await list.getByTestId('value-option').filter({ hasText: 'Final assembly' }).click();
  await expect(box).toHaveValue(/^3, 4/);
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('value-labels')).toHaveText('Paint line, Final assembly');

  // grouped by the line: the names, not 3 and 4
  const table = page.getByTestId('results-table');
  await expect(table.getByRole('gridcell', { name: 'Paint line', exact: true })).toBeVisible();
  await expect(table.getByRole('gridcell', { name: 'Final assembly', exact: true })).toBeVisible();
  await expect(table.getByRole('gridcell', { name: 'Press line', exact: true })).toHaveCount(0);

  // searching inside the list: a name finds its id
  await box.fill('');
  await box.pressSequentially('weld');
  await expect(list.getByTestId('value-option').first()).toContainText('2 · Welding line');
  expect(errors).toEqual([]);
});

test('dashboard filters connect themselves and say which cards they do not reach', async ({ page }) => {
  const errors = watchErrors(page);
  const stops = await api(page.request, 'carol', 'POST', '/api/questions', { name: unique('Stops per line'), kind: 'builder', spec: BY_LINE });
  const cars = await api(page.request, 'carol', 'POST', '/api/questions', {
    name: unique('Cars per market'), kind: 'builder',
    spec: { version: 1, connection: 'demo', source: { table: 'vehicles' }, breakouts: [{ ref: 'vehicles.market' }], aggregations: [{ fn: 'count' }] },
  });
  const d = await api(page.request, 'carol', 'POST', '/api/dashboards', { name: unique('Plant board') });
  await api(page.request, 'carol', 'PUT', `/api/dashboards/${d.id}`, {
    filters: [], tabs: [], settings: {},
    cards: [
      { key: 'c1', kind: 'question', question_id: stops.id, layout: { x: 0, y: 0, w: 6, h: 6 }, viz: { mode: 'table' } },
      { key: 'c2', kind: 'question', question_id: cars.id, layout: { x: 6, y: 0, w: 6, h: 6 } },
    ],
  });
  await signIn(page, 'carol', `/dashboards/${d.id}?edit=1`, 'en', 'demo');
  await page.getByTestId('edit-filters').click();

  // a list of values named "Line": the card with a line column connects itself
  await page.getByTestId('add-filter').selectOption('category');
  await page.getByTestId('filter-label').fill('Line');
  await expect(page.getByTestId('auto-connected')).toContainText('1 of 2');
  await expect(page.getByTestId('mapping-auto')).toHaveCount(1);
  // a date range: each card's own date
  await page.getByTestId('add-filter').selectOption('date_range');
  await page.getByTestId('filter-label').fill('Period');
  await expect(page.getByTestId('auto-connected')).toContainText('2 of 2');
  await page.getByTestId('dialog-submit').click();
  await page.getByTestId('save-dashboard').click();
  await expect(page.getByTestId('edit-dashboard')).toBeVisible();

  // the line filter offers the lines (from the first card connected to it)
  const line = page.getByTestId('filter-line');
  await line.click();
  await page.getByTestId('value-picker-list').getByTestId('value-option').filter({ hasText: 'Paint line' }).click();
  await expect(page).toHaveURL(/f\.line=3/);
  await page.keyboard.press('Escape');
  const [first, second] = [page.getByTestId('question-card').nth(0), page.getByTestId('question-card').nth(1)];
  await expect(first.getByText('Paint line', { exact: true })).toBeVisible();
  await expect(first.getByText('Press line', { exact: true })).toHaveCount(0);
  await expect(second.getByTestId('card-not-filtered')).toHaveText('not filtered by Line');
  await expect(first.getByTestId('card-not-filtered')).toHaveCount(0);
  expect(errors).toEqual([]);
});
