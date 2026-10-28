import { expect, test } from '@playwright/test';
import { newUser, signIn, watchErrors } from './helpers';

// The M11 "done when": a newcomer completes the five checklist steps on the Factory demo,
// following what the screen offers (Start here, the menu), in English and in Russian.
for (const lang of ['en', 'ru'] as const) {
  const L = lang === 'ru'
    ? { first: 'Ваши первые шаги в Ncode', search: 'Поиск', newq: 'Новый вопрос', table: 'Простои', line: 'Линия', home: 'Главная' }
    : { first: 'Your first steps in Ncode', search: 'Search', newq: 'New question', table: 'Downtime events', line: 'Line', home: 'Home' };

  test(`a newcomer does the five first steps on the demo (${lang})`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, await newUser(page.request), '/', lang, null);
    await expect(page.getByText(L.first)).toBeVisible();

    // 1. open a dashboard: the demo's Production overview is under "Start here"
    await page.getByText('Production overview', { exact: true }).first().click(); // the demo examples are in English here
    await expect(page.getByTestId('question-card').first()).toBeVisible();
    // 2. change a filter
    await page.getByTestId('filter-line').fill('Final assembly');
    await expect(page).toHaveURL(/f\.line=Final/);
    // 3. find a record: a VIN shown on the dashboard, through Search
    const vin = (await page.getByText(/^NCX[A-Z0-9]{14}$/).first().textContent())!.trim();
    await page.getByRole('link', { name: L.search, exact: true }).first().click();
    const box = page.getByPlaceholder(/VIN/).first();
    await box.fill(vin);
    await box.press('Enter');
    await page.getByText(vin, { exact: true }).filter({ visible: true }).first().click();
    await page.keyboard.press('Escape');
    // 4. ask a question: count downtime events per line, no SQL
    await page.getByRole('link', { name: L.newq, exact: true }).first().click();
    await page.getByLabel(lang === 'ru' ? 'Таблица' : 'Table').first().selectOption({ label: L.table });
    await page.getByTestId('add-metric').click();
    await page.getByTestId('add-group').click();
    await page.getByTestId('group-row').first().getByRole('combobox').first().selectOption({ label: L.line });
    await expect(page.getByTestId('result-stats').or(page.getByRole('columnheader').first()).first()).toBeVisible();
    // 5. save it
    await page.getByTestId('save-question').click();
    await page.getByTestId('save-name').fill(lang === 'ru' ? 'Простои по линиям' : 'Downtime per line');
    await page.getByTestId('dialog-submit').click();
    await page.waitForURL(/\/questions\/\d+/);

    // the checklist ticked every step and hid itself
    await page.getByRole('link', { name: L.home, exact: true }).first().click();
    await expect(page.getByText(lang === 'ru' ? 'Начните отсюда' : 'Start here').first()).toBeVisible();
    await expect(page.getByText(L.first)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
}
