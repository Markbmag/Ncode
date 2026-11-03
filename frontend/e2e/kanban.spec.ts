/**
 * Ncode - Kanban (K1): the launcher, a board from scratch, drag and drop and "Move to…", steps, comments,
 * a photo, live updates in a second browser and read-only access for people who are not members.
 */
import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { API, api, expectNoHorizontalScroll, newUser, signIn, token, unique, watchErrors } from './helpers';

// a 2 x 2 red PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGP4z8DAwMDAxMDAwMDAAAANHQEDasKb6QAAAABJRU5ErkJggg==', 'base64');

async function openAs(browser: Browser, who: string, path: string): Promise<{ page: Page; errors: string[]; close: () => Promise<void> }> {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const errors = watchErrors(page);
  await signIn(page, who, path);
  return { page, errors, close: () => context.close() };
}

const column = (page: Page, name: string): Locator => page.locator(`[data-testid="column"][data-column-name="${name}"]`);
const cardIn = (page: Page, columnName: string, title: string): Locator => column(page, columnName).getByTestId('card-face').filter({ hasText: title });

/** Drags with the mouse in small steps, as a person does (the board starts dragging after 5 px). */
async function drag(page: Page, from: Locator, to: Locator): Promise<void> {
  const a = (await from.boundingBox())!;
  const b = (await to.boundingBox())!;
  // take the task by its title (its "Move to…" button neither drags nor opens it)
  await page.mouse.move(a.x + a.width / 2, a.y + 18);
  await page.mouse.down();
  await page.mouse.move(a.x + a.width / 2 + 12, a.y + 24, { steps: 4 });
  await page.mouse.move(b.x + b.width / 2, b.y + 60, { steps: 18 });
  await page.waitForTimeout(150);
  await page.mouse.up();
}

test('the launcher offers both services and remembers the last choice', async ({ page }) => {
  const errors = watchErrors(page);
  const value = await token(page.request, 'carol');
  await page.addInitScript((tok) => {
    if (sessionStorage.getItem('e2e_init')) return;
    sessionStorage.setItem('e2e_init', '1');
    localStorage.setItem('ncode_token', tok);
    localStorage.setItem('ncode_lang', 'en');
    localStorage.removeItem('ncode_service');
  }, value);
  await page.goto('/');
  await expect(page.getByTestId('launcher')).toBeVisible();
  await expect(page.getByTestId('launch-bi')).toContainText('Ncode Search & BI');
  await page.getByTestId('launch-kanban').click();
  await expect(page).toHaveURL(/\/kanban$/);
  await expect(page.getByTestId('kanban-logo')).toContainText('Ncode - Kanban');

  // opening the app again goes straight to the last service
  const again = await page.context().newPage();
  await again.goto('/');
  await expect(again).toHaveURL(/\/kanban$/);
  await expect(again.getByTestId('kanban-shell')).toBeVisible();
  // the switcher leads to Search & BI, which is remembered from then on
  await again.getByTestId('service-switcher').click();
  await again.getByTestId('service-bi').click();
  await expect(again.getByRole('heading', { name: /Hello, carol/ })).toBeVisible();
  const third = await page.context().newPage();
  await third.goto('/');
  await expect(third.getByRole('heading', { name: /Hello, carol/ })).toBeVisible();
  await expect(third.getByTestId('service-switcher').first()).toBeVisible(); // in the BI sidebar too
  expect(errors).toEqual([]);
});

