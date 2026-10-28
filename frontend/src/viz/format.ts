/**
 * Number and date formatting for charts, KPI tiles and tables, with per-column
 * overrides from VizSpec.format.
 */
import type { ColumnType } from '../api';
import type { ColumnFormat, DateStyle } from './types.ts';

import { lang, t } from '../i18n/index.ts';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthName = (mo: string | number) => (MONTHS[Number(mo) - 1] ? t(MONTHS[Number(mo) - 1]) : String(mo));
const pad2 = (n: string | number) => String(n).padStart(2, '0');

/**
 * A day in the one date style of the language (M10): English "12 Oct 2026", Russian "12.10.2026".
 * Results, tables, charts and admin lists all use it.
 */
export function dayText(y: string | number, mo: string | number, d: string | number): string {
  return lang() === 'ru' ? `${pad2(d)}.${pad2(mo)}.${y}` : `${Number(d)} ${monthName(mo)} ${y}`;
}

/** A moment (a Date or epoch milliseconds) in local time: the day, with the time when asked for. */
export function localDateText(when: Date | number, withTime = false): string {
  const d = typeof when === 'number' ? new Date(when) : when;
  const day = dayText(d.getFullYear(), d.getMonth() + 1, d.getDate());
  return withTime ? `${day} ${pad2(d.getHours())}:${pad2(d.getMinutes())}` : day;
}

export function formatNumber(value: number, fmt: ColumnFormat = {}, locale?: string): string {
  if (!Number.isFinite(value)) return String(value);
  const style = fmt.style ?? 'auto';
  const options: Intl.NumberFormatOptions = {};
  let v = value;
  if (style === 'currency') {
    options.style = 'currency';
    options.currency = (fmt.currency || 'USD').toUpperCase();
  } else if (style === 'percent') {
    options.style = 'percent';
    if (fmt.percentIsFraction === false) v = value / 100;
  } else if (style === 'plain') {
    options.useGrouping = false;
  }
  if (fmt.compact) {
    options.notation = 'compact';
    options.maximumFractionDigits = fmt.decimals ?? 1;
  } else if (fmt.decimals !== undefined && fmt.decimals !== null) {
    options.minimumFractionDigits = fmt.decimals;
    options.maximumFractionDigits = fmt.decimals;
  } else if (style !== 'currency') {
    options.maximumFractionDigits = style === 'percent' ? 1 : Math.abs(v) >= 100 ? 1 : 4;
  }
  let text: string;
  try {
    text = new Intl.NumberFormat(locale, options).format(v);
  } catch {
    text = String(v); // unknown currency code
  }
  return `${fmt.prefix ?? ''}${text}${fmt.suffix ?? ''}`;
}

/** Axis ticks: clean and short (0 / 1K / 2.5M), keeping the column's prefix/suffix/percent. */
export function formatAxisNumber(value: number, fmt: ColumnFormat = {}): string {
  const big = Math.abs(value) >= 1000;
  return formatNumber(value, { ...fmt, compact: fmt.compact || big, decimals: big ? 1 : fmt.decimals });
}

/** Guess the date granularity from a column name the builder made (created_at_month ...). */
export function dateStyleFromName(name: string): DateStyle {
  const m = /_(minute|hour|day|week|month|quarter|year)$/.exec(name);
  if (!m) return 'auto';
  if (m[1] === 'minute' || m[1] === 'hour') return 'datetime';
  return m[1] as DateStyle;
}

export function formatDate(value: string, style: DateStyle): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(value);
  if (!m) return value;
  const [, y, mo, d, h, mi, sec] = m;
  const day = dayText(y, mo, d);
  switch (style) {
    case 'year':
      return y;
    case 'quarter':
      return t('Q{q} {year}', { q: Math.floor((Number(mo) - 1) / 3) + 1, year: y });
    case 'month':
      return `${monthName(mo)} ${y}`;
    case 'week':
      return t('Week of {date}', { date: day });
    case 'day':
      return day;
    case 'datetime':
      return h !== undefined ? `${day} ${h}:${mi}` : day;
    default:
      // a plain date or timestamp: the time only when there is one (seconds only when not :00)
      if (h === undefined || (h === '00' && mi === '00' && (sec ?? '00') === '00')) return day;
      return `${day} ${h}:${mi}${sec && sec !== '00' ? `:${sec}` : ''}`;
  }
}

/** One value of a result column, as shown in charts, tooltips and KPI tiles. */
export function formatCell(value: unknown, type: ColumnType, name: string, fmt: ColumnFormat = {}): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'number') return formatNumber(value, fmt);
  if ((type === 'date' || type === 'datetime') && typeof value === 'string') {
    return formatDate(value, fmt.date && fmt.date !== 'auto' ? fmt.date : dateStyleFromName(name));
  }
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}
