/** M15 "Follow": a digest of a dashboard by email, set up with one button, listed on the Subscriptions page. */
import { expect, test } from '@playwright/test';
import { api, newUser, signIn, unique, watchErrors } from './helpers';

// the email server is set up (nothing is sent in these tests)
test.beforeEach(async ({ page }) => {
  await api(page.request, 'admin', 'PUT', '/api/admin/settings/email', {
    host: 'smtp.example.com', port: 587, security: 'starttls', username: '', password: null, from_address: 'ncode@example.com', from_name: 'Ncode',
  });
  await api(page.request, 'admin', 'PUT', '/api/account/email', { email: 'admin@example.com' });
});

test('follow a dashboard: the digest shows on the Subscriptions page, unfollow removes it', async ({ page }) => {
  const errors = watchErrors(page);
  const d = await api(page.request, 'admin', 'POST', '/api/dashboards', { name: unique('Morning shift') });

  await signIn(page, 'admin', `/dashboards/${d.id}`);
  await expect(page.getByTestId('follow-button')).toHaveText('Follow');
  await page.getByTestId('follow-button').click();
  await page.getByTestId('follow-weekly').click();
  await page.getByTestId('follow-confirm').click();
  await expect(page.getByTestId('follow-button')).toHaveText('Following');

  const subs = await api(page.request, 'admin', 'GET', `/api/subscriptions?target_type=dashboard&target_id=${d.id}`);
  const mine = subs.subscriptions.find((s: { options: { digest?: string } }) => s.options.digest);
  expect(mine.options.digest).toBe('week');
  expect(mine.schedule.days).toEqual([0]);
  expect(mine.recipients.users).toEqual(['admin']);

  await page.goto('/subscriptions');
  const item = page.getByTestId('subscription-item').filter({ hasText: d.name });
  await expect(item.getByTestId('digest-badge')).toHaveText('Weekly digest');

  await page.goto(`/dashboards/${d.id}`);
  await page.getByTestId('follow-button').click();
  await page.getByTestId('unfollow').click();
  await expect(page.getByTestId('follow-button')).toHaveText('Follow');
  const after = await api(page.request, 'admin', 'GET', `/api/subscriptions?target_type=dashboard&target_id=${d.id}`);
  expect(after.subscriptions.filter((s: { options: { digest?: string } }) => s.options.digest)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a person without an address gives it right in the Follow box', async ({ page }) => {
  const who = await newUser(page.request, 'foreman');
  const demo = await api(page.request, who, 'GET', '/api/dashboards');
  const list = (demo.dashboards ?? demo.items ?? []) as { id: number; name: string }[];
  test.skip(!list.length, 'no dashboard shared with everyone');
  await signIn(page, who, `/dashboards/${list[0].id}`, 'en', null);
  await page.getByTestId('follow-button').click();
  await expect(page.getByTestId('follow-confirm')).toBeDisabled();
  await page.getByTestId('follow-email').fill(`${who}@example.com`);
  await page.getByTestId('follow-daily').click();
  await page.getByTestId('follow-confirm').click();
  await expect(page.getByTestId('follow-button')).toHaveText('Following');
  const subs = await api(page.request, who, 'GET', '/api/subscriptions');
  expect(subs.subscriptions.map((s: { options: { digest?: string } }) => s.options.digest)).toEqual(['day']);
  const prefs = await api(page.request, who, 'GET', '/api/account/prefs');
  expect(prefs.language).toBe('en'); // the digest is written in the language the person uses
  await page.goto('/subscriptions');
  await expect(page.getByTestId('digest-badge')).toHaveText('Daily digest');
});
