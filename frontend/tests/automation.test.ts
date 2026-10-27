import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  changeEvery, describeAlert, describeSchedule, domainAllowed, newSubscription, parseEmails, problem, timeAgo,
} from '../src/automation/logic.ts';
import type { Schedule } from '../src/automation/types.ts';

const base: Schedule = { every: 'day', hour: 8, minute: 0, days: [0, 1, 2, 3, 4], monthday: 1, timezone: 'Europe/Berlin' };

test('schedules read like sentences', () => {
  assert.equal(describeSchedule(base, 'Europe/Berlin'), 'Weekdays at 08:00');
  assert.equal(describeSchedule({ ...base, days: [0, 1, 2, 3, 4, 5, 6] }, 'Europe/Berlin'), 'Every day at 08:00');
  assert.equal(describeSchedule({ ...base, every: 'week', days: [0], hour: 7, minute: 30 }, 'Europe/Berlin'), 'Mondays at 07:30');
  assert.equal(describeSchedule({ ...base, days: [1, 3] }, 'Europe/Berlin'), 'Tue, Thu at 08:00');
  assert.equal(describeSchedule({ ...base, every: 'hour', minute: 15, days: [5, 6] }, 'Europe/Berlin'), 'Every hour at :15 on weekends');
  assert.equal(describeSchedule({ ...base, every: 'month', monthday: -1, hour: 6 }, 'Europe/Berlin'), 'On the last day of every month at 06:00');
  assert.equal(describeSchedule({ ...base, every: 'month', monthday: 2 }, 'Europe/Berlin'), 'On the 2nd of every month at 08:00');
  assert.equal(describeSchedule(base, 'UTC'), 'Weekdays at 08:00 (Europe/Berlin)');
});

test('switching frequency keeps sensible days', () => {
  assert.deepEqual(changeEvery(base, 'week').days, [0]);
  assert.deepEqual(changeEvery({ ...base, every: 'week', days: [3] }, 'week').days, [3]);
  assert.deepEqual(changeEvery({ ...base, every: 'week', days: [3] }, 'day').days, [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(changeEvery({ ...base, every: 'week', days: [3] }, 'hour').days, [0, 1, 2, 3, 4, 5, 6]);
});

test('email lists, domains and validation', () => {
  assert.deepEqual(parseEmails('a@x.com, b@y.org;\nnope a@x.com'), { valid: ['a@x.com', 'b@y.org'], invalid: ['nope'] });
  assert.ok(domainAllowed('a@X.com'.toLowerCase(), ['x.com']));
  assert.ok(!domainAllowed('a@evil.com', ['x.com']));
  assert.ok(domainAllowed('a@evil.com', []));
  const sub = newSubscription('dashboard', 1, null);
  assert.equal(problem(sub), 'Add at least one recipient');
  const alert = newSubscription('question', 1, 'mark', true);
  assert.equal(problem(alert), null);
  assert.equal(alert.schedule.every, 'hour');
  assert.equal(problem({ ...alert, alert: { type: 'above', column: null, value: null, once: false } }), 'Give the value to compare with');
});

test('alerts and times in words', () => {
  assert.equal(describeAlert({ type: 'rows', column: null, value: null, once: true }), 'When there are results, then stop');
  assert.equal(describeAlert({ type: 'below', column: 'stock', value: 10, once: false }), 'When stock drops below 10');
  assert.equal(timeAgo(null), 'never');
  assert.equal(timeAgo(1000, 1000 + 7200), '2 h ago');
  assert.equal(timeAgo(1000 + 300, 1000), 'in 5 min');
});

test('new subscriptions (M10): daily is every day, browser time zone, current filters, email set up or not', () => {
  const sub = newSubscription('dashboard', 1, 'mark', false, { filters: { region: ['EU'] } });
  assert.equal(describeSchedule(sub.schedule, sub.schedule.timezone), 'Every day at 08:00');
  assert.equal(sub.schedule.timezone, Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  assert.deepEqual(sub.options.filters, { region: ['EU'] });
  assert.deepEqual(sub.recipients.users, ['mark']);
  // without email the creator is not added (they could not receive it), and only a destination will do
  const noMail = newSubscription('dashboard', 1, 'mark', false, { emailReady: false });
  assert.deepEqual(noMail.recipients.users, []);
  assert.equal(problem({ ...noMail, recipients: { users: ['mark'], emails: [], destinations: [] } }, false), 'Email is not set up: choose a chat or webhook destination');
  assert.equal(problem({ ...noMail, recipients: { users: [], emails: [], destinations: [3] } }, false), null);
});
