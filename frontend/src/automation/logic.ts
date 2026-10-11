/** Pure helpers for subscriptions and alerts: describing schedules, defaults, validation. */
import type { AlertCondition, Recipients, Schedule, SubscriptionBody, TargetType } from './types';

export const DAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export const DAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS = [0, 1, 2, 3, 4];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export const pad2 = (n: number) => String(n).padStart(2, '0');
export const clock = (hour: number, minute: number) => `${pad2(hour)}:${pad2(minute)}`;

const sameDays = (a: number[], b: number[]) => a.length === b.length && a.every((d, i) => d === b[i]);

function dayList(days: number[]): string {
  const sorted = [...days].sort((a, b) => a - b);
  if (sameDays(sorted, ALL_DAYS)) return 'every day';
  if (sameDays(sorted, WEEKDAYS)) return 'weekdays';
  if (sameDays(sorted, [5, 6])) return 'weekends';
  if (sorted.length === 1) return `${DAY_NAMES[sorted[0]]}s`;
  return sorted.map((d) => DAY_SHORT[d]).join(', ');
}

const ordinal = (n: number) => {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[n % 10] ?? 'th';
  return `${n}${s}`;
};

/** "Weekdays at 08:00", "Every hour at :15 on weekends", "On the last day of the month at 06:00 (Europe/Berlin)". */
export function describeSchedule(s: Schedule, localZone = browserTimeZone()): string {
  const zone = s.timezone && s.timezone !== localZone ? ` (${s.timezone})` : '';
  const at = clock(s.hour, s.minute);
  let text: string;
  if (s.every === 'hour') {
    const days = dayList(s.days);
    text = `Every hour at :${pad2(s.minute)}${days === 'every day' ? '' : ` on ${days}`}`;
  } else if (s.every === 'month') {
    text = `${s.monthday === -1 ? 'On the last day' : `On the ${ordinal(s.monthday)}`} of every month at ${at}`;
  } else {
    const days = dayList(s.days);
    text = days === 'every day' ? `Every day at ${at}` : `${days.charAt(0).toUpperCase()}${days.slice(1)} at ${at}`;
  }
  return text + zone;
}

export function defaultSchedule(): Schedule {
  return { every: 'day', hour: 8, minute: 0, days: WEEKDAYS, monthday: 1, timezone: browserTimeZone() };
}

/** Switching the frequency keeps sensible days: a weekly schedule starts on Monday. */
export function changeEvery(s: Schedule, every: Schedule['every']): Schedule {
  if (every === 'week') return { ...s, every, days: s.days.length === 1 ? s.days : [0] };
  if ((every === 'day' || every === 'hour') && s.every === 'week') return { ...s, every, days: every === 'hour' ? ALL_DAYS : WEEKDAYS };
  return { ...s, every };
}

export function emptyRecipients(): Recipients {
  return { users: [], emails: [], destinations: [] };
}

export function newSubscription(target_type: TargetType, target_id: number, me: string | null, alert = false): SubscriptionBody {
  return {
    name: '',
    target_type,
    target_id,
    schedule: alert ? { ...defaultSchedule(), every: 'hour', minute: 0, days: ALL_DAYS } : defaultSchedule(),
    recipients: { ...emptyRecipients(), users: me ? [me] : [] },
    options: { filters: {}, attach: 'none', rows: 10, skip_empty: false, message: '' },
    alert: alert ? { type: 'rows', column: null, value: null, once: false } : null,
    enabled: true,
  };
}

export function describeAlert(a: AlertCondition): string {
  const once = a.once ? ', then stop' : '';
  if (a.type === 'rows') return `When there are results${once}`;
  const col = a.column ? `${a.column} ` : '';
  return `When ${col}${a.type === 'above' ? 'goes above' : 'drops below'} ${a.value ?? '?'}${once}`;
}

export function recipientCount(r: Recipients): number {
  return r.users.length + r.emails.length + r.destinations.length;
}

/** Splits what someone typed into addresses: commas, semicolons, spaces and new lines all separate. */
export function parseEmails(text: string): { valid: string[]; invalid: string[] } {
  const parts = text.split(/[\s,;]+/).map((p) => p.trim()).filter(Boolean);
  const valid: string[] = [];
  const invalid: string[] = [];
  for (const p of parts) (/^[^@\s<>,;"']+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(p) ? valid : invalid).push(p);
  return { valid: [...new Set(valid)], invalid };
}

export function domainAllowed(email: string, domains: string[]): boolean {
  if (!domains.length) return true;
  return domains.includes(email.split('@').pop()!.toLowerCase());
}

/** Why the form cannot be saved yet, or null. */
export function problem(body: SubscriptionBody): string | null {
  if (recipientCount(body.recipients) === 0) return 'Add at least one recipient';
  if ((body.schedule.every === 'day' || body.schedule.every === 'week' || body.schedule.every === 'hour') && !body.schedule.days.length)
    return 'Choose at least one day';
  if (body.alert && body.alert.type !== 'rows' && (body.alert.value === null || Number.isNaN(body.alert.value)))
    return 'Give the value to compare with';
  return null;
}

export function timeAgo(ts: number | null, now = Date.now() / 1000): string {
  if (!ts) return 'never';
  const d = now - ts;
  const future = d < 0;
  const a = Math.abs(d);
  const unit = a < 60 ? 'less than a minute' : a < 3600 ? `${Math.round(a / 60)} min` : a < 86400 ? `${Math.round(a / 3600)} h` : `${Math.round(a / 86400)} days`;
  if (a < 60) return future ? 'in a moment' : 'just now';
  return future ? `in ${unit}` : `${unit} ago`;
}

export const STATUS_LABEL: Record<string, { label: string; color: string }> = {
  running: { label: 'sending…', color: 'blue' },
  sent: { label: 'sent', color: 'green' },
  skipped: { label: 'not sent', color: 'gray' },
  partial: { label: 'partly sent', color: 'orange' },
  error: { label: 'failed', color: 'red' },
};
