import {
  Box, Button, ButtonGroup, Checkbox, Divider, Flex, FormControl, FormLabel, HStack, IconButton, Input, Select, SimpleGrid, Switch,
  Text, Tooltip, VStack,
} from '@chakra-ui/react';
import type { ReactNode } from 'react';
import type { ResultColumn } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import { CATEGORICAL, MAX_SERIES } from '../../viz/palette';
import { CHART_TYPES } from '../../viz/types';
import type { AggregateFn, ChartType, ColumnFormat, NumberStyle, VizSpec } from '../../viz/types';

interface VizSettingsProps {
  spec: VizSpec;
  columns: ResultColumn[];
  onChange: (spec: VizSpec) => void;
  seriesNames?: string[]; // for highlight / colours (breakout values)
}

const AGGS: AggregateFn[] = ['sum', 'avg', 'count', 'min', 'max'];

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <FormControl>
      <FormLabel fontSize="xs" color="mutedText" mb={1}>
        {label}
        {hint && (
          <Tooltip label={hint} hasArrow>
            <Text as="span" color="faintText"> ⓘ</Text>
          </Tooltip>
        )}
      </FormLabel>
      {children}
    </FormControl>
  );
}

function ColumnPick({ columns, value, onChange, numeric, allowNone, label }: {
  columns: ResultColumn[]; value: string | undefined; onChange: (v: string | undefined) => void; numeric?: boolean; allowNone?: boolean; label: string;
}) {
  const options = numeric ? columns.filter((c) => c.type === 'number') : columns;
  return (
    <Select size="sm" value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)} aria-label={label}>
      {(allowNone || !value) && <option value="">{allowNone ? '— none —' : 'Pick…'}</option>}
      {options.map((c) => (
        <option key={c.name} value={c.name}>
          {c.name}
        </option>
      ))}
    </Select>
  );
}

