import { expect, test } from '@playwright/test';
import { newUser, signIn, watchErrors } from './helpers';

// M15: a dashboard from a template. On the Factory demo every question about the data is answered
// by itself; the person checks the preview, creates, and the new dashboard's cards load.
test('"Downtime Pareto" from a template on the demo', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, await newUser(page.request, 'tpl'), '/dashboards', 'en', 'demo');
  await page.getByTestId('new-from-template').click();
  const dialog = page.getByTestId('template-dialog');
  await dialog.getByTestId('template-connection').selectOption('demo');
  await dialog.getByTestId('template-downtime_pareto').click();

  // the questions, answered from the data model's names
  await expect(dialog.getByText('Which table holds the downtime events?')).toBeVisible();
  await expect(dialog.getByRole('combobox', { name: 'Which column is the duration in minutes?' })).toHaveValue('downtime_events.minutes');
  await expect(dialog.getByRole('combobox', { name: 'Which column says why the line stopped?' })).toHaveValue('downtime_reasons.name');
  // a preview card with real numbers, and the cards to be made
  const preview = dialog.getByTestId('template-preview');
  await expect(preview.getByText('Downtime by reason (top 10)')).toBeVisible();
  await expect(preview.locator('canvas, svg').first()).toBeVisible();

  // "not in my data" for the line: the card per line is left out, and the dialog says why
  await dialog.getByRole('combobox', { name: 'Which column says the line (or machine)?' }).selectOption({ label: 'Not in my data' });
  await expect(dialog.getByTestId('template-missing')).toContainText('Downtime by line: needs a line column');
  await dialog.getByRole('combobox', { name: 'Which column says the line (or machine)?' }).selectOption('production_lines.name');
  await expect(dialog.getByTestId('template-missing')).toHaveCount(0);

  await dialog.getByTestId('template-create').click();
  await page.waitForURL(/\/dashboards\/\d+$/);
  await expect(page.getByRole('heading', { name: 'Downtime Pareto' }).first()).toBeVisible();
  const cards = page.getByTestId('question-card');
  await expect(cards).toHaveCount(5);
  // every card loads: the numbers show, no card reports an error
  await expect(page.getByTestId('kpi-value').first()).toHaveText(/\d/);
  for (const name of ['Downtime by reason (top 10)', 'Downtime by line', 'Downtime per week']) {
    await expect(cards.filter({ hasText: name }).locator('canvas, svg').first()).toBeVisible();
  }
  await expect(page.getByText('This card could not be loaded')).toHaveCount(0);
  expect(errors).toEqual([]);
});
