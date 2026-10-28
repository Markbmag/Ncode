import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const API = 'http://127.0.0.1:8765';

export const USERS = {
  admin: 'admin-pass-1',
  carol: 'carol-pass-1',
  alice: 'alice-pass-1',
} as const;
export type Who = keyof typeof USERS;

/** A session token from the API (faster than the sign-in form, which has its own test). */
export async function token(request: APIRequestContext, who: Who): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, { data: { username: who, password: USERS[who] } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).token as string;
}

/** Opens `path` signed in as `who`, in English unless `lang` says otherwise. */
export async function signIn(page: Page, who: Who, path = '/', lang: 'en' | 'ru' = 'en'): Promise<string> {
  const t = await token(page.request, who);
  await page.addInitScript(([value, language]) => {
    // only on the first load: the app itself may change these later (language switch, sign-out)
    if (sessionStorage.getItem('e2e_init')) return;
    sessionStorage.setItem('e2e_init', '1');
    localStorage.setItem('ncode_token', value);
    localStorage.setItem('ncode_lang', language);
  }, [t, lang]);
  await page.goto(path);
  return t;
}

/** Calls the API as `who` and returns the JSON body. */
export async function api(request: APIRequestContext, who: Who, method: string, path: string, data?: unknown): Promise<Record<string, any>> { // eslint-disable-line @typescript-eslint/no-explicit-any -- test data
  const res = await request.fetch(`${API}${path}`, {
    method,
    data,
    headers: { Authorization: `Bearer ${await token(request, who)}` },
  });
  expect(res.ok(), `${method} ${path} -> ${res.status()} ${await res.text()}`).toBeTruthy();
  return res.json();
}

/** Fails the test on uncaught page errors and console errors other than expected HTTP refusals. */
export function watchErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/\b(40\d|409|429)\b/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

/** No sideways scrolling (phone layouts). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, `${page.url()} scrolls sideways by ${overflow}px`).toBeLessThanOrEqual(1);
}

export const unique = (prefix: string) => `${prefix} ${Date.now().toString(36)}`;
