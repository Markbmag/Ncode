/**
 * Charts on a phone-wide box (M15): legend under the chart, no axis titles (the card's title and
 * caption say what is shown), fewer value ticks and thinned-out category labels. Pure, tested in
 * tests/dashboardPhone.test.ts.
 */
import type { EChartsOption } from 'echarts';
import type { VizSpec } from './types.ts';

/** Below this width (px) a chart counts as narrow. */
export const NARROW_PX = 440;

export function narrowViz(viz: VizSpec): VizSpec {
  return {
    ...viz,
    legend: viz.legend === 'none' ? 'none' : 'bottom',
    axis: { ...viz.axis, titles: false, xTitle: undefined, yTitle: undefined },
  };
}

type Axis = Record<string, unknown> & { type?: string; axisLabel?: Record<string, unknown> };

// value axes: three ticks; categories along the bottom: thinned out so they never overlap (a list of
// categories down the side, as in horizontal bars, keeps every label: each bar needs its name)
const thin = (axis: Axis, across: boolean): Axis => {
  if (axis.type === 'value') return { ...axis, splitNumber: 3 };
  if (axis.type === 'category' && across) return { ...axis, axisLabel: { ...axis.axisLabel, interval: 'auto', hideOverlap: true } };
  return axis;
};

export function narrowOption(option: EChartsOption | null): EChartsOption | null {
  if (!option) return option;
  const each = (axes: unknown, across: boolean) =>
    Array.isArray(axes) ? axes.map((a) => thin(a as Axis, across)) : axes && typeof axes === 'object' ? thin(axes as Axis, across) : axes;
  return { ...option, xAxis: each(option.xAxis, true), yAxis: each(option.yAxis, false) } as EChartsOption;
}
