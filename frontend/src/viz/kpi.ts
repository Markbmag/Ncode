/**
 * What a number card (KPI) says (M15): the value, a plain sentence comparing it with the period
 * before ("▲ 12 % vs the week before", "▼ 3 % vs October") and/or a target ("Target 2 % · 0.3
 * points below"), and whether that is good, bad or neither. Pure, tested in tests/kpi.test.ts.
 *
 * With a date column (a builder question grouped by week, month ...) the value is the last
 * COMPLETE period and it is compared with the period right before it: on a Tuesday, "this week"
 * has two days and would always look like a drop. The current period is told apart ("So far this
 * week: 87"). A missing period before is not replaced by an older one. When the result carries
 * the "vs previous period" calculation (columns <value>_prev_<period>), its matched value is used.
 * Without dates the last row is compared with the row before, as before M15.
 */
import { colIndex, toNumber } from './data.ts';
import type { Table } from './data.ts';
import { dateStyleFromName, dayText, formatNumber } from './format.ts';
import { withColumnFormats } from './options.ts';
import type { ColumnFormat, VizSpec } from './types.ts';
import { t, tc, tn } from '../i18n/index.ts';

export type Period = 'day' | 'week' | 'month' | 'quarter' | 'year';
export type Tone = 'good' | 'bad' | 'neutral';
const PERIODS: Period[] = ['day', 'week', 'month', 'quarter', 'year'];

export interface KpiComparison {
  previous: number;
  diff: number;
  ratio: number | null; // (value - previous) / |previous|; null when previous is 0
  direction: 'up' | 'down' | 'flat';
  tone: Tone;
  text: string; // "▲ 12 % vs the week before"
  hint: string; // which periods were compared, with their values
}

export interface KpiView {
  column: string | undefined;
  fmt: ColumnFormat;
  value: number | null;
  period: Period | null;
  label: string | null;           // which period the value belongs to ("Last week")
  comparison: KpiComparison | null;
  noComparison: string | null;    // why there is none, when one was expected
  target: { value: number; text: string; tone: Tone } | null;
  partial: string | null;         // "So far this week: 87"
  trend: number[];
}

// ---------------------------------------------------------------- days without time zones

/** A calendar day as days since 1970-01-01 (UTC arithmetic: no daylight-saving surprises). */
type Day = number;
const MS = 86_400_000;
const dayOf = (y: number, m: number, d: number): Day => Math.round(Date.UTC(y, m - 1, d) / MS);
const parts = (day: Day) => {
  const d = new Date(day * MS);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), weekday: (d.getUTCDay() + 6) % 7 }; // Monday 0
};

