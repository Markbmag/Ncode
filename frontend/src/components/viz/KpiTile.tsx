import {
  Box, Flex, Text,
} from '@chakra-ui/react';
import { Tooltip } from '../Tooltip';
import type { Table } from '../../viz/data';
import { formatNumber } from '../../viz/format';
import { kpiView } from '../../viz/kpi';
import type { Tone } from '../../viz/kpi';
import type { ChartTheme } from '../../viz/palette';
import type { VizSpec } from '../../viz/types';
import { columnDescription, titleOf } from '../../viz/labels';
import { t } from '../../i18n/index.ts';

/**
 * Number card (M15): the value large, the period it belongs to, one sentence comparing it with the
 * period before and/or a target, a small trend line. Colour only when it means something: green or
 * red after "going up is good / bad", grey without a comparison. Sizes follow the card's width
 * (container units), so two cards side by side on a phone stay readable.
 */
export function KpiTile({ table, viz, theme }: { table: Table; viz: VizSpec; theme: ChartTheme }) {
  const view = kpiView(table, viz);
  const opts = { sparkline: true, ...viz.kpi };
  const color = (tone: Tone) => (tone === 'good' ? theme.good : tone === 'bad' ? theme.bad : 'mutedText');
  const { column, value, comparison } = view;

  return (
    <Flex
      h="100%"
      direction="column"
      justify="center"
      align="center"
      gap={1}
      px={3}
      py={2}
      textAlign="center"
      overflow="hidden"
      data-testid="kpi"
      // a narrow card (two side by side on a phone) leaves out the column name: the card's title says it
      sx={{ containerType: 'inline-size', '@container (max-width: 240px)': { '.kpi-column': { display: 'none' } } }}
    >
      <Text className="kpi-column" fontSize="sm" color="mutedText" noOfLines={1} title={columnDescription(table.columns.find((c) => c.name === column)) ?? undefined}>
        {column ? titleOf(table.columns, column) : t('No number column')}
      </Text>
      <Text fontSize="clamp(1.9rem, 17cqi, 3.2rem)" fontWeight={650} lineHeight="1.05" color="bodyText" data-testid="kpi-value">
        {value === null ? '—' : formatNumber(value, { compact: Math.abs(value) >= 1e6, ...view.fmt })}
      </Text>
      {view.label && (
        <Text fontSize="sm" color="mutedText" mt={-0.5} data-testid="kpi-period">
          {view.label}
        </Text>
      )}
      {comparison && (
        <Tooltip label={comparison.hint} hasArrow>
          <Text
            fontSize="clamp(0.85rem, 6.5cqi, 1rem)"
            fontWeight={600}
            color={color(comparison.tone)}
            tabIndex={0}
            aria-label={`${comparison.text}. ${comparison.hint}`}
            data-testid="kpi-compare"
            data-tone={comparison.tone}
          >
            {comparison.text}
          </Text>
        </Tooltip>
      )}
      {!comparison && view.noComparison && (
        <Text fontSize="sm" color="faintText" data-testid="kpi-no-compare">
          {view.noComparison}
        </Text>
      )}
      {view.target && (
        <Text fontSize="clamp(0.8rem, 6cqi, 0.95rem)" fontWeight={500} color={color(view.target.tone)} data-testid="kpi-target" data-tone={view.target.tone}>
          {view.target.text}
        </Text>
      )}
      {view.partial && (
        <Text fontSize="xs" color="faintText" data-testid="kpi-partial">
          {view.partial}
        </Text>
      )}
      {opts.sparkline && view.trend.length > 2 && <Sparkline values={view.trend} color={theme.series[0]} muted={theme.deemphasis} />}
    </Flex>
  );
}

function Sparkline({ values, color, muted }: { values: number[]; color: string; muted: string }) {
  const w = 160;
  const h = 32;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * (w - 8) + 4, h - 4 - ((v - min) / span) * (h - 8)]);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const [lx, ly] = pts[pts.length - 1];
  return (
    <Box as="svg" width={`${w}px`} maxW="100%" height={`${h}px`} viewBox={`0 0 ${w} ${h}`} aria-hidden flexShrink={0} mt={1}>
      <path d={path} fill="none" stroke={muted} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={lx} cy={ly} r={3.5} fill={color} />
    </Box>
  );
}