test('a board from scratch: stages, tasks, drag and drop, steps, comment, photo; others see it live', async ({ page, browser }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  await signIn(page, 'carol', '/kanban');
  const name = unique('Line 2 maintenance');

  // create the board
  await page.getByTestId('new-board').click();
  await page.getByTestId('board-name').fill(name);
  await page.getByTestId('create-board').click();
  await expect(page.getByTestId('board-title')).toHaveText(name);
  await expect(page.getByTestId('column')).toHaveCount(3);
  await expect(page.getByTestId('first-steps')).toContainText('How it works'); // an empty board explains itself
  await expect(page.getByTestId('live-state')).toHaveAttribute('data-state', 'live');
  const boardUrl = page.url();
  const boardId = Number(/\/kanban\/b\/(\d+)/.exec(boardUrl)![1]);

  // a stage of our own
  await page.getByTestId('add-column').click();
  await page.getByTestId('new-column-name').fill('Review');
  await page.getByTestId('new-column-save').click();
  await expect(page.getByTestId('column')).toHaveCount(4);

  // tasks go in at the top of a stage
  await column(page, 'To do').getByTestId('column-add-card').click();
  for (const title of ['Order new belts', 'Fix the pump']) { // the box stays open for the next one
    await page.getByTestId('new-card-title').fill(title);
    await page.getByTestId('new-card-save').click();
    await expect(cardIn(page, 'To do', title)).toBeVisible();
  }
  await expect(column(page, 'To do').getByTestId('card-face').first()).toContainText('Fix the pump');
  await expect(page.getByTestId('first-steps')).toHaveCount(0);

  // alice becomes a member
  await page.getByTestId('members-button').click();
  await page.getByTestId('member-pick').selectOption({ label: 'alice' });
  await page.getByTestId('add-member').click();
  await page.getByTestId('save-members').click();
  await expect(page.getByTestId('members-list')).toBeHidden();

  // alice watches the board in her own browser
  const alice = await openAs(browser, 'alice', `/kanban/b/${boardId}`);
  await expect(alice.page.getByTestId('live-state')).toHaveAttribute('data-state', 'live');
  await expect(cardIn(alice.page, 'To do', 'Fix the pump')).toBeVisible();
  await expect(alice.page.getByTestId('read-only')).toHaveCount(0);

  // carol drags the task to In progress; alice sees the move, with who did it
  await drag(page, cardIn(page, 'To do', 'Fix the pump'), column(page, 'In progress'));
  await expect(cardIn(page, 'In progress', 'Fix the pump')).toBeVisible();
  await expect(page.getByTestId('notice').filter({ hasText: 'Moved “Fix the pump” to In progress' })).toBeVisible();
  await expect(cardIn(alice.page, 'In progress', 'Fix the pump')).toBeVisible();
  await expect(alice.page.getByTestId('live-toast').filter({ hasText: 'carol moved “Fix the pump”' })).toBeVisible();
  const moved = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${boardId}`);
  const inProgress = moved.columns.find((c: { name: string }) => c.name === 'In progress');
  expect(moved.cards.find((c: { title: string }) => c.title === 'Fix the pump').column_id).toBe(inProgress.id);

  // the task: steps, comment, photo
  await cardIn(page, 'In progress', 'Fix the pump').click();
  await expect(page).toHaveURL(/\/kanban\/b\/\d+\/c\/\d+/);
  const drawer = page.getByTestId('card-drawer');
  for (const step of ['Drain the tank', 'Replace the seal']) {
    await drawer.getByTestId('new-step').fill(step);
    await drawer.getByTestId('add-step').click();
    await expect(drawer.getByTestId('checklist-item').filter({ hasText: step })).toBeVisible();
  }
  await drawer.getByTestId('checklist-item').filter({ hasText: 'Drain the tank' }).locator('label').first().click();
  await expect(drawer.getByTestId('plan-progress')).toHaveText('1 of 2 steps done');
  await expect(cardIn(page, 'In progress', 'Fix the pump').getByTestId('card-progress')).toHaveText('1 of 2 steps done');
  await expect(cardIn(alice.page, 'In progress', 'Fix the pump').getByTestId('card-progress')).toHaveText('1 of 2 steps done');

  await drawer.getByTestId('comment-input').fill('The seal is **in stock**.');
  await drawer.getByTestId('comment-send').click();
  await expect(drawer.getByTestId('comment').filter({ hasText: 'The seal is in stock.' })).toBeVisible();

  await drawer.getByTestId('file-input').setInputFiles({ name: 'pump.png', mimeType: 'image/png', buffer: PNG });
  await expect(drawer.getByTestId('attachment-thumb')).toHaveCount(1);
  await expect(drawer.getByTestId('attachment-thumb').locator('img')).toBeVisible();
  await expect(drawer.getByTestId('attachment-row').filter({ hasText: 'pump.png' })).toBeVisible();

  // it saved by itself; the history tells who did what
  await expect(drawer.getByTestId('save-state')).toHaveText('Saved');
  await drawer.getByTestId('history-tab').click();
  await expect(drawer.getByTestId('history')).toContainText('carol moved the task from To do to In progress');
  await expect(drawer.getByTestId('history')).toContainText('carol ticked off the step “Drain the tank”');
  await expect(drawer.getByTestId('history')).toContainText('carol attached pump.png');

  // the task's address can be shared: alice opens it
  await alice.page.goto(page.url());
  await expect(alice.page.getByTestId('card-drawer').getByTestId('comment')).toContainText('in stock');
  await expect(alice.page.getByTestId('card-drawer').getByTestId('attachment-thumb').locator('img')).toBeVisible();

  // someone who is not a member sees the board, read only
  const outsider = await newUser(page.request, 'viewer');
  const viewer = await openAs(browser, outsider, `/kanban/b/${boardId}`);
  await expect(viewer.page.getByTestId('read-only')).toBeVisible();
  await expect(cardIn(viewer.page, 'In progress', 'Fix the pump')).toBeVisible();
  await expect(viewer.page.getByTestId('add-column')).toHaveCount(0);
  await expect(viewer.page.getByTestId('column-add-card')).toHaveCount(0);
  await expect(viewer.page.getByTestId('move-to')).toHaveCount(0);
  await cardIn(viewer.page, 'In progress', 'Fix the pump').click();
  await expect(viewer.page.getByTestId('card-drawer').getByTestId('new-step')).toHaveCount(0);
  await expect(viewer.page.getByTestId('card-drawer').getByTestId('comment-input')).toHaveCount(0);
  const refused = await viewer.page.request.post(`${API}/api/kanban/boards/${boardId}/columns`, {
    data: { name: 'Nope' },
    headers: { Authorization: `Bearer ${await token(viewer.page.request, outsider)}` },
  });
  expect(refused.status()).toBe(403);

  expect(errors).toEqual([]);
  expect(alice.errors).toEqual([]);
  expect(viewer.errors).toEqual([]);
  await alice.close();
  await viewer.close();
});

test('filters on a board; hide a board and bring it back', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Filters'), color: 'teal' });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const todo = detail.columns[0].id;
  const alice = detail.people.find((p: { username: string }) => p.username === 'alice').id;
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: todo, title: 'Urgent leak', priority: 'urgent', due_date: '2020-01-01' });
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: todo, title: 'Paint the rails', assignees: [alice] });

  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  await expect(page.getByTestId('card-face')).toHaveCount(2);
  await expect(page.getByTestId('due-chip').first()).toHaveAttribute('data-state', 'overdue');
  await page.getByTestId('filter-overdue').click();
  await expect(page.getByTestId('card-face')).toHaveCount(1);
  await expect(page.getByTestId('card-face')).toContainText('Urgent leak');
  await page.getByTestId('filter-overdue').click();
  await page.getByTestId('filter-more').click();
  await page.getByTestId('filter-person').selectOption({ label: 'alice' });
  await expect(page.getByTestId('card-face')).toHaveCount(1);
  await expect(page.getByTestId('card-face')).toContainText('Paint the rails');
  await page.getByTestId('filter-person').selectOption({ value: '' });
  await page.getByTestId('kanban-search').fill('leak');
  await expect(page.getByTestId('card-face')).toHaveCount(1);
  await page.getByTestId('kanban-search').fill('');

  // hide the board, find it under Hidden boards, bring it back
  await page.getByTestId('board-more').click();
  await page.getByTestId('board-settings').click();
  page.once('dialog', (d) => void d.accept());
  await page.getByTestId('archive-board').click();
  await expect(page).toHaveURL(/\/kanban$/);
  await page.getByTestId('archived-tab').click();
  const row = page.getByTestId('archived-board').filter({ hasText: board.name });
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Bring back' }).click();
  await expect(row).toBeHidden();
  expect(errors).toEqual([]);
});

test('moving without dragging: "Move to…", Undo, and removing a task with Undo', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Move to') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Sweep the floor' });
  await signIn(page, 'carol', `/kanban/b/${board.id}`);

  // the button on the task lists the stages
  await cardIn(page, 'To do', 'Sweep the floor').getByTestId('move-to').click();
  await page.getByTestId('move-to-stage').filter({ hasText: 'Done' }).click();
  await expect(cardIn(page, 'Done', 'Sweep the floor')).toBeVisible();
  await expect(page.getByTestId('card-drawer')).toHaveCount(0); // the button did not open the task
  await expect(page.getByTestId('notice').filter({ hasText: 'Moved “Sweep the floor” to Done' })).toBeVisible();
  await page.getByTestId('notice-undo').click();
  await expect(cardIn(page, 'To do', 'Sweep the floor')).toBeVisible();

  // from the open task as well
  await cardIn(page, 'To do', 'Sweep the floor').click();
  const drawer = page.getByTestId('card-drawer');
  await drawer.getByTestId('card-column').click();
  await page.getByTestId('move-to-stage').filter({ hasText: 'In progress' }).click();
  await expect(drawer.getByTestId('card-column')).toContainText('In progress');
  await expect(cardIn(page, 'In progress', 'Sweep the floor')).toBeAttached();

  // priority as words, due date in plain words
  await drawer.getByTestId('priority-urgent').click();
  await expect(drawer.getByTestId('priority-urgent')).toHaveAttribute('aria-checked', 'true');
  const d = new Date(Date.now() - 3 * 86_400_000);
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  await drawer.getByTestId('card-due').fill(iso);
  await expect(drawer.getByTestId('due-text')).toHaveText('3 days late');

  // removing it from the board can be undone
  await drawer.getByTestId('archive-card').click();
  await expect(page.getByTestId('card-drawer')).toHaveCount(0);
  await expect(page.getByTestId('card-face')).toHaveCount(0);
  await page.getByTestId('notice-undo').click();
  await expect(cardIn(page, 'In progress', 'Sweep the floor')).toBeVisible();
  await expect(cardIn(page, 'In progress', 'Sweep the floor').getByTestId('priority-chip')).toHaveText('Urgent');
  await expect(cardIn(page, 'In progress', 'Sweep the floor').getByTestId('due-chip')).toHaveText('3 days late');
  expect(errors).toEqual([]);
});

test('a board on the phone: stages swipe sideways, a task opens as a full page @phone', async ({ page }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Phone') });
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  await api(page.request, 'carol', 'POST', `/api/kanban/boards/${board.id}/cards`, { column_id: detail.columns[0].id, title: 'Check the gauge' });
  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  await expect(page.getByTestId('card-face')).toHaveCount(1);
  await expectNoHorizontalScroll(page);
  const snap = await page.getByTestId('board-columns').evaluate((el) => getComputedStyle(el).scrollSnapType);
  expect(snap).toContain('x');
  await page.getByTestId('card-face').click();
  const box = (await page.getByTestId('card-drawer').boundingBox())!;
  expect(box.width).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1);
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
