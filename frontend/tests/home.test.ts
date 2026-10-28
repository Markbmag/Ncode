// Run with: npm test
// Home page (M11): the new-user checklist, who can see a shared item, and the grouped menu.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { STEPS, checklistOf, progress, stepInfo, withStep } from '../src/home/steps.ts';
import { audienceOf, questionsToMove, shareTargets } from '../src/library/shareLogic.ts';
import type { ShareCollection } from '../src/library/shareLogic.ts';

describe('new-user checklist', () => {
  test('reads whatever was stored, keeping only known steps in order', () => {
    assert.deepEqual(checklistOf({}), { done: [], hidden: false });
    assert.deepEqual(checklistOf(null), { done: [], hidden: false });
    assert.deepEqual(checklistOf({ checklist: 'yes' }), { done: [], hidden: false });
    assert.deepEqual(
      checklistOf({ checklist: { done: ['save_question', 'fly', 'open_dashboard', 3], hidden: 'true' }, other: 1 }),
      { done: ['open_dashboard', 'save_question'], hidden: false },
    );
    assert.deepEqual(checklistOf({ checklist: { done: [], hidden: true } }), { done: [], hidden: true });
  });

  test('ticking a step keeps the order and says when there is nothing to save', () => {
    const start = { done: [], hidden: false };
    const one = withStep(start, 'ask_question');
    assert.deepEqual(one, { done: ['ask_question'], hidden: false });
    assert.deepEqual(withStep(one!, 'open_dashboard'), { done: ['open_dashboard', 'ask_question'], hidden: false });
    assert.equal(withStep(one!, 'ask_question'), null);
  });

  test('progress: the next step, and gone when done or hidden', () => {
    assert.deepEqual(progress({ done: [], hidden: false }), { visible: true, next: 'open_dashboard', doneCount: 0, total: 5 });
    assert.deepEqual(progress({ done: ['open_dashboard', 'find_record'], hidden: false }), { visible: true, next: 'change_filter', doneCount: 2, total: 5 });
    assert.equal(progress({ done: [...STEPS], hidden: false }).visible, false);
    assert.equal(progress({ done: [...STEPS], hidden: false }).next, null);
    assert.equal(progress({ done: [], hidden: true }).visible, false);
  });

  test('every step says what to do and where', () => {
    for (const id of STEPS) {
      const info = stepInfo(id);
      assert.ok(info.label && info.hint && info.action, id);
      assert.match(info.to, /^\/[a-z]+$/, id);
    }
  });
});

const col = (id: number, extra: Partial<ShareCollection> = {}): ShareCollection => ({
  id, name: `c${id}`, parent_id: null, personal: false, mine: false, archived: false, access: 'edit', can_manage: true, shared: false, ...extra,
});

describe('share dialog', () => {
  const collections = [
    col(1, { personal: true, mine: true, name: 'mine' }),
    col(2, { parent_id: 1, name: 'inside mine' }), // inside a personal collection: private too
    col(3, { shared: true, name: 'Team' }),
    col(4, { parent_id: 3, shared: true, name: 'Team / reports' }),
    col(5, { name: 'Not shared yet' }),
    col(6, { access: 'view', shared: true, can_manage: false, name: 'Read only' }),
    col(7, { archived: true, shared: true, name: 'Old' }),
  ];

  test('who can see an item, by its collection', () => {
    assert.equal(audienceOf(collections, 1), 'private');
    assert.equal(audienceOf(collections, 2), 'private');
    assert.equal(audienceOf(collections, 3), 'shared');
    assert.equal(audienceOf(collections, 4), 'shared');
    assert.equal(audienceOf(collections, 5), 'restricted');
  });

  test('where it can move: editable, open, not private, not where it is', () => {
    assert.deepEqual(shareTargets(collections, 1).map((c) => [c.id, c.depth]), [[3, 0], [4, 1], [5, 0]]);
    assert.deepEqual(shareTargets(collections, 3).map((c) => c.id), [4, 5]);
  });

  test('a dashboard takes along only its questions that are in your collection', () => {
    assert.deepEqual(questionsToMove([10, null, 11, 10, undefined, 12], [10, 12, 99]), [10, 12]);
    assert.deepEqual(questionsToMove([], [1]), []);
  });
});

describe('menu', () => {
  const nav = readFileSync('src/shell/nav.ts', 'utf8');
  const routes = readFileSync('src/routes.tsx', 'utf8');

  test('every main page of the app is in the menu', () => {
    const inMenu = new Set([...nav.matchAll(/\bto: '([^']+)'/g)].map((m) => m[1]));
    // top-level pages: no parameters, not the index or the catch-all (sub-pages are reached from their section)
    const pages = [...routes.matchAll(/<Route path="([a-z-]+)"/g)].map((m) => `/${m[1]}`).filter((p) => !['/xray'].includes(p));
    assert.ok(pages.length >= 10, `only ${pages.length} pages found`);
    for (const page of pages) assert.ok(inMenu.has(page), `${page} is not in the menu`);
    assert.ok(inMenu.has('/'), 'Home');
  });

  test('menu entries are unique and grouped', () => {
    const paths = [...nav.matchAll(/\bto: '([^']+)'/g)].map((m) => m[1]);
    assert.equal(new Set(paths).size, paths.length);
    assert.ok((nav.match(/\bid: '/g) ?? []).length >= 4, 'at least four groups');
  });
});
