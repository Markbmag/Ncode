import { expect, test } from '@playwright/test';
import type { Locator } from '@playwright/test';
import { api, expectNoHorizontalScroll, newUser, signIn, unique, watchErrors } from './helpers';

// M12 "Simple questions": the quick question is what "New question" opens; ready questions,
// Top N and the chart's reason; everything carries over into the full editor.

// The M12 done-when: "scrap per line per week for the last quarter as a chart" in at most six clicks
// from the home page, for someone who has never used Ncode - in English and in Russian.
for (const lang of ['en', 'ru'] as const) {
  const L = lang === 'ru'
    ? { newq: 'Новый вопрос', line: 'Линия', caption: 'Сумма «Брак, шт.» по столбцу «Линия» и по неделям · прошлый квартал' }
    : { newq: 'New question', line: 'Line', caption: 'Sum of Scrapped pieces per Line and per week · last quarter' };

  test(`a newcomer charts scrap per line per week for the last quarter in six clicks (${lang})`, async ({ page }) => {
    const errors = watchErrors(page);
    await signIn(page, await newUser(page.request), '/', lang, 'demo');
    let clicks = 0;
    const click = async (target: Locator) => {
      await target.click();
      clicks += 1;
    };
    await click(page.getByRole('link', { name: L.newq, exact: true }).first()); // 1. the menu
    await click(page.getByTestId('quick-table-scrap_records')); // 2. the table
    await click(page.getByTestId('quick-see-sum')); // 3. what to see: the sum (of the one number, scrapped pieces)
    await click(page.getByTestId('quick-split').getByRole('button', { name: L.line, exact: true })); // 4. split by line
    await click(page.getByTestId('quick-time-week')); // 5. ... and per week
    await click(page.getByTestId('quick-when-last_quarter')); // 6. only the last quarter
    await expect(page.getByTestId('result-caption')).toHaveText(L.caption);
    await expect(page.getByTestId('echart')).toBeVisible();
    await expect(page.getByTestId('chart-type')).toHaveValue('line'); // one line per production line
    test.info().annotations.push({ type: 'clicks', description: String(clicks) });
    expect(clicks).toBeLessThanOrEqual(6);
    expect(errors).toEqual([]);
  });
}

test('a ready question fills the quick question; the full editor opens the same question', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, await newUser(page.request), '/questions', 'en', 'demo');
  await page.getByTestId('quick-table-downtime_events').click();
  await page.getByTestId('suggestion-weekly').click();
  const caption = 'Sum of Duration, min per Line and per week';
  await expect(page.getByTestId('result-caption')).toHaveText(caption);
  await expect(page.getByTestId('quick-see-sum')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('quick-time-week')).toHaveAttribute('aria-pressed', 'true');

  // nothing is lost on the way to the full editor
  await page.getByTestId('quick-open-full').click();
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect(page).toHaveURL(/editor=full/);
  await expect(page.getByLabel('Table').first()).toHaveValue('downtime_events');
  await expect(page.getByTestId('group-row')).toHaveCount(2);
  await expect(page.getByTestId('result-caption')).toHaveText(caption);

  // the switch goes back to the quick question, which still has its choices
  await page.getByTestId('editor-switch').click({ force: true }); // on: the full editor from now on
  await page.getByTestId('editor-switch').click({ force: true }); // off again
  await expect(page.getByTestId('quick-question')).toBeVisible();
  await expect(page.getByTestId('quick-time-week')).toHaveAttribute('aria-pressed', 'true');

  // saved from the quick question like any builder question
  const name = unique('Downtime per line and week');
  await page.getByTestId('save-question').click();
  await page.getByTestId('save-name').fill(name);
  await page.getByTestId('dialog-submit').click();
  await page.waitForURL(/\/questions\/\d+/);
  await expect(page.getByTestId('question-title')).toHaveText(name);
  expect(errors).toEqual([]);
});

