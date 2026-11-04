// K2: Ncode - Kanban on a phone, and the home-screen app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { photoTaskTitle, shouldShrink, shrunkName, stageInView, tabColumn, tabKey } from '../src/kanban/logic.ts';
import { identityOf } from '../src/pwa/identity.ts';

test('the stage in view is the column nearest the middle of the screen', () => {
  const cols = [0, 1, 2].map((i) => ({ left: 24 + i * 354, width: 342 })); // 390 px phone, 342 px columns, 12 px gap
  assert.equal(stageInView(0, 390, cols), 0);
  assert.equal(stageInView(354, 390, cols), 1);
  assert.equal(stageInView(700, 390, cols), 2);
  assert.equal(stageInView(170, 390, cols), 0); // not yet half way
  assert.equal(stageInView(190, 390, cols), 1);
  assert.equal(stageInView(0, 390, []), 0);
});

test('stage tabs are drop targets of their own', () => {
  assert.equal(tabColumn(tabKey(12)), 12);
  assert.equal(tabColumn('col12'), null);
  assert.equal(tabColumn('c12'), null);
  assert.equal(tabColumn('tab'), null);
});

test('big phone photos are made smaller, other files are not', () => {
  assert.equal(shouldShrink('image/jpeg', 4_000_000), true);
  assert.equal(shouldShrink('image/png', 2_000_000), true);
  assert.equal(shouldShrink('image/jpeg', 900_000), false); // small enough already
  assert.equal(shouldShrink('image/heic', 4_000_000), false); // not every browser can read it
  assert.equal(shouldShrink('application/pdf', 9_000_000), false);
  assert.equal(shrunkName('IMG_0042.HEIC.png'), 'IMG_0042.HEIC.jpg');
  assert.equal(shrunkName('IMG_0042.jpeg'), 'IMG_0042.jpg');
  assert.equal(shrunkName(''), 'photo.jpg');
});

test('a task made from a photo is named after the time', () => {
  assert.equal(photoTaskTitle(new Date(2026, 10, 4, 7, 5), 'Photo'), 'Photo 07:05');
  assert.equal(photoTaskTitle(new Date(2026, 10, 4, 14, 30), 'Фото'), 'Фото 14:30');
});

test('Kanban and Search & BI are two home-screen apps', () => {
  const kanban = identityOf('kanban');
  const bi = identityOf('bi');
  assert.equal(kanban.manifest, '/kanban.webmanifest');
  assert.equal(bi.manifest, '/manifest.webmanifest');
  for (const id of [kanban, bi]) {
    const manifest = JSON.parse(readFileSync(`public${id.manifest}`, 'utf8')) as { start_url: string; display: string; icons: { src: string; sizes: string; purpose: string }[] };
    assert.equal(manifest.display, 'standalone');
    assert.ok(existsSync(`public${id.icon}`), id.icon);
    for (const icon of manifest.icons) assert.ok(existsSync(`public${icon.src}`), icon.src);
    assert.deepEqual([...new Set(manifest.icons.map((i) => i.sizes))].sort(), ['192x192', '512x512']);
    assert.ok(manifest.icons.some((i) => i.purpose === 'maskable'));
  }
  assert.equal((JSON.parse(readFileSync('public/kanban.webmanifest', 'utf8')) as { start_url: string }).start_url, '/kanban');
  const html = readFileSync('index.html', 'utf8');
  for (const tag of ['data-pwa="manifest"', 'data-pwa="icon"', 'data-pwa="title"', 'apple-mobile-web-app-capable']) assert.ok(html.includes(tag), tag);
});

// The service worker as the phone runs it, with a pretend browser around it: no network, and the
// app page saved from an earlier visit.
function loadWorker() {
  const handlers: Record<string, (event: unknown) => void> = {};
  const self = { location: { origin: 'https://ncode.example' }, addEventListener: (type: string, fn: (event: unknown) => void) => (handlers[type] = fn) };
  const saved = new Map<string, unknown>([['/', 'the saved app page']]);
  const cache = { match: async (key: unknown) => saved.get(typeof key === 'string' ? key : (key as { url: string }).url), put: async () => undefined, keys: async () => [], delete: async () => true };
  const caches = { open: async () => cache, keys: async () => [], delete: async () => true };
  runInNewContext(readFileSync('public/sw.js', 'utf8'), { self, caches, fetch: () => Promise.reject(new Error('offline')), URL, Response, setTimeout, Promise });
  return async (url: string, init: { method?: string; mode?: string } = {}) => {
    let answer: Promise<unknown> | null = null;
    handlers.fetch({ request: { url, method: init.method ?? 'GET', mode: init.mode ?? 'cors' }, respondWith: (p: Promise<unknown>) => (answer = p) });
    return answer === null ? null : await (answer as Promise<unknown>).catch((e: Error) => `failed: ${e.message}`);
  };
}

test('the service worker keeps the app, never the data', async () => {
  const fetchVia = loadWorker();
  // without a connection a page address still opens the app
  assert.equal(await fetchVia('https://ncode.example/kanban/b/3', { mode: 'navigate' }), 'the saved app page');
  assert.notEqual(await fetchVia('https://ncode.example/assets/index-abc123.js'), null);
  assert.notEqual(await fetchVia('https://ncode.example/icons/kanban-192.png'), null);
  assert.notEqual(await fetchVia('https://ncode.example/kanban.webmanifest'), null);
  // data and live updates always come from the server: the worker does not answer
  for (const url of ['https://ncode.example/api/kanban/boards', 'https://ncode.example/api/kanban/attachments/4', 'https://ncode.example/ws/kanban/3', 'https://fonts.googleapis.com/css2?family=Inter']) {
    assert.equal(await fetchVia(url), null, url);
  }
  assert.equal(await fetchVia('https://ncode.example/assets/x.js', { method: 'POST' }), null);
});
