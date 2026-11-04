/**
 * History of questions and dashboards (M15, backend/app/content/history.py): every save keeps a
 * version - who saved it, when, and what changed in plain words ("Changed the filters and the
 * chart"). A version can be opened read-only and restored; restoring is itself a new version.
 * Types and pure helpers (tested in tests/versions.test.ts); the requests are in versionsApi.ts.
 */
import { localDateText } from '../viz/format.ts';
import { queryChanged } from './verified.ts';
import type { Verified } from './verified.ts';
import { t } from '../i18n/index.ts';

export type HistoryKind = 'question' | 'dashboard';

export interface VersionInfo {
  version: number;
  saved_by: string | null;
  saved_at: number; // unix seconds
  summary: string;
  current: boolean; // the newest version: what the item is now
}

export interface QuestionVersionData {
  name: string;
  description: string | null;
  kind: 'builder' | 'sql' | 'federated';
  connection: string;
  spec: Record<string, unknown>;
  viz: unknown;
  parameters: { name: string; label?: string | null; type?: string; default?: unknown; required?: boolean }[];
}

export interface VersionCard {
  key: string;
  kind: 'question' | 'text' | 'heading';
  question_id?: number | null;
  tab?: string | null;
  layout: { x: number; y: number; w: number; h: number };
  title?: string | null;
  text?: string | null;
}

export interface DashboardVersionData {
  name: string;
  description: string | null;
  filters: { id: string; label: string; type: string }[];
  tabs: { id: string; name: string }[];
  cards: VersionCard[];
  settings: Record<string, unknown>;
}

export type VersionQuestion = { state: 'ok' | 'archived' | 'hidden' | 'deleted'; id: number | null; name: string | null; kind: string | null };

export interface VersionDetail<T> extends VersionInfo {
  data: T;
  questions?: Record<string, VersionQuestion>; // dashboards: the questions on the cards, as far as the reader may see them
}

// ---------------------------------------------------------------- pure helpers

/** "alice · 3 Nov 2026, 14:05" */
export function savedLine(v: Pick<VersionInfo, 'saved_by' | 'saved_at'>): string {
  const when = localDateText(v.saved_at * 1000, true);
  return v.saved_by ? t('{who} · {when}', { who: v.saved_by, when }) : when;
}

/** What a card of an old dashboard version showed, in words. */
export function cardLabel(card: VersionCard, questions: Record<string, VersionQuestion> = {}): string {
  if (card.kind === 'heading') return card.text?.trim() || t('Heading');
  if (card.kind === 'text') {
    const first = (card.text ?? '').split('\n').map((l) => l.replace(/^[#>*\-\s]+/, '').replace(/\*\*|__|`/g, '').trim()).find(Boolean);
    return first ? (first.length > 60 ? `${first.slice(0, 59)}…` : first) : t('Text');
  }
  const q = card.question_id != null ? questions[String(card.question_id)] : undefined;
  if (card.title?.trim()) return card.title.trim();
  if (q?.name) return q.name;
  if (card.question_id == null || q?.state === 'deleted') return t('A question that was deleted');
  return t('A question that is not shared with you');
}

export interface PreviewBox {
  key: string;
  label: string;
  kind: VersionCard['kind'];
  left: number; // % of the width
  width: number;
  top: number; // grid rows
  height: number;
}

/** The cards of one tab as boxes of a small picture of the layout (12 columns wide). */
export function previewBoxes(data: Pick<DashboardVersionData, 'cards' | 'tabs'>, tab: string | null, questions: Record<string, VersionQuestion> = {}): { boxes: PreviewBox[]; rows: number } {
  const onTab = data.cards.filter((c) => (data.tabs.length ? (c.tab ?? data.tabs[0]?.id) === tab : true));
  const boxes = onTab
    .map((c) => ({
      key: c.key, label: cardLabel(c, questions), kind: c.kind,
      left: (c.layout.x / 12) * 100, width: (c.layout.w / 12) * 100, top: c.layout.y, height: c.layout.h,
    }))
    .sort((a, b) => a.top - b.top || a.left - b.left);
  return { boxes, rows: Math.max(1, ...onTab.map((c) => c.layout.y + c.layout.h)) };
}

/** What restoring a question's version would also do, for the confirm dialog. */
export function restoreNotes(
  current: { kind: string; connection?: string | null; spec: unknown; parameters?: QuestionVersionData['parameters']; verified?: Verified | null },
  old: QuestionVersionData,
): string[] {
  const notes: string[] = [];
  if (current.verified && queryChanged(current, old)) notes.push(t('This version computes something different, so the Verified badge will be removed.'));
  return notes;
}
