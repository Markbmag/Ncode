/**
 * The short notes above a result (M11): plain sentences only when they matter, instead of a row
 * of badges (AUTO, CACHED, FIRST 5 ROWS). Pure, tested in tests/viz.test.ts.
 */
import { t, tn } from '../../i18n/index.ts';

export interface ResultNote {
  kind: 'saved' | 'cut' | 'stopped';
  text: string;
  hint: string;
}

interface Stats {
  row_count: number;
  truncated: boolean;
  cached: boolean;
  cached_age_sec?: number | null;
}

/** "Saved result from 2 min ago". */
export function savedAgo(ageSec: number | null | undefined): string {
  if (ageSec === null || ageSec === undefined || ageSec < 60) return t('Saved result from less than a minute ago');
  if (ageSec < 3600) {
    const n = Math.floor(ageSec / 60);
    return tn(n, 'Saved result from {n} min ago', 'Saved result from {n} min ago');
  }
  const n = Math.floor(ageSec / 3600);
  return tn(n, 'Saved result from {n} hour ago', 'Saved result from {n} hours ago');
}

/**
 * What to tell about this result. `rowLimit` is the question's own row limit: when that is what cut
 * the rows ("top 5"), saying "only the first 5" again is noise.
 */
export function resultNotes(stats: Stats, { rowLimit = null, stopped = false }: { rowLimit?: number | null; stopped?: boolean } = {}): ResultNote[] {
  const out: ResultNote[] = [];
  if (stopped) out.push({ kind: 'stopped', text: t('Stopped — showing the previous result'), hint: t('Run the question again to see a new result.') });
  if (stats.truncated && !(rowLimit && stats.row_count === rowLimit)) {
    out.push({
      kind: 'cut',
      text: tn(stats.row_count, 'Showing the first {n} row', 'Showing the first {n} rows'),
      hint: t('There are more rows. Raise the row limit or add filters.'),
    });
  }
  if (stats.cached) {
    out.push({ kind: 'saved', text: savedAgo(stats.cached_age_sec), hint: t('The same question ran a short while ago, so its result was reused instead of asking the database again.') });
  }
  return out;
}
