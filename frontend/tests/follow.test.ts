import { test } from 'node:test';
import assert from 'node:assert/strict';
import { digestLabel, followBody, followingOf } from '../src/automation/logic.ts';
import type { Subscription } from '../src/automation/types.ts';

test('following is a digest subscription to yourself', () => {
  const daily = followBody('dashboard', 4, 'alice', 'day', 'Europe/Berlin');
  assert.deepEqual(daily.schedule, { every: 'day', hour: 7, minute: 0, days: [0, 1, 2, 3, 4, 5, 6], monthday: 1, timezone: 'Europe/Berlin' });
  assert.deepEqual(daily.recipients, { users: ['alice'], emails: [], destinations: [] });
  assert.equal(daily.options.digest, 'day');
  assert.equal(daily.alert, null);
  const weekly = followBody('metric', 2, 'alice', 'week', 'UTC');
  assert.equal(weekly.target_type, 'metric');
  assert.deepEqual([weekly.schedule.every, weekly.schedule.days], ['week', [0]]);
});

test('the person follows when they own a digest they receive', () => {
  const sub = (over: Partial<Subscription>): Subscription => ({
    ...followBody('dashboard', 4, 'alice', 'week', 'UTC'), id: 1, target_name: 'Sales', owner: 'alice', can_manage: true,
    next_run_at: null, last_run_at: null, last_status: null, last_error: null, running: false, created_at: 0, updated_at: 0, ...over,
  });
  const plain = sub({ id: 2, options: { ...sub({}).options, digest: null } });
  assert.equal(followingOf([plain], 'alice'), null);
  assert.equal(followingOf([plain, sub({ id: 3 })], 'alice')?.id, 3);
  assert.equal(followingOf([sub({ owner: 'bob', can_manage: false })], 'alice'), null);
  assert.equal(digestLabel('day'), 'Daily digest');
  assert.equal(digestLabel('week'), 'Weekly digest');
  assert.equal(digestLabel(null), null);
});
