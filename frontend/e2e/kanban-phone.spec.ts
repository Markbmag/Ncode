// K2 "done when": on an iPhone, a task is created from a photo, named, moved, its step ticked off and
// moved to Done, all with fingers and without zooming. (Chromium with the iPhone's screen and touch.)
import { devices, expect, test } from '@playwright/test';
import type { CDPSession, Page } from '@playwright/test';
import { api, expectNoHorizontalScroll, signIn, unique, watchErrors } from './helpers';

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- the browser is the project's (Chromium)
const { defaultBrowserType: _browser, ...iPhone } = devices['iPhone 13'];
test.use(iPhone);

// a small photo as the iPhone's camera would hand it over
const PHOTO = { name: 'IMG_0042.jpg', mimeType: 'image/jpeg', buffer: Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCABIAGADASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDiKKKK9U4QooooAKKKKACiiigAooooAKKKKACiiigDT0XSv7T87995Xl7f4d2c59x6Vp/8It/0+f8AkL/69Hgv/l8/4B/7NXTV8bmua4vD4udKlOyVui7LyPsMryvC4jCwqVIXbv1fd+ZzP/CLf9Pn/kL/AOvR/wAIt/0+f+Qv/r101Fef/bmO/wCfn4L/ACPQ/sTA/wDPv8X/AJnM/wDCLf8AT5/5C/8Ar0f8It/0+f8AkL/69dNRR/bmO/5+fgv8g/sTA/8APv8AF/5nK3XhvyLaab7Xu8tC+PLxnAz61zteh6p/yDLv/ri//oJrzyvpcixlbF05yrSu0+yX5HzeeYOjhakI0Y2TXn+oUUUV7p4YUUUUAdN4L/5fP+Af+zV01cz4L/5fP+Af+zV01fnuef79U+X5I/QMk/3Gn8/zYUUUV5J6oUUUUAVtU/5Bl3/1xf8A9BNeeV6Hqn/IMu/+uL/+gmvPK+x4Z/hVPX9D4/iX+LD0/UKKKK+nPmgooooAv6Zqc2neb5Cxt5mM7wT0z6H3q9/wk15/zyt/++W/xrCoriq5fhq03UqQTbOylmGJowUKc2kjd/4Sa8/55W//AHy3+NH/AAk15/zyt/8Avlv8awqKz/snB/8APtGn9q4z/n4zd/4Sa8/55W//AHy3+NH/AAk15/zyt/8Avlv8awqKP7Jwf/PtB/auM/5+M2Z/EN3PBJE8cAWRSpIU5wRj1rGoorpoYWlh01Sja5zV8TVxDTqyvYKKKK6DAKKKKACiiigAooooAKKKKACiiigAooooA//Z', 'base64') };

async function hold(cdp: CDPSession, page: Page, testId: string, text: string, to?: { x: number; y: number }) {
  const box = (await page.getByTestId(testId).filter({ hasText: text }).boundingBox())!;
  const from = { x: box.x + 60, y: box.y + 20 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [from] });
  await page.waitForTimeout(500); // longer than the 250 ms that picks a task up
  if (to) {
    for (let i = 1; i <= 12; i++) {
      const p = { x: from.x + ((to.x - from.x) * i) / 12, y: from.y + ((to.y - from.y) * i) / 12 };
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [p] });
      await page.waitForTimeout(30);
    }
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function fontSize(page: Page, testId: string) {
  return page.getByTestId(testId).evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
}

