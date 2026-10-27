import { expect, test } from '@playwright/test';
import { expectNoHorizontalScroll, signIn, watchErrors } from './helpers';

test('signing in: a wrong password is explained, the right one opens the home page', async ({ page }) => {
  const errors = watchErrors(page);
  await page.goto('/');
  await page.getByLabel('Username').fill('carol');
  await page.getByLabel('Password').fill('wrong-password');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByText(/wrong|incorrect|invalid/i).first()).toBeVisible();
  await page.getByLabel('Password').fill('carol-pass-1');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: /Hello, carol/ })).toBeVisible();
  expect(errors).toEqual([]);
});

test('search finds a value in every table', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/search');
  await page.getByRole('textbox').first().fill('Anna');
  await page.keyboard.press('Enter');
  await expect(page.getByText('1 match in 1 table')).toBeVisible();
  await expect(page.getByText('Anna', { exact: true }).filter({ visible: true }).first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('browse shows the rows of a table', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/browse');
  await page.getByText('q_orders', { exact: true }).filter({ visible: true }).first().click();
  await expect(page.getByText('Rows 1–7')).toBeVisible();
  await expect(page.getByText('refunded', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('every main page opens without errors', async ({ page }) => {
  const errors = watchErrors(page);
  await signIn(page, 'admin');
  for (const path of ['/', '/search', '/browse', '/library', '/questions', '/sql', '/combine', '/datasets', '/dashboards', '/subscriptions', '/admin']) {
    await page.goto(path);
    await expect(page.locator('main, [role=main], body').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('the phone layout never scrolls sideways @phone', async ({ page }) => {
  await signIn(page, 'carol');
  for (const path of ['/', '/search', '/browse', '/library', '/dashboards', '/questions']) {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await expectNoHorizontalScroll(page);
  }
});

test('the interface switches to Russian and back', async ({ page }) => {
  await signIn(page, 'carol');
  await page.getByTestId('language-switch').first().click();
  await page.getByTestId('language-ru').click();
  await expect(page.getByRole('heading', { name: /Здравствуйте, carol/ })).toBeVisible();
  await page.getByTestId('language-switch').first().click();
  await page.getByTestId('language-en').click();
  await expect(page.getByRole('heading', { name: /Hello, carol/ })).toBeVisible();
});