export function parseDay(v: unknown): Day | null {
  if (typeof v !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  return m ? dayOf(Number(m[1]), Number(m[2]), Number(m[3])) : null;
}

/** The first day of the period the day lies in (weeks start on Monday, like the builder's weeks). */
export function periodStart(day: Day, period: Period): Day {
  const p = parts(day);
  if (period === 'day') return day;
  if (period === 'week') return day - p.weekday;
  if (period === 'month') return dayOf(p.y, p.m, 1);
  if (period === 'quarter') return dayOf(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1);
  return dayOf(p.y, 1, 1);
}

/** The start of the period n periods later (n < 0: earlier). */
export function shiftPeriod(start: Day, period: Period, n: number): Day {
  if (period === 'day') return start + n;
  if (period === 'week') return start + 7 * n;
  const p = parts(start);
  const months = (period === 'month' ? 1 : period === 'quarter' ? 3 : 12) * n;
  const index = p.y * 12 + (p.m - 1) + months;
  return dayOf(Math.floor(index / 12), (index % 12) + 1, 1);
}

/**
 * The period of grouped dates: what all of them start (every one a Monday: weeks; every one the
 * 1st: months ...), else the usual step between them (like the backend's previous-period guess).
 */
export function guessPeriod(days: Day[]): Period | null {
  const sorted = [...new Set(days)].sort((a, b) => a - b);
  if (!sorted.length) return null;
  const gaps = sorted.slice(1).map((d, i) => d - sorted[i]).sort((a, b) => a - b);
  const all = (period: Period) => sorted.every((d) => periodStart(d, period) === d);
  if (all('year') && sorted.length > 1) return 'year';
  if (all('quarter') && sorted.length > 1 && gaps[0] >= 89) return 'quarter';
  if (all('month')) return 'month';
  if (all('week') && gaps.every((g) => g % 7 === 0)) return 'week';
  if (!gaps.length) return 'day';
  const step = gaps[Math.floor(gaps.length / 2)];
  return step <= 1 ? 'day' : step <= 7 ? 'week' : step <= 31 ? 'month' : step <= 92 ? 'quarter' : 'year';
}

// ---------------------------------------------------------------- words

// the month alone, in its own form ("Май"; t('May') is the short name in dates: "12 май")
const MONTHS = () => [
  tc('month', 'January'),
  tc('month', 'February'),
  tc('month', 'March'),
  tc('month', 'April'),
  tc('month', 'May'),
  tc('month', 'June'),
  tc('month', 'July'),
  tc('month', 'August'),
  tc('month', 'September'),
  tc('month', 'October'),
  tc('month', 'November'),
  tc('month', 'December'),
];
// "vs October": Russian needs the month in its own case ("к октябрю")
const VS_MONTHS = () => [t('vs January'), t('vs February'), t('vs March'), t('vs April'), t('vs May'), t('vs June'), t('vs July'), t('vs August'), t('vs September'), t('vs October'), t('vs November'), t('vs December')];

const quarterOf = (m: number) => Math.floor((m - 1) / 3) + 1;

/** The exact name of a period, for the hint: "week of 26 Oct 2026", "October 2026". */
function exactName(start: Day, period: Period): string {
  const p = parts(start);
  if (period === 'day') return dayText(p.y, p.m, p.d);
  if (period === 'week') return t('Week of {date}', { date: dayText(p.y, p.m, p.d) });
  if (period === 'month') return `${MONTHS()[p.m - 1]} ${p.y}`;
  if (period === 'quarter') return t('Q{q} {year}', { q: quarterOf(p.m), year: p.y });
  return String(p.y);
}

/** What the value is, as people say it: "Yesterday", "Last week", "October", "Q3", "2025". */
function valueName(start: Day, period: Period, today: Day): string {
  const current = periodStart(today, period);
  const p = parts(start);
  const thisYear = parts(today).y === p.y;
  if (start === shiftPeriod(current, period, -1)) {
    if (period === 'day') return t('Yesterday');
    if (period === 'week') return t('Last week');
  }
  if (period === 'month') return thisYear ? MONTHS()[p.m - 1] : `${MONTHS()[p.m - 1]} ${p.y}`;
  if (period === 'quarter') return thisYear ? t('Q{q}', { q: quarterOf(p.m) }) : t('Q{q} {year}', { q: quarterOf(p.m), year: p.y });
  return exactName(start, period);
}

/** "vs the week before", "vs September", "vs Q2 2025", "vs 2024" (the period compared with). */
function versus(previous: Day | null, period: Period, valueStart: Day | null): string {
  if (previous !== null && valueStart !== null) {
    const p = parts(previous);
    const sameYear = parts(valueStart).y === p.y;
    if (period === 'month') return sameYear ? VS_MONTHS()[p.m - 1] : `${VS_MONTHS()[p.m - 1]} ${p.y}`;
    if (period === 'quarter') return sameYear ? t('vs Q{q}', { q: quarterOf(p.m) }) : t('vs Q{q} {year}', { q: quarterOf(p.m), year: p.y });
    if (period === 'year') return t('vs {year}', { year: p.y });
  }
  return {
    day: t('vs the day before'), week: t('vs the week before'), month: t('vs the month before'),
    quarter: t('vs the quarter before'), year: t('vs the year before'),
  }[period];
}

function soFar(period: Period, value: string): string {
  return {
    day: t('So far today: {value}', { value }), week: t('So far this week: {value}', { value }),
    month: t('So far this month: {value}', { value }), quarter: t('So far this quarter: {value}', { value }),
    year: t('So far this year: {value}', { value }),
  }[period];
}

function noDataBefore(period: Period): string {
  return {
    day: t('No data for the day before'), week: t('No data for the week before'), month: t('No data for the month before'),
    quarter: t('No data for the quarter before'), year: t('No data for the year before'),
  }[period];
}

/** A share (shown as percent): changes and gaps are told in percentage points, not "% of a %". */
const isShare = (fmt: ColumnFormat) => fmt.style === 'percent';

/** How big a difference is, without its sign: "12 %" of the value before, or "0.3 points" for shares. */
function amount(diff: number, fmt: ColumnFormat): string {
  if (isShare(fmt)) {
    const points = Math.round(Math.abs(diff) * (fmt.percentIsFraction === false ? 10 : 1000)) / 10;
    return tn(points, '{n} point', '{n} points');
  }
  return formatNumber(Math.abs(diff), fmt);
}

function toneOf(up: boolean | null, opts: KpiSettings): Tone {
  if (up === null || opts.neutral) return 'neutral';
  return up === (opts.upIsGood ?? true) ? 'good' : 'bad';
}

export type KpiSettings = NonNullable<VizSpec['kpi']>;

// ---------------------------------------------------------------- the card

interface Point { row: number; start: Day; value: number }

/** The value column: the one picked, else the first measure, else the first number. */
export function kpiColumn(table: Table, viz: VizSpec): string | undefined {
  return viz.value ?? viz.series?.[0]?.y ?? table.columns.find((c) => c.type === 'number' && !c.generated)?.name ?? table.columns.find((c) => c.type === 'number')?.name;
}

/** The "vs previous period" calculation's column for this value, and its period. */
function prevColumn(table: Table, column: string): { index: number; period: Period } | null {
  const own = table.columns.findIndex((c) => c.name.startsWith(`${column}_prev_`) && PERIODS.includes(c.name.slice(column.length + 6) as Period));
  const any = own >= 0 ? own : table.columns.findIndex((c) => c.generated && /_prev_(day|week|month|quarter|year)$/.test(c.name) && c.name !== column);
  if (any < 0) return null;
  return { index: any, period: /_prev_(\w+)$/.exec(table.columns[any].name)![1] as Period };
}

export function kpiView(table: Table, spec: VizSpec, now: Date = new Date()): KpiView {
  const viz = withColumnFormats(spec, table);
  const opts: KpiSettings = { compare: true, sparkline: true, upIsGood: true, ...viz.kpi };
  const column = kpiColumn(table, viz);
  const fmt: ColumnFormat = (column && viz.format?.[column]) || {};
  const vi = colIndex(table, column);
  const view: KpiView = { column, fmt, value: null, period: null, label: null, comparison: null, noComparison: null, target: null, partial: null, trend: [] };
  if (vi < 0 || !column) return view;
  const values = table.rows.map((r) => toNumber(r[vi]));
  const today = dayOf(now.getFullYear(), now.getMonth() + 1, now.getDate());
  const prev = prevColumn(table, column);

  // the date column: the chart's x when it is a date, else the first date in the result
  const xi = [colIndex(table, viz.x), ...table.columns.map((c, i) => (c.type === 'date' || c.type === 'datetime' ? i : -1))]
    .find((i) => i >= 0 && (table.columns[i].type === 'date' || table.columns[i].type === 'datetime')) ?? -1;
  const dated = xi >= 0 ? table.rows.map((r, row) => ({ row, day: parseDay(r[xi]), value: values[row] })).filter((p) => p.day !== null) : [];
  const unique = new Set(dated.map((p) => p.day)).size === dated.length;
  const xName = xi >= 0 ? table.columns[xi].name : '';
  const style = (xi >= 0 && viz.format?.[xName]?.date) || dateStyleFromName(xName);
  const period: Period | null = PERIODS.includes(style as Period) ? (style as Period) : prev?.period ?? guessPeriod(dated.map((p) => p.day!));

  let valueRow: number | null = null;
  let previous: number | null = null;
  let valueStart: Day | null = null;
  let previousStart: Day | null = null;

  if (period && dated.length > 0 && unique) {
    view.period = period;
    const current = periodStart(today, period);
    const points: Point[] = dated
      .filter((p): p is { row: number; day: Day; value: number } => p.value !== null)
      .map((p) => ({ row: p.row, start: periodStart(p.day, period), value: p.value }))
      .filter((p) => p.start <= current) // a planned future period is not "the latest"
      .sort((a, b) => a.start - b.start);
    const complete = points.filter((p) => p.start < current);
    const running = points.find((p) => p.start === current);
    view.trend = complete.map((p) => p.value).slice(-24);
    const last = complete.at(-1) ?? running;
    if (last) {
      valueRow = last.row;
      valueStart = last.start;
      view.value = last.value;
      view.label = last === running ? soFarLabel(period) : valueName(last.start, period, today);
      if (running && last !== running) view.partial = soFar(period, formatNumber(running.value, fmt));
      previousStart = shiftPeriod(last.start, period, -1);
      const fromCalc = prev ? toNumber(table.rows[last.row][prev.index]) : null;
      previous = fromCalc ?? points.find((p) => p.start === previousStart)?.value ?? null;
      if (last === running) previous = null; // only part of a period: no fair comparison
      if (previous === null && opts.compare) view.noComparison = last === running ? t('This period is not over yet') : noDataBefore(period);
    }
  } else {
    // no dates: the last row, compared with the row before (or with the calculation's column)
    const present = values.map((v, row) => ({ v, row })).filter((p): p is { v: number; row: number } => p.v !== null);
    view.trend = present.map((p) => p.v).slice(-24);
    const last = present.at(-1);
    if (last) {
      valueRow = last.row;
      view.value = last.v;
      const fromCalc = prev ? toNumber(table.rows[last.row][prev.index]) : null;
      previous = fromCalc ?? (present.length > 1 ? present.at(-2)!.v : null);
      if (fromCalc !== null) view.period = prev!.period;
    }
  }

  const value = view.value;
  if (opts.compare && value !== null && previous !== null && valueRow !== null) {
    const diff = value - previous;
    const direction = Math.abs(diff) < 1e-12 ? 'flat' : diff > 0 ? 'up' : 'down';
    const ratio = previous !== 0 ? diff / Math.abs(previous) : null;
    const vs = view.period ? versus(previousStart, view.period, valueStart) : t('vs the row before');
    const size = isShare(fmt) || ratio === null ? amount(diff, fmt) : formatNumber(Math.abs(ratio), { style: 'percent', decimals: Math.abs(ratio) < 0.1 ? 1 : 0 });
    const text = direction === 'flat' ? `${t('Unchanged')} ${vs}` : `${direction === 'up' ? '▲' : '▼'} ${size} ${vs}`;
    const hint = view.period && valueStart !== null && previousStart !== null
      ? t('{current} ({value}) compared with {previous} ({before})', {
        current: exactName(valueStart, view.period), value: formatNumber(value, fmt),
        previous: exactName(previousStart, view.period), before: formatNumber(previous, fmt),
      }) + (view.partial ? ` ${t('The current period is not over yet, so it is not compared.')}` : '')
      : t('{value} compared with {before}', { value: formatNumber(value, fmt), before: formatNumber(previous, fmt) });
    view.comparison = { previous, diff, ratio, direction, tone: toneOf(direction === 'flat' ? null : direction === 'up', opts), text, hint };
  }

  const target = opts.target;
  if (typeof target === 'number' && Number.isFinite(target) && value !== null) {
    const gap = value - target;
    const goal = t('Target {target}', { target: formatNumber(target, fmt) });
    const where = Math.abs(gap) < 1e-12 ? t('on target') : gap < 0 ? t('{gap} below', { gap: amount(gap, fmt) }) : t('{gap} above', { gap: amount(gap, fmt) });
    const met = (opts.upIsGood ?? true) ? value >= target : value <= target;
    view.target = { value: target, text: `${goal} · ${where}`, tone: toneOf(met, { ...opts, upIsGood: true }) };
  }
  return view;
}

function soFarLabel(period: Period): string {
  return { day: t('Today so far'), week: t('This week so far'), month: t('This month so far'), quarter: t('This quarter so far'), year: t('This year so far') }[period];
}
