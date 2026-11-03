/**
 * Ready questions for a table (M12), built from its column types and the data model: a count per
 * month, a total per category, the top 10 by a number, the share of each category, an average per
 * category, a total per category per week. Shown after a table is picked, in the quick question and
 * in the builder's Data step; clicking one fills the question.
 *
 * Categories are the table's own (status, colour) and the names of related rows in place of their
 * ids ("Reason", "Line" through the work order), so "Total Duration, min per Line" groups by line
 * names. The data model's kind of column helps choose: a "name" (part, inspector: many values) for
 * the top 10, a "category" (shift, reason: few values) for the shares. Pure, tested in tests/quick.test.ts.
 */
import { t } from '../i18n/index.ts';
import { columnOptions, summaryOutputs } from '../query/draft.ts';
import type { SchemaInfo } from '../query/draft.ts';
import type { QuerySpec } from '../query/types.ts';
import type { VizState } from '../viz/state.ts';
import { quickSpec, startParts } from './quick.ts';
import type { QuickColumn, QuickModel, QuickParts } from './quick.ts';

export interface Suggestion {
  key: string;
  title: string;
  parts: QuickParts;
  spec: QuerySpec;
  /** how to show it; null: the automatic chart */
  viz: VizState;
}

export const MAX_SUGGESTIONS = 6;

/** Up to six ready questions for the model's table (fewer when it has little to offer). */
export function suggestQuestions(model: QuickModel, schema: SchemaInfo, connection: string): Suggestion[] {
  const base = startParts(model.table);
  const number = model.numbers[0] ?? null;
  const date = model.dates[0] ?? null;
  const cats = model.categories;
  const a = cats[0] ?? null;
  const others = (...not: (QuickColumn | null)[]) => cats.filter((c) => !not.includes(c));
  const b = others(a).find((c) => c.semantic === 'name') ?? others(a)[0] ?? a;
  const taken = number ? [a, b] : [a]; // without a number there is no top 10
  const c = others(...taken).find((x) => x.semantic === 'category') ?? others(...taken)[0] ?? a;
  const d = others(...taken, c)[0] ?? a;
  const sum = number ? { fn: 'sum' as const, ref: number.ref } : { fn: 'count' as const };
  const names = { number: number?.label ?? '' };

  const out: { key: string; title: string; parts: QuickParts; pie: boolean }[] = [];
  const add = (key: string, title: string, parts: Partial<QuickParts>, pie = false) => out.push({ key, title, parts: { ...base, ...parts }, pie });
  if (a) {
    if (number) add('total', t('Total {number} per {category}', { ...names, category: a.label }), { see: sum, category: a.ref });
    else add('count', t('Count per {category}', { category: a.label }), { category: a.ref });
  }
  if (b && number) add('top', t('Top 10 {category} by {number}', { ...names, category: b.label }), { see: sum, category: b.ref, top: 10 });
  if (c) add('share', t('Share by {category}', { category: c.label }), { category: c.ref }, true);
  if (date) add('month', t('Count per month'), { time: { ref: date.ref, bucket: 'month' } });
  if (a && date) {
    if (number) add('weekly', t('Total {number} per {category} per week', { ...names, category: a.label }), { see: sum, category: a.ref, time: { ref: date.ref, bucket: 'week' } });
    else add('weekly', t('Count per {category} per week', { category: a.label }), { category: a.ref, time: { ref: date.ref, bucket: 'week' } });
  }
  if (d && number) add('average', t('Average {number} per {category}', { ...names, category: d.label }), { see: { fn: 'avg', ref: number.ref }, category: d.ref });
  // a table without categories: its number over time, and in total
  if (!a && number && date) add('total_month', t('Total {number} per month', names), { see: sum, time: { ref: date.ref, bucket: 'month' } });
  if (!a && number) add('total_all', t('Total {number}', names), { see: sum });

  const seen = new Set<string>();
  return out
    .filter((s) => !seen.has(s.title) && !!seen.add(s.title))
    .slice(0, MAX_SUGGESTIONS)
    .map(({ key, title, parts, pie }) => {
      const spec = quickSpec(connection, parts, model, schema);
      return { key, title, parts, spec, viz: pie ? pieOf(spec, schema) : { mode: 'chart', spec: null } };
    });
}

/** Shares are a pie of the value per category (named as the result columns will be). */
function pieOf(spec: QuerySpec, schema: SchemaInfo): VizState {
  const outputs = summaryOutputs(spec, columnOptions(spec, schema));
  const x = outputs.find((o) => o.kind === 'breakout')?.name;
  const value = outputs.find((o) => o.kind === 'aggregation')?.name;
  return { mode: 'chart', spec: x && value ? { version: 1, type: 'pie', x, value } : null };
}
