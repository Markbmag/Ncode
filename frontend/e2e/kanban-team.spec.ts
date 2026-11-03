/**
 * The K1 "done when": three people on one board at the same time - two desktop browsers and a phone -
 * and every move, ticked step and comment shows up for the others with its author and time.
 */
import { devices, expect, test, type Browser, type Page } from '@playwright/test';
import { api, signIn, unique, watchErrors } from './helpers';

async function open(browser: Browser, who: string, path: string, phone = false): Promise<{ page: Page; errors: string[] }> {
  const context = await browser.newContext(phone ? { ...devices['iPhone 13'] } : { viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await signIn(page, who, path);
  return { page, errors };
}

test('three people on one board see each other\'s moves, ticks and comments live', async ({ browser, request }) => {
  test.setTimeout(120_000);
  const board = await api(request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Shift handover') });
  const detail = await api(request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const id = (name: string) => detail.people.find((p: { username: string }) => p.username === name).id;
  await api(request, 'carol', 'PUT', `/api/kanban/boards/${board.id}/members`, {
    members: [{ user: id('carol'), role: 'owner' }, { user: id('alice'), role: 'editor' }, { user: id('admin'), role: 'editor' }],
  });
  const [todo, , done] = detail.columns;
  const card = await api(request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: todo.id, title: 'Check the press line' });
  await api(request, 'carol', 'POST', `/api/kanban/cards/${card.id}/checklist`, { text: 'Look at the oil level' });

  const path = `/kanban/b/${board.id}`;
  const carol = await open(browser, 'carol', path);
  const alice = await open(browser, 'alice', path);
  const phone = await open(browser, 'admin', path, true);
  const face = (p: Page) => p.getByTestId('card-face').filter({ hasText: 'Check the press line' });
  for (const p of [carol.page, alice.page, phone.page]) await expect(face(p)).toBeVisible();

  // 1. alice moves the task to Done (no dragging needed)
  await face(alice.page).getByTestId('move-to').click();
  await alice.page.getByTestId('move-to-stage').filter({ hasText: done.name }).click();
  for (const p of [carol.page, phone.page]) {
    await expect(p.locator(`[data-testid="column"][data-column-name="${done.name}"]`).getByTestId('card-face').filter({ hasText: 'Check the press line' })).toBeAttached();
  }
  await expect(carol.page.getByText(/alice moved/i).first()).toBeVisible();

  // 2. on the phone, the step is ticked
  await face(phone.page).click();
  const sheet = phone.page.getByTestId('card-drawer');
  await sheet.getByTestId('checklist-item').filter({ hasText: 'Look at the oil level' }).getByRole('checkbox').check({ force: true });
  await expect(face(carol.page).getByTestId('card-progress')).toContainText('1');

  // 3. carol comments; alice sees it with its author
  await face(carol.page).click();
  const drawer = carol.page.getByTestId('card-drawer');
  await drawer.getByTestId('comment-input').fill('Oil topped up, all good');
  await drawer.getByTestId('comment-send').click();
  await face(alice.page).click();
  const aliceDrawer = alice.page.getByTestId('card-drawer');
  await expect(aliceDrawer.getByTestId('comment').filter({ hasText: 'Oil topped up, all good' })).toContainText('carol');

  // the history says who did what, with times
  await aliceDrawer.getByTestId('history-tab').click();
  const history = aliceDrawer.getByTestId('history');
  await expect(history.getByTestId('history-entry').filter({ hasText: /alice/i }).first()).toBeVisible();
  await expect(history.getByTestId('history-entry').filter({ hasText: /admin/i }).first()).toBeVisible();

  for (const who of [carol, alice, phone]) expect(who.errors).toEqual([]);
});