test('"Full editor" is remembered for the person', async ({ page }) => {
  const who = await newUser(page.request);
  await signIn(page, who, '/questions', 'en', 'demo');
  await expect(page.getByTestId('quick-question')).toBeVisible();
  await page.getByTestId('editor-switch').click({ force: true });
  await expect(page.getByTestId('builder')).toBeVisible();
  await expect.poll(async () => (await api(page.request, who, 'GET', '/api/account/prefs')).question_editor).toBe('full');
  // another browser of the same person
  await page.evaluate(() => localStorage.removeItem('ncode_question_editor'));
  await page.goto('/questions');
  await expect(page.getByTestId('builder')).toBeVisible();
  await page.getByTestId('editor-switch').click({ force: true });
  await expect(page.getByTestId('quick-question')).toBeVisible();
  await expect.poll(async () => (await api(page.request, who, 'GET', '/api/account/prefs')).question_editor).toBe('quick');
});

test('conditions offer the column’s values; Top N keeps the biggest groups', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, await newUser(page.request), '/questions', 'en', 'demo');
  await page.getByTestId('quick-table-downtime_events').click();
  await page.getByTestId('quick-see-sum').click();
  await page.getByTestId('quick-split').getByRole('button', { name: 'Reason', exact: true }).click();
  // only the mechanical reasons: picked from the list of the column's values
  await page.getByTestId('quick-add-where').click();
  await page.getByTestId('quick-where-row').getByLabel('Filter column').selectOption({ label: 'Reason group' });
  await page.getByTestId('quick-where-value').click();
  await page.getByTestId('value-option').filter({ hasText: 'Mechanical' }).first().click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('result-caption')).toHaveText('Sum of Duration, min per Reason · Reason group is Mechanical');
  await expect(page.getByTestId('result-stats')).toContainText('3 rows'); // conveyor jam, hydraulic failure, tool breakage
  // the two biggest
  await page.getByTestId('quick-top-switch').click({ force: true });
  await page.getByTestId('quick-top-n').fill('2');
  await expect(page.getByTestId('result-caption')).toHaveText('Sum of Duration, min per Reason · Reason group is Mechanical · top 2');
  await expect(page.getByTestId('result-stats')).toContainText('2 rows');
  expect(errors).toEqual([]);
});

test('the full editor: ready questions in the Data step, Top N in Summarise, the chart says why', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, await newUser(page.request), '/questions?editor=full', 'en', 'demo');
  await page.getByLabel('Table').first().selectOption({ label: 'Scrap records' });
  await page.getByTestId('step-data').getByTestId('suggestion-top').click();
  await expect(page.getByTestId('result-caption')).toHaveText('Sum of Scrapped pieces per Part · top 10');
  await expect(page.getByTestId('top-n-count')).toHaveValue('10');
  await page.getByTestId('top-n-count').fill('5');
  await expect(page.getByTestId('result-stats')).toContainText('5 rows');
  await expect(page.getByTestId('result-caption')).toHaveText('Sum of Scrapped pieces per Part · top 5');
  // bars, and why; a chart that cannot show one category and one number is greyed out with the reason
  await page.getByTestId('view-chart').click();
  await expect(page.getByTestId('chart-type')).toHaveValue('bar');
  await page.getByTestId('chart-settings').click();
  await expect(page.getByTestId('viz-reason')).toHaveText('Bars: categories and a number');
  await expect(page.getByTestId('viz-type-scatter')).toHaveAttribute('aria-disabled', 'true');
  await page.getByTestId('viz-type-scatter').click({ force: true }); // greyed out: nothing happens
  await expect(page.getByTestId('chart-type')).toHaveValue('bar'); // the greyed-out type did not apply
  await page.getByTestId('viz-type-pie').click();
  await expect(page.getByTestId('chart-type')).toHaveValue('pie');
  expect(errors).toEqual([]);
});

test('the quick question fits a phone @phone', async ({ page }) => {
  await signIn(page, await newUser(page.request), '/questions', 'en', 'demo');
  await page.getByTestId('quick-table-scrap_records').click();
  await page.getByTestId('quick-see-sum').click();
  await expect(page.getByTestId('result-caption')).toBeVisible();
  await expectNoHorizontalScroll(page);
});
