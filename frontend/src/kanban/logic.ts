/**
 * Ncode - Kanban: the pure parts (no React), tested in tests/kanban.test.ts.
 * Positions between neighbours, filters, progress, due dates, colours and readable history.
 */
import { locale, t, tn } from '../i18n/index.ts';
import type { BoardEvent, CardSummary, Column, GroupRef, HistoryEntry, Label, Person, Priority, Repeat, UserRef } from './types.ts';

// ---------------------------------------------------------------- positions

export const POSITION_STEP = 1024;

/** A position between two neighbours (either may be missing: top / bottom / empty column). */
export function positionBetween(before: number | null | undefined, after: number | null | undefined): number {
  const hasBefore = before !== null && before !== undefined;
  const hasAfter = after !== null && after !== undefined;
  if (hasBefore && hasAfter) return (before + after) / 2;
  if (hasBefore) return before + POSITION_STEP;
  if (hasAfter) return after - POSITION_STEP;
  return POSITION_STEP;
}

/**
 * The position for a card dropped at `index` of a column's cards (sorted, top first). The moving
 * card itself is left out, so moving it down by one in its own column works too.
 */
export function positionAt(sorted: { id: number; position: number }[], index: number, movingId?: number): number {
  const others = sorted.filter((c) => c.id !== movingId);
  const i = Math.max(0, Math.min(index, others.length));
  return positionBetween(others[i - 1]?.position, others[i]?.position);
}

export const byPosition = <T extends { position: number; id: number }>(a: T, b: T): number => a.position - b.position || a.id - b.id;

/** Cards per column id, each list sorted top first. */
export function cardsByColumn<T extends CardSummary>(cards: T[], columns: Column[]): Map<number, T[]> {
  const out = new Map<number, T[]>(columns.map((c) => [c.id, []]));
  for (const card of cards) out.get(card.column_id)?.push(card);
  for (const list of out.values()) list.sort(byPosition);
  return out;
}

/** The cards after a move, as the server will have them (for showing a move before it answers). */
export function applyMove<T extends CardSummary>(cards: T[], cardId: number, columnId: number, position: number, doneColumns: Set<number> = new Set()): T[] {
  return cards.map((c) => {
    if (c.id !== cardId) return c;
    const done = doneColumns.has(columnId);
    const completed_at = done ? (c.completed_at ?? Date.now() / 1000) : null;
    return { ...c, column_id: columnId, position, completed_at };
  });
}

// ---------------------------------------------------------------- dates

/** Today as "2026-11-03" in the browser's time zone. */
export function todayIso(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

const dayNumber = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};

export type DueState = 'overdue' | 'today' | 'soon' | 'later' | 'done';

/** How urgent a due date is: overdue (red), today, soon (within two days), later; done cards are calm. */
export function dueState(due: string | null | undefined, today: string, done = false): DueState | null {
  if (!due) return null;
  if (done) return 'done';
  const diff = dayNumber(due) - dayNumber(today);
  if (diff < 0) return 'overdue';
  if (diff === 0) return 'today';
  if (diff <= 2) return 'soon';
  return 'later';
}

export function isCardDone(card: Pick<CardSummary, 'column_id' | 'completed_at'>, doneColumns: Set<number>): boolean {
  return doneColumns.has(card.column_id) || (card.completed_at !== null && card.completed_at !== undefined);
}

export function isOverdue(card: Pick<CardSummary, 'due_date' | 'column_id' | 'completed_at'>, today: string, doneColumns: Set<number>): boolean {
  return dueState(card.due_date, today, isCardDone(card, doneColumns)) === 'overdue';
}

