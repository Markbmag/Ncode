/**
 * Dashboards on a phone and "data as of" (M15). Pure, tested in tests/dashboardPhone.test.ts.
 *
 * On a narrow screen the grid becomes one card per row in the grid's reading order (top to bottom,
 * left to right); number cards that follow each other sit two per row, as they are small.
 */
import { localDateText } from '../viz/format.ts';
import type { DashCard } from './types.ts';
import { t } from '../i18n/index.ts';

export interface PhoneCard {
  card: DashCard;
  span: 1 | 2;    // of two columns
  height: number | null; // px; null = as high as its content (headings)
}

const ROW = 40;
const KPI_HEIGHT = 310;

/** Is this card a number card (its own chart on the dashboard, else the question's)? */
export function isNumberCard(card: DashCard): boolean {
  if (card.kind !== 'question') return false;
  const viz = card.viz ?? card.question?.viz;
  return !!viz && viz.mode === 'chart' && viz.spec?.type === 'kpi';
}

/** The cards in reading order, number cards paired where two follow each other. */
export function phoneCards(cards: DashCard[]): PhoneCard[] {
  const ordered = [...cards].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x);
  const out: PhoneCard[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const card = ordered[i];
    if (isNumberCard(card) && i + 1 < ordered.length && isNumberCard(ordered[i + 1])) {
      out.push({ card, span: 1, height: KPI_HEIGHT }, { card: ordered[i + 1], span: 1, height: KPI_HEIGHT });
      i++;
      continue;
    }
    if (card.kind === 'heading') out.push({ card, span: 2, height: null });
    else if (card.kind === 'text') out.push({ card, span: 2, height: Math.min(Math.max(card.layout.h, 3), 8) * ROW });
    else out.push({ card, span: 2, height: isNumberCard(card) ? KPI_HEIGHT : Math.min(Math.max(card.layout.h, 7), 10) * ROW });
  }
  return out;
}

/** When the rows on screen were read from the database: a reused result is as old as its run. */
export function readAt(finishedAt: number | null, stats: { cached?: boolean; cached_age_sec?: number | null } | null | undefined): number | null {
  if (finishedAt === null) return null;
  return stats?.cached ? finishedAt - Math.max(0, stats.cached_age_sec ?? 0) * 1000 : finishedAt;
}

const clock = (at: number) => {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
const sameDay = (a: number, b: number) => new Date(a).toDateString() === new Date(b).toDateString();

/** The time of day, with the day when it is not today: "08:15", "2 Nov 2026 08:15". */
export function timeText(at: number, now: number): string {
  return sameDay(at, now) ? clock(at) : localDateText(at, true);
}

/** A card's short age: "just now", "3 min ago", then the time ("08:15"). */
export function ageText(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / 60_000);
  if (minutes < 1) return t('just now');
  if (minutes < 60) return t('{n} min ago', { n: minutes });
  return timeText(at, now);
}

/** The dashboard's line: the oldest data on screen. "Data from 08:15 · 3 min ago". */
export function dataAsOf(times: number[], now: number): string | null {
  if (!times.length) return null;
  const oldest = Math.min(...times);
  const minutes = Math.floor(Math.max(0, now - oldest) / 60_000);
  const from = t('Data from {time}', { time: timeText(oldest, now) });
  return minutes < 60 ? `${from} · ${ageText(oldest, now)}` : from;
}

/** The card's tooltip: when exactly, and whether a saved result was reused. */
export function ageHint(at: number, now: number, cached: boolean): string {
  const when = timeText(at, now);
  return cached
    ? t('Read from the database at {time}; this result was saved and reused.', { time: when })
    : t('Read from the database at {time}.', { time: when });
}

/** "Filters (2)": how many filters are set. */
export function filtersLabel(set: number): string {
  return set ? t('Filters ({n})', { n: set }) : t('Filters');
}
