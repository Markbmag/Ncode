import { Button, Flex, IconButton, Input, Select, Text, VStack } from '@chakra-ui/react';
import type { ResultColumn } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import type { Transform, TransformType } from '../../query/types';

const TRANSFORMS: { type: TransformType; label: string; hint: string }[] = [
  { type: 'previous_period', label: 'Compare with previous', hint: 'The value one period earlier (matched by date) and the change' },
  { type: 'pct_change', label: '% change of', hint: 'Change against the previous row' },
  { type: 'running_total', label: 'Running total of', hint: 'Adds up along the time (per series)' },
  { type: 'moving_average', label: 'Moving average of', hint: 'Average of the last N rows (per series)' },
  { type: 'pct_of_total', label: '% of total of', hint: 'Share of the total, overall or within a group' },
  { type: 'rank', label: 'Rank by', hint: '1 = largest, overall or within a group' },
  { type: 'outliers', label: 'Flag outliers in', hint: 'Marks values far from the rest' },
];
const PERIODS = ['day', 'week', 'month', 'quarter', 'year'] as const;

interface Props {
  transforms: Transform[];
  columns: ResultColumn[]; // of the last result
  onChange: (transforms: Transform[]) => void;
}

/** Calculations on the result: previous period, running total, % of total ... (applied after the query). */
export function TransformsEditor({ transforms, columns, onChange }: Props) {
  const base = columns.filter((c) => !c.generated);
  const numbers = base.filter((c) => c.type === 'number');
  const dims = base.filter((c) => c.role === 'dimension');
  const dates = base.filter((c) => c.type === 'date' || c.type === 'datetime');
  const set = (i: number, t: Transform | null) => onChange(t === null ? transforms.filter((_, k) => k !== i) : transforms.map((x, k) => (k === i ? t : x)));
  const label = (c: ResultColumn) => c.display_name || c.name;

  if (base.length === 0 && transforms.length === 0)
    return (
      <Text fontSize="sm" color="faintText">
        Run the question once to add calculations such as “vs. last year” or a running total.
      </Text>
    );
  return (
    <VStack align="stretch" spacing={2} data-testid="transforms">
      {transforms.map((t, i) => {
        const info = TRANSFORMS.find((x) => x.type === t.type)!;
        return (
          <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="transform-row">
            <Select size="sm" maxW="210px" value={t.type} onChange={(e) => set(i, { type: e.target.value as TransformType, column: t.column })} aria-label="Calculation" title={info.hint}>
              {TRANSFORMS.map((x) => (
                <option key={x.type} value={x.type}>
                  {x.label}
                </option>
              ))}
            </Select>
            <Select size="sm" maxW="180px" value={t.column} onChange={(e) => set(i, { ...t, column: e.target.value })} aria-label="Value column">
              {!numbers.some((c) => c.name === t.column) && <option value={t.column}>{t.column || 'Pick…'}</option>}
              {numbers.map((c) => (
                <option key={c.name} value={c.name}>
                  {label(c)}
                </option>
              ))}
            </Select>
            {t.type === 'previous_period' && (
              <Select size="sm" maxW="150px" value={t.period ?? ''} onChange={(e) => set(i, { ...t, period: (e.target.value || null) as Transform['period'] })} aria-label="Period">
                <option value="">previous step</option>
                {PERIODS.map((p) => (
                  <option key={p} value={p}>
                    {p === 'day' ? 'yesterday' : `last ${p}`}
                  </option>
                ))}
              </Select>
            )}
            {t.type === 'moving_average' && (
              <Input size="sm" type="number" min={2} max={365} maxW="90px" value={t.window ?? 3} onChange={(e) => set(i, { ...t, window: Math.max(2, Number(e.target.value) || 3) })} aria-label="Rows" />
            )}
            {(t.type === 'rank' || t.type === 'pct_of_total') && (
              <Select size="sm" maxW="180px" value={t.by ?? ''} onChange={(e) => set(i, { ...t, by: e.target.value || null })} aria-label="Within">
                <option value="">overall</option>
                {dims.map((c) => (
                  <option key={c.name} value={c.name}>
                    within each {label(c)}
                  </option>
                ))}
              </Select>
            )}
            {['running_total', 'moving_average', 'pct_change', 'previous_period'].includes(t.type) && dates.length > 1 && (
              <Select size="sm" maxW="160px" value={t.by ?? ''} onChange={(e) => set(i, { ...t, by: e.target.value || null })} aria-label="Along">
                <option value="">along {label(dates[0])}</option>
                {dates.slice(1).map((c) => (
                  <option key={c.name} value={c.name}>
                    along {label(c)}
                  </option>
                ))}
              </Select>
            )}
            {t.type === 'outliers' && (
              <Select size="sm" maxW="170px" value={t.method ?? 'iqr'} onChange={(e) => set(i, { ...t, method: e.target.value as 'iqr' | 'zscore' })} aria-label="Method">
                <option value="iqr">beyond 1.5 × IQR</option>
                <option value="zscore">more than 3 σ</option>
              </Select>
            )}
            <IconButton aria-label="Remove calculation" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(i, null)} />
          </Flex>
        );
      })}
      <Button
        size="xs"
        variant="subtle"
        leftIcon={<PlusIcon boxSize={3} />}
        alignSelf="flex-start"
        isDisabled={numbers.length === 0 || transforms.length >= 20}
        onClick={() => onChange([...transforms, { type: dates.length ? 'previous_period' : 'pct_of_total', column: numbers[numbers.length - 1]?.name ?? '' }])}
        data-testid="add-transform"
      >
        Calculation
      </Button>
    </VStack>
  );
}