/** "3 Nov" / "3 нояб."; the year only when it is not this year. */
export function shortDate(iso: string, today: string = todayIso()): string {
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const sameYear = today.slice(0, 4) === iso.slice(0, 4);
  return date.toLocaleDateString(locale(), { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

/** "5 minutes ago", "yesterday", or a date (seconds since 1970 in, as the API sends). */
export function timeAgo(seconds: number, now: number = Date.now() / 1000): string {
  const s = Math.max(0, now - seconds);
  if (s < 60) return t('just now');
  if (s < 3600) return tn(Math.floor(s / 60), '{n} minute ago', '{n} minutes ago');
  if (s < 86_400) return tn(Math.floor(s / 3600), '{n} hour ago', '{n} hours ago');
  if (s < 2 * 86_400) return t('yesterday');
  if (s < 7 * 86_400) return tn(Math.floor(s / 86_400), '{n} day ago', '{n} days ago');
  return new Date(seconds * 1000).toLocaleDateString(locale(), { day: 'numeric', month: 'short', year: 'numeric' });
}

export function fullTime(seconds: number): string {
  return new Date(seconds * 1000).toLocaleString(locale(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ---------------------------------------------------------------- progress

export interface Progress {
  done: number;
  total: number;
  percent: number;
}

export function progressOf(checklist: { done: number; total: number } | null | undefined): Progress {
  const total = Math.max(0, checklist?.total ?? 0);
  const done = Math.min(total, Math.max(0, checklist?.done ?? 0));
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

/** "3 of 5 steps done" */
export function progressText(p: Progress): string {
  return t('{done} of {total} steps done', { done: p.done, total: p.total });
}

/** The due date in plain words: "Due today", "Due tomorrow", "Due in 3 days", "3 days late", "Due 20 Nov". */
export function dueText(due: string, today: string, done = false): string {
  const diff = dayNumber(due) - dayNumber(today);
  if (done) return t('Was due {date}', { date: shortDate(due, today) });
  if (diff < 0) return tn(-diff, '{n} day late', '{n} days late');
  if (diff === 0) return t('Due today');
  if (diff === 1) return t('Due tomorrow');
  if (diff <= 7) return tn(diff, 'Due in {n} day', 'Due in {n} days');
  return t('Due {date}', { date: shortDate(due, today) });
}

export function boardProgress(board: { cards_open: number; cards_done: number }): Progress {
  return progressOf({ done: board.cards_done, total: board.cards_open + board.cards_done });
}

// ---------------------------------------------------------------- people

/** A readable name from whatever the API sent (an id, a username, {id, username}). */
export function personName(ref: UserRef, people: Person[] = []): string {
  if (ref === null || ref === undefined) return t('someone');
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'number') return people.find((p) => p.id === ref)?.username ?? `#${ref}`;
  if (ref.username) return ref.username;
  if (ref.name) return ref.name;
  if (ref.id !== null && ref.id !== undefined) return personName(ref.id, people);
  return t('someone');
}

export function personId(ref: UserRef, people: Person[] = []): number | null {
  if (ref === null || ref === undefined) return null;
  if (typeof ref === 'number') return ref;
  if (typeof ref === 'string') return people.find((p) => p.username === ref)?.id ?? null;
  if (ref.id !== null && ref.id !== undefined) return ref.id;
  return ref.username ? personId(ref.username, people) : null;
}

export function groupName(ref: GroupRef): string {
  if (ref === null || ref === undefined) return '';
  if (typeof ref === 'string') return ref;
  if (typeof ref === 'number') return `#${ref}`;
  return ref.name ?? (ref.id !== null && ref.id !== undefined ? `#${ref.id}` : '');
}

const AVATAR_COLORS = ['#6366f1', '#0ea5e9', '#14b8a6', '#22c55e', '#f59e0b', '#f97316', '#ef4444', '#ec4899', '#a855f7', '#64748b'];

/** The same person always gets the same avatar colour. */
export function avatarColor(name: string): string {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

// ---------------------------------------------------------------- colours

/** Accent colours of boards, columns and labels (stored by name; a hex value works too). */
export const PALETTE: { name: string; hex: string }[] = [
  { name: 'indigo', hex: '#6366f1' },
  { name: 'blue', hex: '#3b82f6' },
  { name: 'cyan', hex: '#06b6d4' },
  { name: 'teal', hex: '#14b8a6' },
  { name: 'green', hex: '#22c55e' },
  { name: 'lime', hex: '#84cc16' },
  { name: 'amber', hex: '#f59e0b' },
  { name: 'orange', hex: '#f97316' },
  { name: 'red', hex: '#ef4444' },
  { name: 'pink', hex: '#ec4899' },
  { name: 'violet', hex: '#8b5cf6' },
  { name: 'slate', hex: '#64748b' },
];

export function colorHex(color: string | null | undefined, fallback = '#6366f1'): string {
  if (!color) return fallback;
  if (/^#[0-9a-f]{3,8}$/i.test(color)) return color;
  return PALETTE.find((p) => p.name === color)?.hex ?? fallback;
}

/** `#rrggbb` with an alpha (for soft backgrounds of chips). */
export function withAlpha(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6);
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export const PRIORITY_COLOR: Record<Priority, string> = {
  low: '#64748b',
  normal: '#3b82f6',
  high: '#f59e0b',
  urgent: '#ef4444',
};

export function priorityLabel(p: Priority): string {
  if (p === 'low') return t('Low');
  if (p === 'high') return t('High');
  if (p === 'urgent') return t('Urgent');
  return t('Normal');
}

// ---------------------------------------------------------------- filters

export interface CardFilter {
  mine: boolean;
  person: number | string | null; // an Ncode user's id, or a name typed on tasks
  label: number | null;
  priority: Priority | null;
  overdue: boolean;
  q: string;
}

export const NO_FILTER: CardFilter = { mine: false, person: null, label: null, priority: null, overdue: false, q: '' };

export function filterActive(f: CardFilter): boolean {
  return f.mine || f.person !== null || f.label !== null || f.priority !== null || f.overdue || f.q.trim() !== '';
}

export function filterCount(f: CardFilter): number {
  return [f.mine, f.person !== null, f.label !== null, f.priority !== null, f.overdue, f.q.trim() !== ''].filter(Boolean).length;
}

export interface FilterContext {
  me: number | null;
  today: string;
  doneColumns: Set<number>;
  labels: Label[];
}

/** Whether a card passes every filter that is set (search: title and label names, any order of words). */
export function matchesFilter(card: CardSummary, f: CardFilter, ctx: FilterContext): boolean {
  if (f.mine && (ctx.me === null || !card.assignees.includes(ctx.me))) return false;
  if (typeof f.person === 'number' && !card.assignees.includes(f.person)) return false;
  if (typeof f.person === 'string') {
    const wanted = f.person.toLocaleLowerCase();
    if (!(card.assignee_names ?? []).some((n) => n.toLocaleLowerCase() === wanted)) return false;
  }
  if (f.label !== null && !card.labels.includes(f.label)) return false;
  if (f.priority !== null && card.priority !== f.priority) return false;
  if (f.overdue && !isOverdue(card, ctx.today, ctx.doneColumns)) return false;
  const words = f.q.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (words.length) {
    const labelNames = ctx.labels.filter((l) => card.labels.includes(l.id)).map((l) => l.name);
    const haystack = [card.title, ...labelNames, ...(card.assignee_names ?? []), `#${card.id}`].join(' ').toLocaleLowerCase();
    if (!words.every((w) => haystack.includes(w))) return false;
  }
  return true;
}

// ---------------------------------------------------------------- history

type Details = Record<string, unknown>;

function detailsOf(entry: { details: HistoryEntry['details'] }): Details {
  const d = entry.details;
  if (!d) return {};
  if (typeof d === 'string') {
    try {
      const parsed: unknown = JSON.parse(d);
      return parsed && typeof parsed === 'object' ? (parsed as Details) : {};
    } catch {
      return {};
    }
  }
  return d;
}

const str = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? String((v as Details).name ?? (v as Details).title ?? (v as Details).username ?? '') : String(v));
const list = (values: string[]): string => values.filter(Boolean).join(', ');
const names = (v: unknown): string[] => (Array.isArray(v) ? v.map(str).filter(Boolean) : v ? [str(v)] : []);

export interface HistoryContext {
  people?: Person[];
  columns?: Column[];
  labels?: Label[];
}

/** [old, new] as the server writes a change; a bare value counts as the new one. */
function pair(v: unknown): [unknown, unknown] {
  return Array.isArray(v) && v.length === 2 ? [v[0], v[1]] : [undefined, v];
}

function addedRemoved(v: unknown, kind: 'people' | 'labels'): string {
  const d = (v && typeof v === 'object' && !Array.isArray(v) ? v : {}) as Details;
  const added = list(names(d.added));
  const removed = list(names(d.removed));
  if (kind === 'people') {
    if (added && removed) return t('assigned {added} and unassigned {removed}', { added, removed });
    if (added) return t('assigned {names}', { names: added });
    if (removed) return t('unassigned {names}', { names: removed });
    return t('changed the assignees');
  }
  if (added && removed) return t('added the label {added} and removed {removed}', { added, removed });
  if (added) return t('added the label {names}', { names: added });
  if (removed) return t('removed the label {names}', { names: removed });
  return t('changed the labels');
}

/** One phrase per changed field of a card ("set the priority to High"). */
function cardChange(field: string, value: unknown): string {
  const [, next] = pair(value);
  switch (field) {
    case 'title':
      return t('renamed the task to “{title}”', { title: str(next) });
    case 'description':
      return t('changed the description');
    case 'priority':
      return t('set the priority to {priority}', { priority: priorityLabel(str(next) as Priority) });
    case 'due_date':
      return next ? t('set the due date to {date}', { date: shortDate(str(next)) }) : t('removed the due date');
    case 'start_date':
      return next ? t('set the start date to {date}', { date: shortDate(str(next)) }) : t('removed the start date');
    case 'assignees':
      return addedRemoved(value, 'people');
    case 'labels':
      return addedRemoved(value, 'labels');
    case 'name':
      return t('renamed it to “{name}”', { name: str(next) });
    case 'color':
      return t('changed the colour');
    case 'is_done':
      return next ? t('made its tasks count as done') : t('made its tasks no longer count as done');
    case 'repeat':
      return next ? t('made it repeat {how}', { how: repeatLabel(str(next) as Repeat).toLowerCase() }) : t('stopped it repeating');
    default:
      return t('changed {field}', { field });
  }
}

function changes(d: Details): string {
  const c = (d.changes && typeof d.changes === 'object' ? d.changes : {}) as Details;
  return list(Object.entries(c).map(([field, value]) => cardChange(field, value)));
}

/** "carol" + a phrase, as one sentence. */
const said = (user: string, what: string): string => t('{user} {what}', { user, what });

/**
 * One readable sentence for a history row (actions and details as app/kanban/store.py writes them):
 * "carol moved the card from To do to Done", "alice ticked off “Order parts”".
 */
export function historySentence(entry: Pick<HistoryEntry, 'user' | 'action' | 'details'>, ctx: HistoryContext = {}): string {
  const user = personName(entry.user, ctx.people);
  const d = detailsOf(entry);
  const text = str(d.text);
  switch (entry.action) {
    case 'card_created':
      return d.column ? said(user, t('created the task in {column}', { column: str(d.column) })) : said(user, t('created the task'));
    case 'card_moved': {
      const from = str(d.from);
      const to = str(d.to);
      if (from && to && from !== to) return said(user, t('moved the task from {from} to {to}', { from, to }));
      return said(user, t('changed the order of the tasks'));
    }
    case 'card_updated':
      return said(user, changes(d) || t('changed the task'));
    case 'card_archived':
      return said(user, t('hid the task'));
    case 'card_restored':
      return said(user, t('brought the task back'));
    case 'card_deleted':
      return said(user, t('deleted the task “{title}”', { title: str(d.title) }));
    case 'item_added':
      return said(user, t('added the step “{text}”', { text }));
    case 'item_done':
      return said(user, t('ticked off the step “{text}”', { text }));
    case 'item_undone':
      return said(user, t('unticked the step “{text}”', { text }));
    case 'item_updated':
      return d.before ? said(user, t('changed the step “{before}” to “{text}”', { before: str(d.before), text })) : said(user, t('edited the step “{text}”', { text }));
    case 'item_moved':
      return said(user, t('moved the step “{text}”', { text }));
    case 'item_deleted':
      return said(user, t('removed the step “{text}”', { text }));
    case 'comment_added':
      return d.excerpt ? said(user, t('commented: “{excerpt}”', { excerpt: str(d.excerpt) })) : said(user, t('commented'));
    case 'comment_edited':
      return said(user, t('edited a comment'));
    case 'comment_deleted':
      return said(user, t('deleted a comment'));
    case 'card_repeated':
      return said(user, t('made the next one of this repeating task, due {date}', { date: shortDate(str(d.due)) }));
    case 'link_added':
      return said(user, d.kind === 'question' ? t('linked the question “{name}”', { name: str(d.name) }) : t('linked the dashboard “{name}”', { name: str(d.name) }));
    case 'link_removed':
      return said(user, t('removed a link to Search & BI'));
    case 'attachment_added':
      return said(user, t('attached {file}', { file: str(d.filename) || t('a file') }));
    case 'attachment_deleted':
      return said(user, t('removed the attachment {file}', { file: str(d.filename) }));
    case 'board_created':
      return said(user, t('created the board'));
    case 'board_updated':
      return said(user, t('changed the board: {what}', { what: changes(d) || t('details') }));
    case 'board_archived':
      return said(user, t('hid the board'));
    case 'board_restored':
      return said(user, t('brought the board back'));
    case 'members_changed':
      return said(user, t('changed the members'));
    case 'column_created':
      return said(user, t('added the stage {name}', { name: str(d.name) }));
    case 'column_updated':
      return said(user, t('changed the stage {name}: {what}', { name: str(d.column), what: changes(d) || t('details') }));
    case 'column_moved':
      return said(user, t('moved the stage {name}', { name: str(d.column) }));
    case 'column_deleted':
      return said(user, t('deleted the stage {name}', { name: str(d.name) }));
    case 'label_created':
      return said(user, t('added the label {names}', { names: str(d.name) }));
    case 'label_updated':
      return said(user, t('changed the label {name}', { name: str(d.label) }));
    case 'label_deleted':
      return said(user, t('deleted the label {name}', { name: str(d.name) }));
    default:
      return said(user, t('changed the task'));
  }
}

/** The toast for a change made by someone else: "carol moved “Fix the pump”". */
export function liveSentence(event: BoardEvent, cardTitle: string | null): string {
  const user = event.by || t('someone');
  const action = event.action ?? '';
  const title = cardTitle ?? '';
  if (!title) {
    if (action.startsWith('column')) return t('{user} changed the stages', { user });
    if (action.startsWith('label')) return t('{user} changed the labels', { user });
    if (action.startsWith('member')) return t('{user} changed the members', { user });
    return t('{user} changed the board', { user });
  }
  if (action === 'card_created') return t('{user} added “{title}”', { user, title });
  if (action === 'card_moved') return t('{user} moved “{title}”', { user, title });
  if (action.startsWith('comment')) return t('{user} commented on “{title}”', { user, title });
  if (action === 'item_done') return t('{user} ticked off a step of “{title}”', { user, title });
  if (action.startsWith('attachment')) return t('{user} attached a file to “{title}”', { user, title });
  if (action === 'card_archived') return t('{user} hid “{title}”', { user, title });
  if (action.startsWith('item')) return t('{user} changed the steps of “{title}”', { user, title });
  return t('{user} changed “{title}”', { user, title });
}

// ---------------------------------------------------------------- files

export function formatSize(bytes: number): string {
  if (bytes < 1024) return t('{n} B', { n: bytes });
  if (bytes < 1024 * 1024) return t('{n} KB', { n: (bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0) });
  return t('{n} MB', { n: (bytes / 1024 / 1024).toFixed(1) });
}

export const isImage = (contentType: string): boolean => /^image\/(png|jpe?g|gif|webp|bmp|heic|heif|avif)$/i.test(contentType);

/** Size of a thumbnail that fits in max × max and keeps the proportions (never larger than the image). */
export function thumbSize(width: number, height: number, max = 400): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const scale = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

export const UPLOAD_ACCEPT = 'image/*,application/pdf,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.odt,.ods,.txt,.csv';

/** A content type for a file the browser did not type (e.g. some phones and .docx). */
export function guessType(name: string, given: string): string {
  if (given) return given;
  const ext = name.toLowerCase().split('.').pop() ?? '';
  const known: Record<string, string> = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic',
    pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv',
    doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
  };
  return known[ext] ?? 'application/octet-stream';
}

// ---------------------------------------------------------------- phone (K2)

/** The stage tabs over a phone board are drop targets too: "tab12" is stage 12. */
export const tabKey = (columnId: number) => `tab${columnId}`;
export const tabColumn = (key: string | number): number | null => (/^tab\d+$/.test(String(key)) ? Number(String(key).slice(3)) : null);

/** The stage in view on a phone: the column whose middle is closest to the middle of the screen.
 * columns: each column's left edge and width inside the scrolling row. */
export function stageInView(scrollLeft: number, viewWidth: number, columns: { left: number; width: number }[]): number {
  if (!columns.length) return 0;
  const middle = scrollLeft + viewWidth / 2;
  let best = 0;
  columns.forEach((c, i) => {
    const b = columns[best];
    if (Math.abs(c.left + c.width / 2 - middle) < Math.abs(b.left + b.width / 2 - middle)) best = i;
  });
  return best;
}

/** Photos bigger than this are made smaller on the phone before sending (faster on mobile data). */
export const PHOTO_MAX_SIDE = 2560;
export const PHOTO_SHRINK_ABOVE = 1_500_000; // bytes

/** Whether a picked file is a photo worth making smaller before it is sent. HEIC is left as it is:
 * not every browser can read it. */
export function shouldShrink(type: string, size: number): boolean {
  return ['image/jpeg', 'image/png', 'image/webp'].includes(type) && size > PHOTO_SHRINK_ABOVE;
}

/** "photo.jpg" for a picture that was made smaller (it is a JPEG now). */
export function shrunkName(name: string): string {
  const base = (name || 'photo').replace(/\.[^.]+$/, '');
  return `${base || 'photo'}.jpg`;
}

/** The name of a task made straight from a photo: "Photo 14:05", edited right after. */
export function photoTaskTitle(now: Date, word: string): string {
  return `${word} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- calendar (K3)

/** "2026-11-04" from a year, a month (0-11) and a day; days past the month roll over like Date does. */
export function isoOf(year: number, month: number, day: number): string {
  const d = new Date(Date.UTC(year, month, day));
  return d.toISOString().slice(0, 10);
}

/** The weeks shown for a month: Monday first, whole weeks, 4 to 6 rows of 7 ISO dates. */
export function monthGrid(year: number, month: number): string[][] {
  const first = new Date(Date.UTC(year, month, 1));
  const back = (first.getUTCDay() + 6) % 7; // days since Monday
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const rows = Math.ceil((back + daysInMonth) / 7);
  return Array.from({ length: rows }, (_, w) => Array.from({ length: 7 }, (_, d) => isoOf(year, month, 1 - back + w * 7 + d)));
}

/** The month before or after: { year, month } with month 0-11. */
export function shiftMonth(year: number, month: number, by: number): { year: number; month: number } {
  const m = year * 12 + month + by;
  return { year: Math.floor(m / 12), month: ((m % 12) + 12) % 12 };
}

/** Where a task sits on the calendar: its due date, else its start date, else nowhere. */
export function calendarDate(card: Pick<CardSummary, 'due_date' | 'start_date'>): string | null {
  return card.due_date ?? card.start_date ?? null;
}

/** Tasks by their calendar date, each day in board order (priority first, then position). */
export function tasksByDate<T extends CardSummary>(cards: T[]): Map<string, T[]> {
  const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const out = new Map<string, T[]>();
  for (const c of cards) {
    const date = calendarDate(c);
    if (!date) continue;
    if (!out.has(date)) out.set(date, []);
    out.get(date)!.push(c);
  }
  for (const list of out.values()) list.sort((a, b) => rank[a.priority] - rank[b.priority] || byPosition(a, b));
  return out;
}

export interface AgendaDay<T> {
  date: string | null; // null: the "late" group
  cards: T[];
}

/** The phone's day-by-day list for a month: late open tasks first (from before today), then each day
 * of the month that has tasks; today is always listed so the list starts somewhere familiar. */
export function agenda<T extends CardSummary>(cards: T[], year: number, month: number, today: string, isDone: (c: T) => boolean): AgendaDay<T>[] {
  const first = isoOf(year, month, 1);
  const last = isoOf(year, month + 1, 0);
  const late = cards.filter((c) => !isDone(c) && c.due_date !== null && c.due_date < today && c.due_date < first);
  const byDate = tasksByDate(cards.filter((c) => {
    const d = calendarDate(c);
    return d !== null && d >= first && d <= last;
  }));
  if (today >= first && today <= last && !byDate.has(today)) byDate.set(today, []);
  const days = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, list]) => ({ date, cards: list }));
  return late.length ? [{ date: null, cards: late }, ...days] : days;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const asDate = (iso: string) => new Date(`${iso}T12:00:00`);

/** "November 2026" / "Ноябрь 2026" */
export function monthTitle(year: number, month: number): string {
  return cap(new Intl.DateTimeFormat(locale(), { month: 'long', year: 'numeric' }).format(new Date(year, month, 15)).replace(/\s*г\.$/, ''));
}

/** "Wednesday 4 November" / "Среда, 4 ноября" */
export function dayTitle(iso: string): string {
  return cap(new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' }).format(asDate(iso)));
}

const WEEK_DAYS = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08']; // a Monday ... Sunday
/** Mon ... Sun / Пн ... Вс */
export const weekdayNames = () => WEEK_DAYS.map((d) => cap(new Intl.DateTimeFormat(locale(), { weekday: 'short' }).format(asDate(d)).replace('.', '')));

// ---------------------------------------------------------------- my tasks (K3)

export type MyGroupKey = 'late' | 'today' | 'week' | 'later' | 'nodate' | 'done';
export const MY_GROUPS: MyGroupKey[] = ['late', 'today', 'week', 'later', 'nodate', 'done'];

/** My tasks in the order a person works through them: late, today, the next 7 days, later, without a
 * date; the ones finished lately last (newest first). Empty groups are left out. */
export function myGroups<T extends CardSummary>(cards: T[], today: string, isDone: (c: T) => boolean): { key: MyGroupKey; cards: T[] }[] {
  const weekEnd = isoOf(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)) + 7);
  const rank: Record<Priority, number> = { urgent: 0, high: 1, normal: 2, low: 3 };
  const groups: Record<MyGroupKey, T[]> = { late: [], today: [], week: [], later: [], nodate: [], done: [] };
  for (const c of cards) {
    const date = c.due_date;
    if (isDone(c)) groups.done.push(c);
    else if (!date) groups.nodate.push(c);
    else if (date < today) groups.late.push(c);
    else if (date === today) groups.today.push(c);
    else if (date < weekEnd) groups.week.push(c);
    else groups.later.push(c);
  }
  const byDate = (a: T, b: T) => (a.due_date ?? '').localeCompare(b.due_date ?? '') || rank[a.priority] - rank[b.priority] || a.id - b.id;
  for (const key of ['late', 'today', 'week', 'later'] as const) groups[key].sort(byDate);
  groups.nodate.sort((a, b) => rank[a.priority] - rank[b.priority] || a.id - b.id);
  groups.done.sort((a, b) => (b.completed_at ?? 0) - (a.completed_at ?? 0));
  return MY_GROUPS.filter((k) => groups[k].length).map((key) => ({ key, cards: groups[key] }));
}

export function myGroupTitle(key: MyGroupKey): string {
  return {
    late: t('Late'),
    today: t('Today'),
    week: t('Next 7 days'),
    later: t('Later'),
    nodate: t('No date'),
    done: t('Done this week'),
  }[key];
}

// ---------------------------------------------------------------- repeating tasks (K3)

export function repeatLabel(r: Repeat): string {
  return { daily: t('Every day'), weekdays: t('Every working day (Mon–Fri)'), weekly: t('Every week'), monthly: t('Every month') }[r];
}

/** The names typed on a board's tasks (people who are not Ncode users), each once, A to Z. */
export function namedPeople(cards: Pick<CardSummary, 'assignee_names'>[]): string[] {
  const byKey = new Map<string, string>();
  for (const c of cards) for (const n of c.assignee_names ?? []) if (!byKey.has(n.toLocaleLowerCase())) byKey.set(n.toLocaleLowerCase(), n);
  return [...byKey.values()].sort((a, b) => a.localeCompare(b));
}

// ---------------------------------------------------------------- print (K4)

/** One task as a line of the printed sheet. */
export function printRow(card: CardSummary, people: Person[], today: string, done: boolean, extra?: string) {
  const late = !done && !card.completed_at && card.due_date !== null && card.due_date < today;
  return {
    title: card.title,
    who: [...card.assignees.map((id) => personName(id, people)), ...(card.assignee_names ?? [])].join(', '),
    due: card.due_date ? (late ? dueText(card.due_date, today) : shortDate(card.due_date, today)) : '',
    late,
    steps: card.checklist.total ? `${card.checklist.done}/${card.checklist.total}` : '',
    extra: extra ?? (card.priority === 'normal' ? '' : priorityLabel(card.priority)),
  };
}

// ---------------------------------------------------------------- timeline (K4)

/** An ISO date moved by whole days. */
export function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number);
  return isoOf(y, m - 1, d + days);
}

/** Whole days from a to b (b - a). */
export function daysBetween(a: string, b: string): number {
  return dayNumber(b) - dayNumber(a);
}

/** The days the timeline shows: whole weeks from the Monday a week before today's week, moved by
 * `offset` weeks. */
export function timelineDays(today: string, offset = 0, weeks = 6): string[] {
  const [y, m, d] = today.split('-').map(Number);
  const weekday = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // 0 = Monday
  const first = shiftIso(today, -weekday - 7 + offset * 7);
  return Array.from({ length: weeks * 7 }, (_, i) => shiftIso(first, i));
}

export interface Bar {
  from: number; // first day shown (index in the timeline)
  to: number;   // last day shown
  cutStart: boolean; // the task starts before the timeline
  cutEnd: boolean;   // and ends after it
}

/** Where a task's bar sits: from its start to its due date (one day when it has only one of them);
 * null when it has no date or is outside the days shown. */
export function barOf(card: Pick<CardSummary, 'start_date' | 'due_date'>, days: string[]): Bar | null {
  const start = card.start_date ?? card.due_date;
  const end = card.due_date ?? card.start_date;
  if (!start || !end || !days.length) return null;
  const first = days[0];
  const last = days[days.length - 1];
  if (end < first || start > last) return null;
  return {
    from: Math.max(0, daysBetween(first, start)),
    to: Math.min(days.length - 1, daysBetween(first, end)),
    cutStart: start < first,
    cutEnd: end > last,
  };
}

/** New dates after dragging a bar by `days`: the whole bar, or one end of it (never past the other). */
export function movedDates(card: Pick<CardSummary, 'start_date' | 'due_date'>, days: number, part: 'bar' | 'start' | 'end'): { start_date: string | null; due_date: string | null } {
  const start = card.start_date;
  const due = card.due_date;
  if (part === 'bar') return { start_date: start ? shiftIso(start, days) : null, due_date: due ? shiftIso(due, days) : null };
  if (part === 'end') {
    const base = due ?? start!;
    const moved = shiftIso(base, days);
    const floor = start ?? base;
    return { start_date: start, due_date: moved < floor ? floor : moved };
  }
  const base = start ?? due!;
  const moved = shiftIso(base, days);
  const ceil = due ?? base;
  return { start_date: moved > ceil ? ceil : moved, due_date: due };
}
