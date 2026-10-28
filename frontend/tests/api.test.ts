// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { setLangForTests } from '../src/i18n/index.ts';
import { failureDetails, failureMessage, failureRetryable } from '../src/lib/apiError.ts';

test('no answer at all is "not reachable", a server error is not', () => {
  setLangForTests('en');
  assert.match(failureMessage({ answered: false }, 'x'), /not reachable/);
  const crash = { answered: true, status: 500, data: { detail: 'Something went wrong on the server (error id ab12cd).', error_id: 'ab12cd' } };
  assert.equal(failureMessage(crash, 'x'), crash.data.detail);
  assert.match(failureMessage({ answered: true, status: 502, data: '<html>Bad gateway</html>' }, 'x'), /problem \(502\)/);
  assert.equal(failureMessage({ answered: true, status: 404, data: null }, 'Not there'), 'Not there');
});

test('validation errors name the field', () => {
  const data = { detail: [{ loc: ['body', 'username'], msg: 'Field required', type: 'missing' }] };
  assert.equal(failureMessage({ answered: true, status: 422, data }, 'x'), 'username: Field required');
  const noField = { detail: [{ loc: ['body'], msg: 'Value error, bad', type: 'value_error' }] };
  assert.equal(failureMessage({ answered: true, status: 422, data: noField }, 'x'), 'Value error, bad');
});

test('details carry the database text', () => {
  assert.equal(failureDetails({ answered: true, status: 502, data: { detail: 'The query failed: ...', details: 'no such column: qty' } }), 'no such column: qty');
  assert.equal(failureDetails({ answered: true, status: 400, data: { detail: 'x' } }), undefined);
});

test('the Russian UI asks the server for Russian', async () => {
  const src = (await import('node:fs')).readFileSync('src/api.ts', 'utf8');
  assert.match(src, /headers\.set\('Accept-Language', lang\(\)\)/);
  const ws = (await import('node:fs')).readFileSync('src/hooks/useSearch.ts', 'utf8');
  assert.match(ws, /lang: lang\(\)/);
});

test('"Try again" is offered when it can help (M10)', () => {
  assert.equal(failureRetryable({ answered: false }), true);
  assert.equal(failureRetryable({ answered: true, status: 500 }), true);
  assert.equal(failureRetryable({ answered: true, status: 503 }), true);
  assert.equal(failureRetryable({ answered: true, status: 429 }), true);
  assert.equal(failureRetryable({ answered: true, status: 404 }), false);
  assert.equal(failureRetryable({ answered: true, status: 403 }), false);
  assert.equal(failureRetryable(null), true);
});
