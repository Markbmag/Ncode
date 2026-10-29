import { expect, test, type Page } from '@playwright/test';
import { signIn } from './helpers';

const inView = async (page: Page, testId: string) => {
  const box = await page.getByTestId('sidebar').getByTestId(testId).first().boundingBox();
  const size = page.viewportSize()!;
  expect(box, `${testId} is drawn`).not.toBeNull();
  expect(box!.y + box!.height, `${testId} fits in the window`).toBeLessThanOrEqual(size.height);
};

test('a short window keeps the database and your account in view; the menu scrolls', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 620 });
  await signIn(page, 'admin', '/');
  await inView(page, 'database-switcher');
  await inView(page, 'account-email-button');
  // the database can be changed from the top of the sidebar
  await page.getByTestId('sidebar').getByTestId('database-switcher').click();
  await page.getByTestId('database-shop').click();
  await expect(page.getByTestId('sidebar').getByTestId('database-switcher')).toContainText('Shop');
  // nothing in the sidebar is cut off: what does not fit scrolls inside it
  const clipped = await page.getByTestId('sidebar').evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(clipped).toBeLessThanOrEqual(1);
});

test('a narrow window gets the narrow menu, which can be widened and is remembered', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 560 });
  await signIn(page, 'carol', '/');
  const sidebar = page.getByTestId('sidebar');
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeLessThan(100);
  await page.getByTestId('account-menu').click();
  await expect(page.getByRole('menuitem', { name: /Sign out/ })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByTestId('sidebar-toggle').click();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(200);
  await page.reload();
  await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(200);
});
