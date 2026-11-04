// History of questions and dashboards (M15): src/library/versions.ts; undo while editing a dashboard: amend() in src/query/history.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { cardLabel, previewBoxes, restoreNotes, savedLine } from '../src/library/versions.ts';
import type { DashboardVersionData, QuestionVersionData, VersionCard } from '../src/library/versions.ts';
import { amend, record, redo, startHistory, undo } from '../src/query/history.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const card = (key: string, extra: Partial<VersionCard> = {}): VersionCard => ({ key, kind: 'question', layout: { x: 0, y: 0, w: 6, h: 4 }, ...extra });

describe('dashboard versions in words', () => {
  test('cards say what they showed', () => {
    setLangForTests('en');
    const questions = { '7': { state: 'ok' as const, id: 7, name: 'Scrap by line', kind: 'builder' }, '8': { state: 'hidden' as const, id: null, name: null, kind: null } };
    assert.equal(cardLabel(card('a', { question_id: 7 }), questions), 'Scrap by line');
    assert.equal(cardLabel(card('a', { question_id: 7, title: 'Scrap' }), questions), 'Scrap');
    assert.equal(cardLabel(card('a', { question_id: 8 }), questions), 'A question that is not shared with you');
    assert.equal(cardLabel(card('a', { question_id: null }), questions), 'A question that was deleted');
    assert.equal(cardLabel(card('t', { kind: 'text', text: '\n## **Morning** notes\nmore' })), 'Morning notes');
    assert.equal(cardLabel(card('h', { kind: 'heading', text: 'Line 3' })), 'Line 3');
    assert.equal(cardLabel(card('h', { kind: 'heading', text: '' })), 'Heading');
  });

  test('the layout picture follows the grid, tab by tab', () => {
    const data: Pick<DashboardVersionData, 'cards' | 'tabs'> = {
      tabs: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }],
      cards: [
        card('b', { tab: 't1', layout: { x: 6, y: 0, w: 6, h: 4 } }),
        card('a', { tab: 't1', layout: { x: 0, y: 0, w: 6, h: 2 } }),
        card('c', { tab: 't2', layout: { x: 0, y: 3, w: 12, h: 5 } }),
      ],
    };
    const one = previewBoxes(data, 't1');
    assert.deepEqual(one.boxes.map((b) => [b.key, b.left, b.width]), [['a', 0, 50], ['b', 50, 50]]);
    assert.equal(one.rows, 4);
    assert.equal(previewBoxes(data, 't2').rows, 8);
    assert.deepEqual(previewBoxes({ tabs: [], cards: data.cards }, null).boxes.length, 3);
  });

  test('who and when; the Verified note only when the query differs', () => {
    setLangForTests('en');
    const at = new Date(2026, 10, 3, 14, 5).getTime() / 1000;
    assert.equal(savedLine({ saved_by: 'alice', saved_at: at }), 'alice · 3 Nov 2026 14:05');
    assert.equal(savedLine({ saved_by: null, saved_at: at }), '3 Nov 2026 14:05');
    const old: QuestionVersionData = { name: 'Q', description: null, kind: 'sql', connection: 'shop', spec: { sql: 'SELECT 1' }, viz: null, parameters: [] };
    const verified = { by: 'admin', at: 1 };
    assert.deepEqual(restoreNotes({ ...old, verified }, { ...old, viz: { mode: 'table' } }), []);
    assert.equal(restoreNotes({ ...old, verified }, { ...old, spec: { sql: 'SELECT 2' } }).length, 1);
    assert.deepEqual(restoreNotes({ ...old, verified: null }, { ...old, spec: { sql: 'SELECT 2' } }), []);
    setLangForTests('ru');
    assert.equal(cardLabel(card('a', { question_id: null })), 'Удалённый вопрос');
    setLangForTests('en');
  });
});

describe('undo while editing a dashboard', () => {
  type Def = { cards: { key: string; y: number }[] };
  test('the grid tidying up after a removal joins the removal', () => {
    let h = startHistory<Def>({ cards: [{ key: 'a', y: 0 }, { key: 'b', y: 4 }] });
    h = record(h, { cards: [{ key: 'b', y: 4 }] }, 1000, 100, 0); // remove a
    h = amend(h, { cards: [{ key: 'b', y: 0 }] }); // b moves up by itself
    assert.equal(h.past.length, 1);
    h = undo(h);
    assert.deepEqual(h.present, { cards: [{ key: 'a', y: 0 }, { key: 'b', y: 4 }] });
    assert.equal(amend(h, h.present), h); // the grid answering the undo with the same layout: nothing happens
    h = redo(h);
    assert.deepEqual(h.present, { cards: [{ key: 'b', y: 0 }] });
  });

  test('separate clicks stay separate steps', () => {
    let h = startHistory<Def>({ cards: [{ key: 'a', y: 0 }, { key: 'b', y: 4 }, { key: 'c', y: 8 }] });
    h = record(h, { cards: [{ key: 'b', y: 4 }, { key: 'c', y: 8 }] }, 1000, 100, 0);
    h = record(h, { cards: [{ key: 'c', y: 8 }] }, 1100, 100, 0);
    assert.equal(h.past.length, 2);
  });
});
