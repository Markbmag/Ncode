/**
 * Undo / redo of a draft as a whole (M12), with Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y.
 * Text boxes and the SQL editor keep their own text undo while they have the focus; so do dialogs.
 * The steps themselves are src/query/history.ts.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { canRedo, canUndo, editsText, historyKey, record, redo, startHistory, undo } from './history';
import type { History } from './history';

class HistoryStore<T> {
  private h: History<T>;
  private listeners = new Set<() => void>();
  constructor(present: T) {
    this.h = startHistory(present);
  }
  get = () => this.h;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  set(next: History<T>) {
    if (next === this.h) return;
    this.h = next;
    this.listeners.forEach((l) => l());
  }
}

export interface DraftHistory {
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** goes up with each undo / redo: editors that keep their own copy of a value remount with it */
  revision: number;
}

/** `value` is the whole draft (JSON-like); `apply` puts an earlier one back. */
export function useDraftHistory<T>(value: T, apply: (value: T) => void): DraftHistory {
  const [store] = useState(() => new HistoryStore<T>(value));
  const [revision, setRevision] = useState(0);
  const json = JSON.stringify(value);
  useEffect(() => store.set(record(store.get(), JSON.parse(json) as T, Date.now())), [store, json]);
  const h = useSyncExternalStore(store.subscribe, store.get);
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  const move = useCallback(
    (step: (h: History<T>) => History<T>) => {
      const before = store.get();
      const after = step(before);
      if (after === before) return;
      store.set(after);
      setRevision((r) => r + 1);
      applyRef.current(after.present);
    },
    [store],
  );
  const doUndo = useCallback(() => move(undo), [move]);
  const doRedo = useCallback(() => move(redo), [move]);

  useUndoKeys(doUndo, doRedo);

  return { undo: doUndo, redo: doRedo, canUndo: canUndo(h), canRedo: canRedo(h), revision };
}

/** Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z / Ctrl+Y on the page (not in text boxes, the SQL editor or dialogs). */
export function useUndoKeys(onUndo: () => void, onRedo: () => void, enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      const what = historyKey(e);
      if (!what || e.defaultPrevented) return;
      const target = e.target instanceof HTMLElement ? e.target : null;
      if (editsText(target) || target?.closest('[role="dialog"], [role="alertdialog"], .cm-editor')) return;
      e.preventDefault();
      if (what === 'undo') onUndo();
      else onRedo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onUndo, onRedo, enabled]);
}
