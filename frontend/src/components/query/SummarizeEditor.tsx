import { Box, Button, Flex, IconButton, Input, Select, SimpleGrid, Text, VStack } from '@chakra-ui/react';
import type { ColumnType } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import { AGGREGATES, BUCKETS, aggregationName } from '../../query/draft';
import type { Aggregation, Breakout, Bucket } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';

const TYPES_FOR: Record<Aggregation['fn'], ColumnType[] | undefined> = {
  count: undefined,
  count_distinct: undefined,
  sum: ['number'],
  avg: ['number'],
  min: ['number', 'date', 'datetime', 'string', 'time'],
  max: ['number', 'date', 'datetime', 'string', 'time'],
};
const BINS = [1, 5, 10, 50, 100, 1000];

interface SummarizeEditorProps {
  aggregations: Aggregation[];
  breakouts: Breakout[];
  options: PickOption[];
  onChange: (aggregations: Aggregation[], breakouts: Breakout[]) => void;
}

export function SummarizeEditor({ aggregations, breakouts, options, onChange }: SummarizeEditorProps) {
  const typeOf = (ref?: string) => options.find((o) => o.ref === ref)?.type ?? 'unknown';
  const setAgg = (i: number, a: Aggregation | null) => onChange(a === null ? aggregations.filter((_, k) => k !== i) : aggregations.map((x, k) => (k === i ? a : x)), breakouts);
  const setBrk = (i: number, b: Breakout | null) => onChange(aggregations, b === null ? breakouts.filter((_, k) => k !== i) : breakouts.map((x, k) => (k === i ? b : x)));

  const pickBreakout = (i: number, ref: string) => {
    const type = typeOf(ref);
    const b: Breakout = { ref };
    if (type === 'date' || type === 'datetime') b.bucket = 'month';
    setBrk(i, b);
  };

  return (
    <SimpleGrid columns={{ base: 1, '2xl': 2 }} spacing={4}>
      <VStack align="stretch" spacing={2} data-testid="metrics">
        <Text fontSize="xs" color="mutedText" fontWeight={700}>
          Metrics
        </Text>
        {aggregations.map((a, i) => {
          const info = AGGREGATES.find((x) => x.fn === a.fn)!;
          return (
            <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="metric-row">
              <Select size="sm" maxW="170px" value={a.fn} onChange={(e) => setAgg(i, { fn: e.target.value as Aggregation['fn'], ref: e.target.value === 'count' ? undefined : a.ref, alias: a.alias })} aria-label="Metric">
                {AGGREGATES.map((x) => (
                  <option key={x.fn} value={x.fn}>
                    {x.label}
                  </option>
                ))}
              </Select>
              {info.needsColumn && (
                <ColumnSelect options={options} types={TYPES_FOR[a.fn]} value={a.ref} onChange={(ref) => setAgg(i, { ...a, ref })} maxW="200px" aria-label="Metric column" />
              )}
              <Input size="sm" maxW="130px" placeholder={aggregationName({ ...a, alias: undefined })} value={a.alias ?? ''} onChange={(e) => setAgg(i, { ...a, alias: e.target.value.replace(/[^A-Za-z0-9_]/g, '') || undefined })} aria-label="Result column name" />
              <IconButton aria-label="Remove metric" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setAgg(i, null)} />
            </Flex>
          );
        })}
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange([...aggregations, { fn: aggregations.length ? 'sum' : 'count' }], breakouts)} data-testid="add-metric">
          Metric
        </Button>
      </VStack>

      <VStack align="stretch" spacing={2} data-testid="group-by">
        <Text fontSize="xs" color="mutedText" fontWeight={700}>
          Grouped by
        </Text>
        {breakouts.map((b, i) => {
          const type = typeOf(b.ref);
          return (
            <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="group-row">
              <ColumnSelect options={options} value={b.ref || undefined} onChange={(ref) => pickBreakout(i, ref)} maxW="220px" aria-label="Group by column" />
              {(type === 'date' || type === 'datetime') && (
                <Select size="sm" maxW="120px" value={b.bucket ?? ''} onChange={(e) => setBrk(i, { ...b, bucket: (e.target.value || undefined) as Bucket | undefined })} aria-label="Date grouping">
                  <option value="">Exact value</option>
                  {BUCKETS.map((x) => (
                    <option key={x.value} value={x.value}>
                      by {x.label.toLowerCase()}
                    </option>
                  ))}
                </Select>
              )}
              {type === 'number' && (
                <Select size="sm" maxW="130px" value={b.bin_width ?? ''} onChange={(e) => setBrk(i, { ...b, bin_width: e.target.value ? Number(e.target.value) : undefined })} aria-label="Number ranges">
                  <option value="">Exact value</option>
                  {BINS.map((w) => (
                    <option key={w} value={w}>
                      ranges of {w}
                    </option>
                  ))}
                </Select>
              )}
              <IconButton aria-label="Remove grouping" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setBrk(i, null)} />
            </Flex>
          );
        })}
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange(aggregations, [...breakouts, { ref: '' }])} data-testid="add-group">
          Group by
        </Button>
      </VStack>
      {aggregations.length === 0 && breakouts.length === 0 && (
        <Box gridColumn="1 / -1">
          <Text fontSize="sm" color="faintText">
            Not summarised: the question shows rows. Add a metric (sum, count …) and a grouping to get totals per group.
          </Text>
        </Box>
      )}
    </SimpleGrid>
  );
}
