/**
 * Preview per step (M12): the question cut off after one builder step - the rows after the join,
 * after the filters, after the summary - and asked for its first rows only. It runs like the
 * question itself (POST /api/query), so the same row rules apply. Pure, tested in tests/preview.test.ts.
 */
import { prepareSpec } from './draft.ts';
import type { SchemaInfo } from './draft.ts';
import type { ExtraStep } from './steps.ts';
import type { QuerySpec } from './types.ts';
import { bindSpec } from '../library/params.ts';
import type { ParamValues, ParameterDef } from '../library/params.ts';
import { t } from '../i18n/index.ts';

export type PreviewStep = 'data' | 'filter' | 'summarise' | ExtraStep;

/** The order in which the builder's steps apply. */
export const PREVIEW_ORDER: PreviewStep[] = ['data', 'join', 'custom', 'filter', 'summarise', 'having', 'columns', 'sort', 'calculate', 'limit'];
export const PREVIEW_ROWS = 10;

/** The question up to and including `step`, limited to its first rows. */
export function specUpTo(spec: QuerySpec, step: PreviewStep, rows = PREVIEW_ROWS): QuerySpec {
  const upTo = PREVIEW_ORDER.indexOf(step);
  const has = (s: PreviewStep) => PREVIEW_ORDER.indexOf(s) <= upTo;
  const out: QuerySpec = { version: 1, connection: spec.connection, source: spec.source };
  if (has('join') && spec.joins?.length) out.joins = spec.joins;
  if (has('custom') && spec.expressions?.length) out.expressions = spec.expressions;
  if (has('filter') && spec.filters) out.filters = spec.filters;
  if (has('summarise')) {
    if (spec.aggregations?.length) out.aggregations = spec.aggregations;
    if (spec.breakouts?.length) out.breakouts = spec.breakouts;
  }
  if (has('having') && spec.having) out.having = spec.having;
  if (has('columns') && spec.fields?.length) out.fields = spec.fields;
  if (has('sort') && spec.order?.length) out.order = spec.order;
  if (has('calculate') && spec.transforms?.length) out.transforms = spec.transforms;
  out.limit = has('limit') && spec.limit ? Math.min(spec.limit, rows) : rows;
  return out;
}

export interface StepRequest {
  spec: QuerySpec;
  problems: string[]; // shown instead of running
}

/** What the preview of `step` sends: cut, cleaned like the question and with its parameter values. */
export function previewRequest(draft: QuerySpec, step: PreviewStep, schema: SchemaInfo, defs: ParameterDef[], values: ParamValues): StepRequest {
  const prepared = prepareSpec(specUpTo(draft, step), schema);
  const bound = bindSpec(prepared.spec, defs, values);
  return { spec: bound.value, problems: [...prepared.problems, ...bound.missing.map((m) => t('Give a value for “{name}”', { name: m }))] };
}
