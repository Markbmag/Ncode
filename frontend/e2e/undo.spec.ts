import { expect, test, type Page } from '@playwright/test';
import { signIn, watchErrors } from './helpers';

// M12: undo / redo of the builder and SQL editor drafts, destructive changes ask first,
// and each builder step can show its first rows. (?editor=full: the full builder, not the quick question)

/** Orders: status is paid, counted per status. */
async function buildOrdersQuestion(page: Page) {
  await page.getByLabel('Table').selectOption({ label: 'Q orders' });
  await page.getByTestId('step-filter').getByRole('button', { name: 'Filter', exact: true }).click();
  const row = page.getByTestId('filter-row').first();
  await row.getByLabel('Filter column').selectOption({ label: 'Status' });
  await row.getByLabel('Value', { exact: true }).fill('paid');
  await page.getByTestId('add-metric').click();
  await page.getByTestId('add-group').click();
  await page.getByTestId('group-row').first().getByLabel('Group by column').selectOption({ label: 'Status' });
  await expect(page.getByTestId('result-stats')).toContainText('1');
}

test('the builder undoes and redoes whole steps, with the buttons and the keys', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/questions?editor=full');
  await page.getByLabel('Table').selectOption({ label: 'Q orders' });
  await page.getByTestId('add-metric').click();
  await page.getByTestId('add-group').click();
  const group = page.getByTestId('group-row').first().getByLabel('Group by column');
  await group.selectOption({ label: 'Status' });
  await expect(page.getByText('refunded', { exact: true }).first()).toBeVisible();

  await page.getByTestId('undo').click();
  await expect(group).toHaveValue('');
  await page.getByTestId('redo').click();
  await expect(group).not.toHaveValue('');
  await expect(page.getByText('refunded', { exact: true }).first()).toBeVisible();

  // the keys, with the focus outside a text box
  await page.getByTestId('step-summarise').click({ position: { x: 5, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect(group).toHaveValue('');
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('group-row')).toHaveCount(0);
  await page.keyboard.press('Control+Shift+z');
  await page.keyboard.press('Control+y');
  await expect(group).not.toHaveValue('');
  await expect(page.getByTestId('redo')).toBeDisabled();
  expect(errors).toEqual([]);
});

test('typing in a filter is one undo step', async ({ page }) => {
  await signIn(page, 'carol', '/questions?editor=full');
  await page.getByLabel('Table').selectOption({ label: 'Q orders' });
  await page.getByTestId('step-filter').getByRole('button', { name: 'Filter', exact: true }).click();
  const row = page.getByTestId('filter-row').first();
  await row.getByLabel('Filter column').selectOption({ label: 'Status' });
  await row.getByLabel('Value', { exact: true }).pressSequentially('refunded', { delay: 30 });
  await page.getByTestId('undo').click();
  await expect(row.getByLabel('Value', { exact: true })).toHaveValue('');
  await expect(row.getByLabel('Filter column')).not.toHaveValue('');
});

test('changing the table asks first, and Undo in the toast brings everything back', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/questions?editor=full');
  await buildOrdersQuestion(page);
  await page.getByLabel('Table').selectOption({ label: 'Q customers' });
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Changing the table removes 1 filter and the summary. Change anyway?');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByLabel('Table')).toHaveValue('q_orders');
  await expect(page.getByTestId('group-row')).toHaveCount(1);

  await page.getByLabel('Table').selectOption({ label: 'Q customers' });
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByLabel('Table')).toHaveValue('q_customers');
  await expect(page.getByTestId('group-row')).toHaveCount(0);
  await page.getByTestId('toast-undo').click();
  await expect(page.getByLabel('Table')).toHaveValue('q_orders');
  await expect(page.getByTestId('group-row')).toHaveCount(1);
  await expect(page.getByTestId('filter-row').first().getByLabel('Value', { exact: true })).toHaveValue('paid');
  expect(errors).toEqual([]);
});

test('Start over and removing a step with content ask first, in Russian too', async ({ page }) => {
  await signIn(page, 'carol', '/questions?editor=full', 'ru');
  await page.getByLabel('Таблица').selectOption({ label: 'Q orders' });
  await page.getByTestId('more-steps-toggle').click();
  await page.getByTestId('more-sort').click();
  await page.locator('[data-step="sort"]').getByLabel('Сортировать по').selectOption({ label: 'Total' });
  await page.getByTestId('remove-sort').click();
  await expect(page.getByRole('dialog')).toContainText('Удалить шаг «Сортировка»?');
  await expect(page.getByRole('dialog')).toContainText('Это удалит сортировку.');
  await page.getByTestId('dialog-submit').click();
  await expect(page.locator('[data-step="sort"]')).toHaveCount(0);
  await page.getByTestId('undo').click();
  await expect(page.locator('[data-step="sort"]')).toHaveCount(1);

  await page.getByTestId('start-over').click();
  await expect(page.getByRole('dialog')).toContainText('Начать заново?');
  await page.getByTestId('dialog-submit').click();
  await expect(page.getByLabel('Таблица')).toHaveValue('');
  await page.getByTestId('undo').click();
  await expect(page.getByLabel('Таблица')).toHaveValue('q_orders');
});

test('each step shows its first rows: after the filter, after the summary', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/questions?editor=full');
  await buildOrdersQuestion(page);
  const filter = page.getByTestId('step-filter');
  await filter.getByTestId('step-preview-toggle').click();
  const rows = filter.getByTestId('step-preview');
  await expect(rows.getByRole('row')).toHaveCount(5); // the five paid orders, before the summary
  await expect(rows.getByText('refunded', { exact: true })).toHaveCount(0);
  const summary = page.getByTestId('step-summarise');
  await summary.getByTestId('step-preview-toggle').click();
  await expect(summary.getByTestId('step-preview').getByRole('row')).toHaveCount(1);
  await expect(summary.getByTestId('step-preview').getByRole('columnheader', { name: /Count/ })).toBeVisible();
  // the preview follows the question
  await page.getByTestId('filter-row').first().getByLabel('Value', { exact: true }).fill('refunded');
  await expect(rows.getByRole('row')).toHaveCount(1);
  await filter.getByTestId('step-preview-toggle').click();
  await expect(filter.getByTestId('step-preview')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('the SQL editor keeps its own text undo; outside it the whole draft is undone', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/sql');
  const editor = page.getByTestId('sql-editor');
  await editor.click();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.press('Delete');
  await page.keyboard.type('SELECT 1 AS a');
  await page.getByLabel('Row limit').selectOption('100');
  await page.getByTestId('undo').click();
  await expect(page.getByLabel('Row limit')).not.toHaveValue('100');
  await expect(editor).toHaveText('SELECT 1 AS a');
  await page.getByTestId('redo').click();
  await expect(page.getByLabel('Row limit')).toHaveValue('100');

  // inside the editor Ctrl+Z is the editor's: the text goes back, the row limit stays
  await editor.click();
  await page.keyboard.press('End');
  await page.keyboard.type(', 2 AS b');
  await page.keyboard.press('Control+z');
  await expect(editor).toHaveText('SELECT 1 AS a');
  await expect(page.getByLabel('Row limit')).toHaveValue('100');
  expect(errors).toEqual([]);
});
