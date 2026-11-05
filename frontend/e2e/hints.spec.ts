// Hover hints (after K2): they open when the mouse rests on a button, not by themselves when focus
// comes back to the button after its menu closes, and not after a tap on a phone.
import { expect, test } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

test('a hint waits for the mouse and does not pop up after a menu closes', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Hints') });
  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  const more = page.getByTestId('board-more');
  // open the menu with the mouse and close it: focus goes back to the button
  await more.click();
  await expect(page.getByTestId('labels-button')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('labels-button')).toBeHidden();
  await page.mouse.move(5, 500); // the mouse is somewhere else
  await page.waitForTimeout(3600);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  // resting the mouse on the button shows its hint after 3 s
  await more.hover();
  await page.waitForTimeout(1000);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(page.getByRole('tooltip')).toHaveText('Labels, board settings, hidden tasks', { timeout: 4000 });
  expect(errors).toEqual([]);
});

test('a tap on a phone does not bring up a hint later @phone', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Hints phone') });
  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  await page.getByTestId('board-more').tap();
  await expect(page.getByTestId('labels-button')).toBeVisible();
  await page.getByTestId('labels-button').tap();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(3600);
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  expect(errors).toEqual([]);
});
