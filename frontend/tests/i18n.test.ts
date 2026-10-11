import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ruForm, setLangForTests, t, tn } from '../src/i18n/index.ts';
import { RU } from '../src/i18n/ru/index.ts';

test('English is the key and the fallback', () => {
  setLangForTests('en');
  assert.equal(t('Save'), 'Save');
  assert.equal(t('{n} rows found', { n: 3 }), '3 rows found');
  assert.equal(tn(1, '{n} row', '{n} rows'), '1 row');
  assert.equal(tn(5, '{n} row', '{n} rows'), '5 rows');
  setLangForTests('ru');
  assert.equal(t('A text nobody translated'), 'A text nobody translated');
  setLangForTests('en');
});

test('Russian plural forms', () => {
  assert.deepEqual([1, 2, 4, 5, 11, 12, 14, 21, 22, 25, 101, 111].map(ruForm), [0, 1, 1, 2, 2, 2, 2, 0, 1, 2, 0, 2]);
});

test('every Russian text keeps the placeholders of its English key', () => {
  const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
  for (const [en, ru] of Object.entries(RU)) {
    if (en.includes('|')) {
      const forms = ru.split('|');
      assert.equal(forms.length, 3, `plural "${en}" needs three Russian forms`);
      for (const f of forms) assert.equal(names(f), names(en.split('|')[1]), `placeholders of "${en}"`);
    } else {
      assert.equal(names(ru), names(en), `placeholders of "${en}"`);
    }
    assert.ok(ru.trim() !== '', `empty translation for "${en}"`);
  }
});
