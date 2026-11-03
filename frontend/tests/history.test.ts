// Undo / redo of the builder and SQL editor drafts (M12): src/query/history.ts
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
  HISTORY_LIMIT, canRedo, canUndo, changedPart, changedPaths, editsText, historyKey, record, redo, startHistory, undo,
} from '../src/query/history.ts';

type Draft = { sql: string; limit: number; viz: { mode: string } };
const base: Draft = { sql: 'SELECT 1', limit: 2000, viz: { mode: 'table' } };

describe('draft history', () => {
  test('undo and redo walk through the recorded drafts', () => {
    let h = startHistory(base);
    assert.equal(canUndo(h), false);
    h = record(h, { ...base, limit: 100 }, 1000);
    h = record(h, { ...base, limit: 100, viz: { mode: 'chart' } }, 5000);
    assert.equal(h.past.length, 2);
    h = undo(h);
    assert.deepEqual(h.present, { ...base, limit: 100 });
    h = undo(h);
    assert.deepEqual(h.present, base);
    assert.equal(canUndo(h), false);
    assert.equal(undo(h), h, 'nothing more to undo');
    h = redo(h);
    assert.deepEqual(h.present, { ...base, limit: 100 });
    assert.equal(canRedo(h), true);
    h = redo(h);
    assert.equal(canRedo(h), false);
    assert.deepEqual(h.present.viz, { mode: 'chart' });
  });

  test('an undo coming back as the new draft records nothing, and a new change drops the redo steps', () => {
    let h = record(startHistory(base), { ...base, sql: 'SELECT 2' }, 1000);
    h = undo(h);
    const same = record(h, { ...base }, 1100); // the page re-renders with the undone draft
    assert.equal(same, h);
    assert.equal(canRedo(same), true);
    const changed = record(h, { ...base, limit: 10 }, 1200);
    assert.equal(canRedo(changed), false);
    assert.equal(changed.past.length, 1);
  });

  test('typing quickly in one place is one step, a pause or another place starts a new one', () => {
    let h = startHistory(base);
    let at = 10_000;
    for (const sql of ['SELECT 1 ', 'SELECT 1 +', 'SELECT 1 + 2']) h = record(h, { ...base, sql }, (at += 200));
    assert.equal(h.past.length, 1, 'three key strokes, one step');
    assert.equal(h.present.sql, 'SELECT 1 + 2');
    h = record(h, { ...h.present, sql: 'SELECT 1 + 23' }, (at += 3000)); // after a pause
    assert.equal(h.past.length, 2);
    h = record(h, { ...h.present, limit: 10 }, at + 100); // another field right away
    assert.equal(h.past.length, 3);
    assert.deepEqual(undo(undo(h)).present.sql, 'SELECT 1 + 2');
    assert.deepEqual(undo(undo(undo(h))).present, base);
  });

  test('picking a filter column and then typing its value are two steps', () => {
    const rule = (ref: string, value: string) => ({ spec: { filters: { op: 'and', rules: [{ ref, op: '=', value }] } } });
    let h = record(startHistory(rule('', '')), rule('status', ''), 1000);
    for (const [i, value] of ['p', 'pa', 'paid'].entries()) h = record(h, rule('status', value), 1100 + i * 100);
    assert.equal(h.past.length, 2);
    assert.deepEqual(undo(h).present, rule('status', ''));
  });

  test('right after an undo, typing in the same place is a new step', () => {
    let h = record(startHistory(base), { ...base, sql: 'SELECT 12' }, 1000);
    h = record(undo(h), { ...base, sql: 'SELECT 13' }, 1100);
    assert.equal(h.past.length, 1);
    assert.deepEqual(undo(h).present, base);
  });

  test('the history is bounded: the oldest steps go first', () => {
    let h = startHistory(0);
    for (let i = 1; i <= HISTORY_LIMIT + 20; i++) h = record(h, i, i * 10_000);
    assert.equal(h.past.length, HISTORY_LIMIT);
    assert.equal(h.past[0], 20);
    assert.equal(record(startHistory(0), 1, 0, 3).past.length, 1);
  });

  test('which part of the draft a change touched', () => {
    const spec = { source: { table: 'orders' }, filters: { op: 'and', rules: [{ ref: 'status', op: '=', value: 'pa' }] } };
    const typed = { ...spec, filters: { op: 'and', rules: [{ ref: 'status', op: '=', value: 'paid' }] } };
    assert.deepEqual(changedPaths({ spec }, { spec: typed }), ['spec.filters.rules.0.value']);
    assert.equal(changedPart(changedPaths({ spec }, { spec: typed })), 'spec.filters.rules.0.value');
    assert.equal(changedPart(['spec.filters.rules.0.value.1']), 'spec.filters.rules.0.value', 'typing a list of values');
    assert.equal(changedPart(['spec.filters.rules.0.ref', 'spec.filters.rules.0.value']), 'spec.filters.rules.0');
    assert.deepEqual(changedPaths([1, 2], [1, 2, 3]), ['']);
    assert.deepEqual(changedPaths({ a: 1 }, { a: 1, b: null }), ['b']);
    assert.deepEqual(changedPaths(null, { a: 1 }), ['']);
    assert.equal(changedPart(['spec.aggregations', 'spec.breakouts']), 'spec');
  });
});

describe('undo keys', () => {
  const key = (k: Partial<Parameters<typeof historyKey>[0]>) => historyKey({ key: '', ctrlKey: false, metaKey: false, shiftKey: false, ...k });
  test('Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z and Ctrl+Y', () => {
    assert.equal(key({ key: 'z', ctrlKey: true }), 'undo');
    assert.equal(key({ key: 'z', metaKey: true }), 'undo');
    assert.equal(key({ key: 'Z', ctrlKey: true, shiftKey: true }), 'redo');
    assert.equal(key({ key: 'z', metaKey: true, shiftKey: true }), 'redo');
    assert.equal(key({ key: 'y', ctrlKey: true }), 'redo');
    assert.equal(key({ key: 'я', code: 'KeyZ', ctrlKey: true }), 'undo', 'Russian keyboard layout');
    assert.equal(key({ key: 'z' }), null);
    assert.equal(key({ key: 'z', ctrlKey: true, altKey: true }), null);
    assert.equal(key({ key: 'Enter', ctrlKey: true }), null);
  });

  test('text boxes and the SQL editor keep their own text undo', () => {
    assert.equal(editsText({ tagName: 'INPUT', type: 'text' }), true);
    assert.equal(editsText({ tagName: 'INPUT', type: 'number' }), true);
    assert.equal(editsText({ tagName: 'TEXTAREA' }), true);
    assert.equal(editsText({ tagName: 'DIV', isContentEditable: true }), true, 'CodeMirror');
    assert.equal(editsText({ tagName: 'INPUT', type: 'checkbox' }), false);
    assert.equal(editsText({ tagName: 'SELECT' }), false);
    assert.equal(editsText({ tagName: 'BUTTON' }), false);
    assert.equal(editsText(null), false);
  });
});