/** The chart settings drawer. Every change produces a new VizSpec (JSON, saved with the question in M4). */
export function VizSettings({ spec, columns, onChange, seriesNames = [] }: VizSettingsProps) {
  const set = (patch: Partial<VizSpec>) => onChange({ ...spec, ...patch });
  const t = spec.type;
  const cartesian = ['bar', 'line', 'area', 'combo'].includes(t);
  const numeric = columns.filter((c) => c.type === 'number');
  const series = spec.series ?? [];

  return (
    <VStack align="stretch" spacing={4} data-testid="viz-settings">
      <Field label="Chart type">
        <SimpleGrid columns={3} spacing={1.5}>
          {CHART_TYPES.map((c) => (
            <Tooltip key={c.type} label={c.hint} hasArrow openDelay={300}>
              <Button size="xs" variant={t === c.type ? 'brand' : 'subtle'} onClick={() => set({ type: c.type as ChartType })} data-testid={`viz-type-${c.type}`}>
                {c.label}
              </Button>
            </Tooltip>
          ))}
        </SimpleGrid>
      </Field>

      {(cartesian || ['pie', 'funnel', 'heatmap', 'scatter', 'histogram'].includes(t)) && (
        <Field label={t === 'scatter' ? 'X axis (number)' : t === 'histogram' ? 'Column to bin' : 'X axis / categories'}>
          <ColumnPick columns={columns} value={spec.x} onChange={(x) => set({ x })} numeric={t === 'scatter' || t === 'histogram'} label="X axis" />
        </Field>
      )}

      {(cartesian || t === 'scatter') && (
        <Field label={t === 'scatter' ? 'Y axis (up to 3 numbers)' : 'Values (series)'}>
          <VStack align="stretch" spacing={1.5}>
            {series.map((s, i) => (
              <HStack key={i} spacing={1.5}>
                <ColumnPick columns={columns} value={s.y} numeric onChange={(y) => y && set({ series: series.map((x, k) => (k === i ? { ...x, y } : x)) })} label="Series column" />
                {t === 'combo' && (
                  <Select size="sm" maxW="96px" value={s.kind ?? (i === 0 ? 'bar' : 'line')} onChange={(e) => set({ series: series.map((x, k) => (k === i ? { ...x, kind: e.target.value as 'bar' | 'line' | 'area' } : x)) })} aria-label="Series kind">
                    <option value="bar">bars</option>
                    <option value="line">line</option>
                    <option value="area">area</option>
                  </Select>
                )}
                <IconButton aria-label="Remove series" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set({ series: series.filter((_, k) => k !== i) })} />
              </HStack>
            ))}
            {series.length < (t === 'scatter' ? 3 : MAX_SERIES) && !spec.breakout && numeric.length > 0 && (
              <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => set({ series: [...series, { y: numeric.find((c) => !series.some((s) => s.y === c.name))?.name ?? numeric[0].name }] })}>
                Series
              </Button>
            )}
          </VStack>
        </Field>
      )}

      {cartesian && (
        <Field label="Split into one series per" hint="A second column; each of its values becomes its own colour (at most 8, the rest is 'Other').">
          <ColumnPick columns={columns.filter((c) => c.name !== spec.x && c.type !== 'number')} value={spec.breakout} allowNone onChange={(breakout) => set({ breakout, series: breakout ? series.slice(0, 1) : series })} label="Breakout" />
        </Field>
      )}

      {['pie', 'funnel', 'heatmap', 'gauge', 'kpi'].includes(t) && (
        <Field label="Value">
          <ColumnPick columns={columns} numeric value={spec.value} onChange={(value) => set({ value })} label="Value column" />
        </Field>
      )}
      {t === 'heatmap' && (
        <Field label="Rows (second dimension)">
          <ColumnPick columns={columns} value={spec.y2} onChange={(y2) => set({ y2 })} label="Heatmap rows" />
        </Field>
      )}
      {t === 'scatter' && (
        <Field label="Bubble size" hint="Optional third number: bigger value, bigger bubble">
          <ColumnPick columns={columns} numeric value={spec.size} allowNone onChange={(size) => set({ size })} label="Bubble size" />
        </Field>
      )}
      {t === 'histogram' && (
        <Field label="Number of bins">
          <Input size="sm" type="number" min={2} max={100} value={spec.bins ?? 10} onChange={(e) => set({ bins: Math.min(100, Math.max(2, Number(e.target.value) || 10)) })} />
        </Field>
      )}
      {t === 'gauge' && (
        <HStack>
          <Field label="Min">
            <Input size="sm" type="number" value={spec.min ?? ''} onChange={(e) => set({ min: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Max">
            <Input size="sm" type="number" value={spec.max ?? ''} placeholder="auto" onChange={(e) => set({ max: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
        </HStack>
      )}
      {t === 'kpi' && (
        <VStack align="stretch" spacing={1}>
          <Checkbox size="sm" isChecked={spec.kpi?.compare ?? true} onChange={(e) => set({ kpi: { ...spec.kpi, compare: e.target.checked } })}>Change vs previous row</Checkbox>
          <Checkbox size="sm" isChecked={spec.kpi?.sparkline ?? true} onChange={(e) => set({ kpi: { ...spec.kpi, sparkline: e.target.checked } })}>Sparkline</Checkbox>
          <Checkbox size="sm" isChecked={spec.kpi?.upIsGood ?? true} onChange={(e) => set({ kpi: { ...spec.kpi, upIsGood: e.target.checked } })}>Going up is good</Checkbox>
        </VStack>
      )}
      {t === 'pie' && (
        <Checkbox size="sm" isChecked={spec.donut !== false} onChange={(e) => set({ donut: e.target.checked })}>
          Donut (hole in the middle)
        </Checkbox>
      )}
      {t === 'pivot' && <PivotFields spec={spec} columns={columns} set={set} />}

      {cartesian && (
        <>
          <Divider />
          {['bar', 'area'].includes(t) && (
            <Field label="Stacking">
              <ButtonGroup size="xs" isAttached>
                {(['none', 'stacked', 'percent'] as const).map((s) => (
                  <Button key={s} variant={(spec.stack ?? 'none') === s ? 'brand' : 'subtle'} onClick={() => set({ stack: s })}>
                    {s === 'none' ? 'Side by side' : s === 'stacked' ? 'Stacked' : '100 %'}
                  </Button>
                ))}
              </ButtonGroup>
            </Field>
          )}
          <HStack spacing={4} wrap="wrap">
            {t === 'bar' && (
              <HStack><Switch size="sm" isChecked={!!spec.horizontal} onChange={(e) => set({ horizontal: e.target.checked })} id="viz-h" /><FormLabel htmlFor="viz-h" m={0} fontSize="sm">Horizontal</FormLabel></HStack>
            )}
            <HStack><Switch size="sm" isChecked={!!spec.labels} onChange={(e) => set({ labels: e.target.checked })} id="viz-l" /><FormLabel htmlFor="viz-l" m={0} fontSize="sm">Value labels</FormLabel></HStack>
          </HStack>
          <SimpleGrid columns={2} spacing={2}>
            <Field label="Goal line">
              <Input size="sm" type="number" value={spec.goal?.value ?? ''} placeholder="none" onChange={(e) => set({ goal: e.target.value === '' ? null : { value: Number(e.target.value), label: spec.goal?.label } })} />
            </Field>
            <Field label="Goal label">
              <Input size="sm" value={spec.goal?.label ?? ''} isDisabled={!spec.goal} onChange={(e) => spec.goal && set({ goal: { ...spec.goal, label: e.target.value } })} />
            </Field>
          </SimpleGrid>
          {t === 'bar' && (
            <Field label="Only the largest" hint="Keep the N biggest categories and add the rest up as 'Other'">
              <Input size="sm" type="number" min={1} value={spec.topN ?? ''} placeholder="all" onChange={(e) => set({ topN: e.target.value ? Math.max(1, Number(e.target.value)) : null })} />
            </Field>
          )}
          <SimpleGrid columns={2} spacing={2}>
            <Field label="X axis title"><Input size="sm" value={spec.axis?.xTitle ?? ''} onChange={(e) => set({ axis: { ...spec.axis, xTitle: e.target.value || undefined } })} /></Field>
            <Field label="Y axis title"><Input size="sm" value={spec.axis?.yTitle ?? ''} onChange={(e) => set({ axis: { ...spec.axis, yTitle: e.target.value || undefined } })} /></Field>
            <Field label="Y min"><Input size="sm" type="number" placeholder="auto" value={spec.axis?.yMin ?? ''} onChange={(e) => set({ axis: { ...spec.axis, yMin: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>
            <Field label="Y max"><Input size="sm" type="number" placeholder="auto" value={spec.axis?.yMax ?? ''} onChange={(e) => set({ axis: { ...spec.axis, yMax: e.target.value === '' ? null : Number(e.target.value) } })} /></Field>
          </SimpleGrid>
        </>
      )}

      {(cartesian || t === 'pie' || t === 'scatter') && (
        <Field label="Legend">
          <Select size="sm" value={spec.legend ?? 'auto'} onChange={(e) => set({ legend: e.target.value as VizSpec['legend'] })}>
            <option value="auto">Automatic (for 2+ series)</option>
            <option value="top">Top</option>
            <option value="bottom">Bottom</option>
            <option value="none">Hidden</option>
          </Select>
        </Field>
      )}

      {cartesian && seriesNames.length > 1 && (
        <Field label="Highlight one series" hint="The others turn grey: good when one of them is the story">
          <Select size="sm" value={spec.highlight ?? ''} onChange={(e) => set({ highlight: e.target.value || null })}>
            <option value="">— none —</option>
            {seriesNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </Field>
      )}

      {cartesian && seriesNames.length > 0 && (
        <Field label="Colours" hint="A colour stays with its series even when filters remove others">
          <VStack align="stretch" spacing={1}>
            {seriesNames.slice(0, MAX_SERIES).map((n) => (
              <HStack key={n} spacing={2}>
                <Text fontSize="xs" flex={1} noOfLines={1}>{n}</Text>
                <HStack spacing={1}>
                  {CATEGORICAL.light.map((hex, slot) => (
                    <Box key={hex} as="button" aria-label={`Colour ${slot + 1} for ${n}`} w="14px" h="14px" borderRadius="sm" bg={hex}
                      outline={spec.colors?.[n] === slot ? '2px solid' : undefined} outlineColor="bodyText" outlineOffset="1px"
                      onClick={() => set({ colors: { ...spec.colors, [n]: slot } })} />
                  ))}
                </HStack>
              </HStack>
            ))}
          </VStack>
        </Field>
      )}

      {numeric.length > 0 && (
        <>
          <Divider />
          <Text fontSize="xs" fontWeight={700} color="mutedText">Number formats</Text>
          {numeric.map((c) => (
            <FormatRow key={c.name} name={c.name} fmt={spec.format?.[c.name] ?? {}} onChange={(f) => set({ format: { ...spec.format, [c.name]: f } })} />
          ))}
        </>
      )}
    </VStack>
  );
}

function FormatRow({ name, fmt, onChange }: { name: string; fmt: ColumnFormat; onChange: (f: ColumnFormat) => void }) {
  return (
    <Box>
      <Text fontSize="xs" fontFamily="mono" mb={1}>{name}</Text>
      <Flex gap={1.5} wrap="wrap">
        <Select size="xs" maxW="110px" value={fmt.style ?? 'auto'} onChange={(e) => onChange({ ...fmt, style: e.target.value as NumberStyle })} aria-label={`Format of ${name}`}>
          <option value="auto">Number</option>
          <option value="currency">Currency</option>
          <option value="percent">Percent</option>
          <option value="plain">Plain (no 1,000s)</option>
        </Select>
        {fmt.style === 'currency' && <Input size="xs" maxW="64px" value={fmt.currency ?? 'USD'} onChange={(e) => onChange({ ...fmt, currency: e.target.value.toUpperCase().slice(0, 3) })} aria-label="Currency code" />}
        <Input size="xs" maxW="74px" type="number" min={0} max={8} placeholder="decimals" value={fmt.decimals ?? ''} onChange={(e) => onChange({ ...fmt, decimals: e.target.value === '' ? null : Number(e.target.value) })} aria-label="Decimals" />
        <Checkbox size="sm" isChecked={!!fmt.compact} onChange={(e) => onChange({ ...fmt, compact: e.target.checked })}><Text fontSize="xs">1.2K</Text></Checkbox>
        <Input size="xs" maxW="60px" placeholder="prefix" value={fmt.prefix ?? ''} onChange={(e) => onChange({ ...fmt, prefix: e.target.value || undefined })} aria-label="Prefix" />
        <Input size="xs" maxW="60px" placeholder="suffix" value={fmt.suffix ?? ''} onChange={(e) => onChange({ ...fmt, suffix: e.target.value || undefined })} aria-label="Suffix" />
      </Flex>
    </Box>
  );
}

function PivotFields({ spec, columns, set }: { spec: VizSpec; columns: ResultColumn[]; set: (p: Partial<VizSpec>) => void }) {
  const p = spec.pivot ?? { rows: [], columns: [], values: [], totals: true };
  const update = (patch: Partial<typeof p>) => set({ pivot: { ...p, ...patch } });
  const dims = columns.filter((c) => c.type !== 'number' || c.role === 'dimension');
  const toggle = (list: string[], name: string) => (list.includes(name) ? list.filter((x) => x !== name) : [...list, name]);
  return (
    <VStack align="stretch" spacing={3}>
      <Field label="Rows">
        <Flex gap={2} wrap="wrap">{dims.map((c) => <Checkbox key={c.name} size="sm" isChecked={p.rows.includes(c.name)} onChange={() => update({ rows: toggle(p.rows, c.name) })}><Text fontSize="xs">{c.name}</Text></Checkbox>)}</Flex>
      </Field>
      <Field label="Columns">
        <Flex gap={2} wrap="wrap">{dims.map((c) => <Checkbox key={c.name} size="sm" isChecked={p.columns.includes(c.name)} onChange={() => update({ columns: toggle(p.columns, c.name) })}><Text fontSize="xs">{c.name}</Text></Checkbox>)}</Flex>
      </Field>
      <Field label="Values">
        <VStack align="stretch" spacing={1.5}>
          {p.values.map((v, i) => (
            <HStack key={i} spacing={1.5}>
              <Select size="sm" maxW="90px" value={v.agg} onChange={(e) => update({ values: p.values.map((x, k) => (k === i ? { ...x, agg: e.target.value as AggregateFn } : x)) })} aria-label="Aggregate">
                {AGGS.map((a) => <option key={a} value={a}>{a}</option>)}
              </Select>
              <ColumnPick columns={columns} value={v.column} onChange={(column) => column && update({ values: p.values.map((x, k) => (k === i ? { ...x, column } : x)) })} label="Value column" />
              <IconButton aria-label="Remove value" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => update({ values: p.values.filter((_, k) => k !== i) })} />
            </HStack>
          ))}
          <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => update({ values: [...p.values, { column: columns.find((c) => c.type === 'number')?.name ?? columns[0].name, agg: 'sum' }] })}>
            Value
          </Button>
        </VStack>
      </Field>
      <Checkbox size="sm" isChecked={p.totals !== false} onChange={(e) => update({ totals: e.target.checked })}>Totals</Checkbox>
    </VStack>
  );
}
