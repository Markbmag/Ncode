import { suggestViz, vizFits } from './autoViz.ts';
import type { Table } from './data.ts';
import type { VizSpec } from './types.ts';

/** What a results panel shows: the table, or a chart (spec null = chosen automatically). */
export interface VizState {
  mode: 'table' | 'chart';
  spec: VizSpec | null;
}

export const DEFAULT_VIZ: VizState = { mode: 'table', spec: null };

/** The spec to draw: the saved one if it still fits the result, otherwise the automatic choice. */
export function effectiveViz(state: VizState, table: Table): { spec: VizSpec; auto: boolean; stale: boolean } {
  if (state.spec && vizFits(state.spec, table)) return { spec: state.spec, auto: false, stale: false };
  return { spec: suggestViz(table), auto: true, stale: state.spec !== null };
}

/**
 * The view actually shown. A chart chosen automatically that comes out as a plain table (nothing to
 * draw, e.g. after the question moved to another table) shows as the table, so the Table/Chart switch
 * never says "Chart" over a table (M10).
 */
export function shownMode(state: VizState, effective: { spec: VizSpec; auto: boolean } | null): 'table' | 'chart' {
  if (state.mode !== 'chart' || !effective) return 'table';
  return effective.auto && effective.spec.type === 'table' ? 'table' : 'chart';
}

/**
 * A starting chart when the automatic choice found nothing to draw but the person asks for a chart:
 * bars of the first number per the first other column. Null when the result has no number at all.
 */
export function startingChart(table: Table): VizSpec | null {
  const number = table.columns.find((c) => c.type === 'number' && c.role === 'measure') ?? table.columns.find((c) => c.type === 'number');
  if (!number || table.rows.length === 0) return null;
  const x = table.columns.find((c) => c !== number && c.type !== 'number') ?? table.columns.find((c) => c !== number);
  return { version: 1, type: 'bar', x: x?.name, series: [{ y: number.name }] };
}
