/**
 * What a destructive builder change would remove (M12: such changes ask first), in plain words:
 * "Changing the table removes 2 filters and the summary." Pure, tested in tests/preview.test.ts.
 */
import { isSummarised } from './draft.ts';
import type { ExtraStep } from './steps.ts';
import type { FilterGroup, QuerySpec } from './types.ts';
import { isGroup } from './types.ts';
import { t, tn } from '../i18n/index.ts';

export interface Loss {
  joins: number;
  formulas: number;
  filters: number;
  summary: boolean; // with its "filter the summary"
  columns: boolean;
  sort: boolean;
  calculations: number;
  limit: boolean;
}

const NONE: Loss = { joins: 0, formulas: 0, filters: 0, summary: false, columns: false, sort: false, calculations: 0, limit: false };

/** Filter conditions that say something (a column is picked), through and/or groups. */
export function countConditions(group: FilterGroup | null | undefined): number {
  if (!group) return 0;
  return group.rules.reduce((n, rule) => n + (isGroup(rule) ? countConditions(rule) : rule.ref || rule.expr ? 1 : 0), 0);
}

function lossOf(spec: QuerySpec): Loss {
  return {
    joins: (spec.joins ?? []).filter((j) => j.table).length,
    formulas: (spec.expressions ?? []).length,
    filters: countConditions(spec.filters),
    summary: isSummarised(spec),
    columns: (spec.fields ?? []).length > 0,
    sort: (spec.order ?? []).some((o) => o.ref),
    calculations: (spec.transforms ?? []).length,
    limit: !!spec.limit,
  };
}

/** Picking another table starts the question again; only the row limit is kept. */
export function tableChangeLoss(spec: QuerySpec | null | undefined): Loss {
  return spec ? { ...lossOf(spec), limit: false } : NONE;
}

/** Removing one of the steps under "More steps" removes what is in it. */
export function stepLoss(spec: QuerySpec | null | undefined, step: ExtraStep): Loss {
  if (!spec) return NONE;
  const all = lossOf(spec);
  switch (step) {
    case 'join':
      return { ...NONE, joins: all.joins };
    case 'custom':
      return { ...NONE, formulas: all.formulas };
    case 'having':
      return { ...NONE, filters: countConditions(spec.having) };
    case 'columns':
      return { ...NONE, columns: all.columns };
    case 'sort':
      return { ...NONE, sort: all.sort };
    case 'calculate':
      return { ...NONE, calculations: all.calculations };
    case 'limit':
      return { ...NONE, limit: all.limit };
  }
}

/** What the step holds is cleared from the spec. */
export function withoutStep(spec: QuerySpec, step: ExtraStep): QuerySpec {
  const out: QuerySpec = { ...spec };
  if (step === 'join') out.joins = [];
  if (step === 'custom') out.expressions = [];
  if (step === 'having') out.having = null;
  if (step === 'columns') out.fields = [];
  if (step === 'sort') out.order = [];
  if (step === 'calculate') out.transforms = [];
  if (step === 'limit') out.limit = null;
  return out;
}

/** "A, B and C" */
export function listText(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? '';
  return t('{list} and {last}', { list: parts.slice(0, -1).join(', '), last: parts[parts.length - 1] });
}

/** "2 filters and the summary"; null when nothing would be lost (then there is nothing to ask). */
export function lossText(loss: Loss): string | null {
  const parts: string[] = [];
  if (loss.joins) parts.push(tn(loss.joins, 'the data from {n} other table', 'the data from {n} other tables'));
  if (loss.formulas) parts.push(tn(loss.formulas, '{n} formula column', '{n} formula columns'));
  if (loss.filters) parts.push(tn(loss.filters, '{n} filter', '{n} filters'));
  if (loss.summary) parts.push(t('the summary'));
  if (loss.columns) parts.push(t('the chosen columns'));
  if (loss.sort) parts.push(t('the sorting'));
  if (loss.calculations) parts.push(tn(loss.calculations, '{n} calculation', '{n} calculations'));
  if (loss.limit) parts.push(t('the row limit'));
  return parts.length ? listText(parts) : null;
}