test('on an iPhone: a task from a photo, moved, ticked off and done @phone', async ({ page, context }) => {
  const errors = watchErrors(page);
  const board = await api(page.request, 'carol', 'POST', '/api/kanban/boards', { name: unique('Press line') });
  await signIn(page, 'carol', `/kanban/b/${board.id}`);
  const cdp = await context.newCDPSession(page);

  // the phone gets the Kanban app for its home screen
  await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/kanban.webmanifest');
  await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icons/kanban-180.png');

  // every stage is a tab; one stage on the screen at a time
  await expect(page.getByTestId('stage-tab')).toHaveText([/To do\s*0/, /In progress\s*0/, /Done\s*0/]);
  await expect(page.getByTestId('stage-tab').first()).toHaveAttribute('data-active', 'true');
  await expectNoHorizontalScroll(page);

  // 1. a photo becomes a task; the name is ready to be typed over
  await page.getByTestId('column-photo-input').first().setInputFiles(PHOTO);
  await expect(page.getByTestId('name-it-hint')).toBeVisible();
  const drawer = page.getByTestId('card-drawer');
  await expect(drawer.getByTestId('attachment-thumb').first()).toBeVisible();
  await expect(drawer.getByTestId('card-title')).toBeFocused();
  expect(await fontSize(page, 'card-title')).toBeGreaterThanOrEqual(16); // iPhones zoom into smaller text fields
  await drawer.getByTestId('card-title').fill('Oil leak under press 2');
  await drawer.getByTestId('card-title').press('Enter');
  await expect(drawer.getByTestId('save-state')).toContainText(/saved/i);

  // a step of the plan
  expect(await fontSize(page, 'new-step')).toBeGreaterThanOrEqual(16);
  await drawer.getByTestId('new-step').fill('Tighten the hose clamp');
  await drawer.getByTestId('add-step').tap();
  await expect(drawer.getByTestId('checklist-item')).toHaveCount(1);
  await drawer.getByTestId('card-close').tap();
  await expect(page.getByTestId('card-drawer')).toHaveCount(0);
  expect(new URL(page.url()).search).not.toContain('name=1'); // only the new task asks for its name
  await expect(page.getByTestId('card-face').filter({ hasText: 'Oil leak under press 2' })).toBeVisible();

  // 2. press and hold, let go: big buttons for the next stage
  await hold(cdp, page, 'card-face', 'Oil leak under press 2');
  await expect(page.getByTestId('move-sheet')).toBeVisible();
  await page.getByTestId('move-sheet-stage').filter({ hasText: 'In progress' }).tap();
  await expect(page.getByTestId('notice').filter({ hasText: 'Moved “Oil leak under press 2” to In progress' })).toBeVisible();
  await expect(page.getByTestId('stage-tab').filter({ hasText: 'In progress' })).toHaveAttribute('data-active', 'true');

  // 3. tick the step off
  await page.getByTestId('card-face').filter({ hasText: 'Oil leak under press 2' }).tap();
  await expect(page.getByTestId('name-it-hint')).toHaveCount(0);
  await page.getByTestId('checklist-item').locator('.chakra-checkbox__control').tap();
  await expect(page.getByTestId('plan-progress')).toContainText('1 of 1');
  await page.getByTestId('card-close').tap();

  // 4. hold it and drop it on the Done tab
  const done = (await page.getByTestId('stage-tab').filter({ hasText: 'Done' }).boundingBox())!;
  await hold(cdp, page, 'card-face', 'Oil leak under press 2', { x: done.x + 30, y: done.y + done.height / 2 });
  await expect(page.getByTestId('stage-tab').filter({ hasText: 'Done' })).toHaveAttribute('data-active', 'true');
  await expect(page.getByTestId('stage-tab')).toHaveText([/To do\s*0/, /In progress\s*0/, /Done\s*1/]);

  // what the server has: in Done, the step ticked, the photo with its preview
  const detail = await api(page.request, 'carol', 'GET', `/api/kanban/boards/${board.id}`);
  const doneColumn = detail.columns.find((c: { is_done: boolean }) => c.is_done);
  const card = detail.cards.find((c: { title: string }) => c.title === 'Oil leak under press 2');
  expect(card.column_id).toBe(doneColumn.id);
  const full = await api(page.request, 'carol', 'GET', `/api/kanban/cards/${card.id}`);
  expect(full.checklist_items.map((i: { done: boolean }) => i.done)).toEqual([true]);
  expect(full.attachments_list).toHaveLength(1);
  expect(full.attachments_list[0].thumb_url).toBeTruthy();
  await expectNoHorizontalScroll(page);
  expect(errors).toEqual([]);
});
