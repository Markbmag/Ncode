// Run with: npm test
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  bodyOf, canSave, draftOf, groupByLetter, linkKey, otherNames, splitSynonyms, termDefinition, termName, termsFor,
} from '../src/glossary/logic.ts';
import type { GlossaryTerm } from '../src/glossary/logic.ts';
import { queryChanged, stableJson, verifiedTooltip } from '../src/library/verified.ts';
import { setLangForTests } from '../src/i18n/index.ts';

const term = (id: number, name: string, extra: Partial<GlossaryTerm> = {}): GlossaryTerm => ({
  id, term: name, definition: `${name} means something`, translations: {}, synonyms: [], related: [], archived: false,
  created_at: 0, updated_at: 0, updated_by: 'admin', ...extra,
});

const SCRAP = term(1, 'Scrap rate', {
  definition: 'Share of parts thrown away',
  translations: { ru: { term: 'Коэффициент брака' } }, // no Russian definition: the base one shows
  synonyms: ['Брак', 'scrap RATE', 'defect rate'],
  related: [
    { kind: 'metric', id: 3, name: 'Scrap %' },
    { kind: 'column', connection: 'mes', table: 'scrap', column: 'rate' },
    { kind: 'question', id: 7, name: 'Scrap by line', missing: true },
  ],
});

test('a term shows in the UI language and falls back to the base text', () => {
  setLangForTests('ru');
  assert.equal(termName(SCRAP), 'Коэффициент брака');
  assert.equal(termDefinition(SCRAP), 'Share of parts thrown away');
  assert.deepEqual(otherNames(SCRAP), ['Scrap rate', 'Брак', 'defect rate']); // the shown name and repeats left out
  setLangForTests('en');
  assert.equal(termName(SCRAP), 'Scrap rate');
  assert.deepEqual(otherNames(SCRAP), ['Коэффициент брака', 'Брак', 'defect rate']);
});

test('the list is alphabetical by the name shown, grouped by its first letter', () => {
  const terms = [term(1, 'takt'), term(2, 'OEE'), term(3, 'Downtime'), term(4, '5S'), term(5, 'Брак'), term(6, 'Overtime')];
  setLangForTests('en');
  assert.deepEqual(
    groupByLetter(terms).map((g) => [g.letter, g.terms.map((x) => x.term)]),
    [['#', ['5S']], ['D', ['Downtime']], ['O', ['OEE', 'Overtime']], ['T', ['takt']], ['Б', ['Брак']]],
  );
  setLangForTests('ru');
  const ru = [term(1, 'Takt', { translations: { ru: { term: 'Такт' } } }), term(2, 'Availability', { translations: { ru: { term: 'Доступность' } } })];
  assert.deepEqual(groupByLetter(ru).map((g) => g.letter), ['Д', 'Т']);
  setLangForTests('en');
});

test('the terms that explain a metric or a column', () => {
  const archived = term(2, 'Old scrap', { archived: true, related: [{ kind: 'metric', id: 3 }] });
  const other = term(3, 'OEE', { related: [{ kind: 'column', connection: 'mes', table: 'scrap', column: 'qty' }] });
  const all = [SCRAP, archived, other];
  assert.deepEqual(termsFor(all, { metric: 3 }).map((x) => x.id), [1]);
  assert.deepEqual(termsFor(all, { connection: 'mes', table: 'scrap', column: 'rate' }).map((x) => x.id), [1]);
  assert.deepEqual(termsFor(all, { connection: 'mes', table: 'scrap', column: 'qty' }).map((x) => x.id), [3]);
  assert.deepEqual(termsFor(all, { connection: 'les', table: 'scrap', column: 'rate' }), []);
  assert.deepEqual(termsFor(undefined, { metric: 3 }), []);
  assert.equal(linkKey({ kind: 'column', connection: 'mes', table: 'scrap', column: 'rate' }), 'column:mes:scrap:rate');
});

test('the editor form round-trips a term, sending only what identifies the links', () => {
  const draft = draftOf(SCRAP);
  assert.equal(draft.synonyms, 'Брак, scrap RATE, defect rate');
  const body = bodyOf({ ...draft, ruDefinition: '  Доля деталей в браке ' }, { ...SCRAP, translations: { ...SCRAP.translations, de: { term: 'Ausschussquote' } } });
  assert.deepEqual(body.translations, { ru: { term: 'Коэффициент брака', definition: 'Доля деталей в браке' }, de: { term: 'Ausschussquote' } });
  assert.deepEqual(body.related, [
    { kind: 'metric', id: 3 },
    { kind: 'column', connection: 'mes', table: 'scrap', column: 'rate' },
    { kind: 'question', id: 7 },
  ]);
  const cleared = bodyOf({ ...draft, ruTerm: ' ', ruDefinition: '' }, SCRAP);
  assert.deepEqual(cleared.translations, {});
  assert.deepEqual(splitSynonyms('a, b;c\n , '), ['a', 'b', 'c']);
  assert.equal(canSave(draftOf(null)), false);
  assert.equal(canSave({ ...draftOf(null), term: 'OEE', definition: 'A × P × Q' }), true);
});

// ---------------------------------------------------------------- verified content

const SAVED = {
  kind: 'builder',
  connection: 'shop',
  spec: { connection: 'shop', source: { table: 'orders' }, aggregations: [{ fn: 'count', alias: 'n' }] },
  parameters: [{ name: 'since', label: null, type: 'date', default: null, required: false }],
};

test('only a changed query warns that the Verified badge goes', () => {
  // the editor's payload: the same query with keys in another order, a chart and fewer defaults
  const same = {
    kind: 'builder',
    spec: { aggregations: [{ alias: 'n', fn: 'count' }], source: { table: 'orders' }, connection: 'shop', limit: undefined },
    parameters: [{ name: 'since', type: 'date' }],
    viz: { mode: 'chart' },
  };
  assert.equal(queryChanged(SAVED, same), false);
  assert.equal(queryChanged(SAVED, { ...same, spec: { ...same.spec, source: { table: 'customers' } } }), true);
  assert.equal(queryChanged(SAVED, { ...same, parameters: [{ name: 'since', type: 'date', default: '2026-01-01' }] }), true);
  assert.equal(queryChanged(SAVED, null), false);
  const sql = { kind: 'sql', connection: 'shop', spec: { sql: 'SELECT 1', limit: 100 }, parameters: [] };
  assert.equal(queryChanged(sql, { ...sql, connection: 'mes' }), true);
  assert.equal(queryChanged(sql, { ...sql, spec: { sql: 'SELECT 2', limit: 100 } }), true);
  const fed = { kind: 'federated', connection: '', spec: { sources: [{ alias: 'a' }], result_columns: [{ name: 'x', type: 'number' }] }, parameters: [] };
  assert.equal(queryChanged(fed, { ...fed, connection: undefined, spec: { sources: [{ alias: 'a' }], result_columns: [] } }), false);
  assert.equal(stableJson({ b: 1, a: [undefined, { d: undefined, c: 2 }] }), '{"a":[null,{"c":2}],"b":1}');
});

test('the badge tooltip says who checked it and when', () => {
  setLangForTests('en');
  const text = verifiedTooltip({ by: 'anna', at: Date.UTC(2026, 9, 1, 12) / 1000 });
  assert.match(text, /^Checked by anna on .*2026.*: this is the official answer$/);
  setLangForTests('ru');
  assert.match(verifiedTooltip({ by: 'anna', at: Date.UTC(2026, 9, 1, 12) / 1000 }), /^Проверено: anna, .*2026.*\. Это официальный ответ$/);
  setLangForTests('en');
});
