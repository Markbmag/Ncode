/**
 * The builder's steps (M11 progressive disclosure): Data · Filter · Summarise are always shown;
 * the others wait under "More steps" until the question uses them or someone opens one.
 * Pure, tested in tests/caption.test.ts.
 */
import { isSummarised } from './draft.ts';
import type { QuerySpec } from './types.ts';

export type ExtraStep = 'join' | 'custom' | 'having' | 'columns' | 'sort' | 'calculate' | 'limit';

/** In the order they appear in the builder (and in the "More steps" list). */
export const EXTRA_STEPS: ExtraStep[] = ['join', 'custom', 'having', 'columns', 'sort', 'calculate', 'limit'];

/** The extra steps this question already uses: they are shown without asking. */
export function usedSteps(spec: QuerySpec | null | undefined): Set<ExtraStep> {
  const out = new Set<ExtraStep>();
  if (!spec) return out;
  if ((spec.joins ?? []).length > 0) out.add('join');
  if ((spec.expressions ?? []).length > 0) out.add('custom');
  if ((spec.having?.rules ?? []).length > 0) out.add('having');
  if ((spec.fields ?? []).length > 0) out.add('columns');
  if ((spec.order ?? []).length > 0) out.add('sort');
  if ((spec.transforms ?? []).length > 0) out.add('calculate');
  if (spec.limit) out.add('limit');
  return out;
}

/** Steps that make sense now: "Filter the summary" needs a summary, "Columns" needs rows. */
export function applicableSteps(spec: QuerySpec | null | undefined): ExtraStep[] {
  const summarised = !!spec && isSummarised(spec);
  return EXTRA_STEPS.filter((s) => (s === 'having' ? summarised : s === 'columns' ? !summarised : true));
}
