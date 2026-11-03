/**
 * Undo / redo for the builder and SQL editor drafts (M12): a bounded list of whole draft states
 * (the query, its parameters and chart settings). Quick changes to the same value - typing in one
 * box - become one step. Pure, tested in tests/history.test.ts.
 */

export interface History<T> {
  past: T[]; // oldest first
  present: T;
  future: T[]; // the next redo first
  /** when the present was recorded and which part changed: a change to the same part soon after joins that step */
  at: number;
  part: string | null;
}

export const HISTORY_LIMIT = 100;
export const COALESCE_MS = 1000;

export function startHistory<T>(present: T): History<T> {
  return { past: [], present, future: [], at: 0, part: null };
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Where two JSON-like values differ ("spec.filters.rules.0.value"); a list that grew or shrank counts as itself. */
export function changedPaths(a: unknown, b: unknown, path = ''): string[] {
  if (a === b) return [];
  const at = (key: string | number) => (path ? `${path}.${key}` : String(key));
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return [path];
    return a.flatMap((x, i) => changedPaths(x, b[i], at(i)));
  }
  if (isObject(a) && isObject(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    return keys.flatMap((k) => changedPaths(a[k], b[k], at(k)));
  }
  return [path];
}

/** The part of the draft a change touched: the common start of its paths (a list of plain values counts as one value). */
export function changedPart(paths: string[]): string {
  const split = paths.map((p) => {
    const parts = p ? p.split('.') : [];
    while (parts.length && /^\d+$/.test(parts[parts.length - 1])) parts.pop();
    return parts;
  });
  const common: string[] = [];
  for (let i = 0; ; i++) {
    const head = split[0]?.[i];
    if (head === undefined || split.some((s) => s[i] !== head)) break;
    common.push(head);
  }
  return common.join('.');
}

/**
 * The draft after a change. Nothing happens when nothing changed (an undo being applied comes back
 * here as "no change"); a change to the same part within `coalesceMs` of the last one replaces it.
 */
export function record<T>(h: History<T>, next: T, now: number, limit = HISTORY_LIMIT, coalesceMs = COALESCE_MS): History<T> {
  const paths = changedPaths(h.present, next);
  if (paths.length === 0) return h;
  const part = changedPart(paths);
  if (h.part !== null && h.part === part && now - h.at < coalesceMs) return { ...h, present: next, future: [], at: now };
  return { past: [...h.past, h.present].slice(-limit), present: next, future: [], at: now, part };
}

export const canUndo = (h: History<unknown>): boolean => h.past.length > 0;
export const canRedo = (h: History<unknown>): boolean => h.future.length > 0;

export function undo<T>(h: History<T>): History<T> {
  if (!canUndo(h)) return h;
  return { past: h.past.slice(0, -1), present: h.past[h.past.length - 1], future: [h.present, ...h.future], at: 0, part: null };
}

export function redo<T>(h: History<T>): History<T> {
  if (!canRedo(h)) return h;
  return { past: [...h.past, h.present], present: h.future[0], future: h.future.slice(1), at: 0, part: null };
}

export interface KeyLike {
  key: string;
  code?: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/** Ctrl/Cmd+Z undoes; Ctrl/Cmd+Shift+Z and Ctrl+Y redo (by key position too, so a Russian layout works). */
export function historyKey(e: KeyLike): 'undo' | 'redo' | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const key = e.code === 'KeyZ' ? 'z' : e.code === 'KeyY' ? 'y' : e.key.toLowerCase();
  if (key === 'z') return e.shiftKey ? 'redo' : 'undo';
  if (key === 'y' && e.ctrlKey && !e.shiftKey) return 'redo';
  return null;
}

const NOT_TEXT = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file', 'image']);

/** A text box (or the SQL editor) keeps its own Ctrl+Z for the text typed in it. */
export function editsText(el: { tagName: string; type?: string; isContentEditable?: boolean } | null): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea') return true;
  return tag === 'input' && !NOT_TEXT.has((el.type ?? 'text').toLowerCase());
}
