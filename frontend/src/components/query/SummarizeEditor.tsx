import { Badge, Box, Button, Flex, IconButton, Input, Select, SimpleGrid, Text, VStack } from '@chakra-ui/react';
import type { ColumnType } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import { AGGREGATES, BUCKETS } from '../../query/draft';
import { aggregationLabel, plainNamer } from '../../query/outputs';
import type { Namer } from '../../query/outputs';
import type { Aggregation, Breakout, Bucket, OrderBy } from '../../query/types';
import { rankable, topNOf, withTopN } from '../../quick/quick';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';
import { cleanResultName } from './names';
import { t } from '../../i18n/index.ts';

const TYPES_FOR: Record<Aggregation['fn'], ColumnType[] | undefined> = {
  count: undefined,
  count_distinct: undefined,
  sum: ['number'],
  avg: ['number'],
  min: ['number', 'date', 'datetime', 'string', 'time'],
  max: ['number', 'date', 'datetime', 'string', 'time'],
  metric: undefined,
};

/** A saved metric of the data model that fits the question (its table is in it). */
export interface MetricOption {
  id: number;
  name: string;
  slug: string;
  description?: string | null;
}
const BINS = [1, 5, 10, 50, 100, 1000];
const BY_BUCKET: Record<Bucket, string> = {
  minute: t('by minute'),
  hour: t('by hour'),
  day: t('by day'),
  week: t('by week'),
  month: t('by month'),
  quarter: t('by quarter'),
  year: t('by year'),
};

interface SummarizeEditorProps {
  aggregations: Aggregation[];
  breakouts: Breakout[];
  options: PickOption[];
  onChange: (aggregations: Aggregation[], breakouts: Breakout[]) => void;
  metrics?: MetricOption[];
  namer?: Namer; // readable names of the result columns ("Sum of Total") for the name placeholders
  /** "Top N by …" (M12): one control for the sort (biggest first) and the row limit it is made of */
  top?: { order: OrderBy[]; limit: number | null; onChange: (order: OrderBy[], limit: number | null) => void };
}

export function SummarizeEditor({ aggregations, breakouts, options, onChange, metrics = [], namer = plainNamer, top }: SummarizeEditorProps) {
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
          {t('What to count or sum')}
        </Text>
        {aggregations.map((a, i) => {
          if (a.fn === 'metric') {
            const m = metrics.find((x) => x.id === a.metric);
            return (
              <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="metric-row">
                <Badge colorScheme="green" variant="subtle" textTransform="none" fontSize="xs" px={2} py={1} title={m?.description ?? undefined}>
                  ★ {m?.name ?? t('Metric {id} (not available)', { id: a.metric })}
                </Badge>
                <Input size="sm" maxW="130px" placeholder={m?.name ?? m?.slug} value={a.alias ?? ''} onChange={(e) => setAgg(i, { ...a, alias: cleanResultName(e.target.value) })} aria-label={t('Result column name')} title={t('Name in the result (optional)')} />
                <IconButton aria-label={t('Remove metric')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setAgg(i, null)} />
              </Flex>
            );
          }
          const info = AGGREGATES.find((x) => x.fn === a.fn)!;
          return (
            <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="metric-row">
              <Select size="sm" w="auto" flexShrink={0} value={a.fn} onChange={(e) => setAgg(i, { fn: e.target.value as Aggregation['fn'], ref: e.target.value === 'count' ? undefined : a.ref, alias: a.alias })} aria-label={t('Metric')}>
                {AGGREGATES.map((x) => (
                  <option key={x.fn} value={x.fn}>
                    {x.label}
                  </option>
                ))}
              </Select>
              {info.needsColumn && (
                <ColumnSelect options={options} types={TYPES_FOR[a.fn]} value={a.ref} onChange={(ref) => setAgg(i, { ...a, ref })} maxW="200px" aria-label={t('Metric column')} />
              )}
              <Input size="sm" maxW="130px" placeholder={aggregationLabel({ ...a, alias: undefined }, namer).label} value={a.alias ?? ''} onChange={(e) => setAgg(i, { ...a, alias: cleanResultName(e.target.value) })} aria-label={t('Result column name')} title={t('Name in the result (optional)')} />
              <IconButton aria-label={t('Remove metric')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setAgg(i, null)} />
            </Flex>
          );
        })}
        <Flex gap={2} wrap="wrap">
          <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} onClick={() => onChange([...aggregations, { fn: aggregations.length ? 'sum' : 'count' }], breakouts)} data-testid="add-metric">
            {t('Count or sum')}
          </Button>
          {metrics.length > 0 && (
            <Select
              size="xs"
              maxW="200px"
              value=""
              onChange={(e) => {
                const m = metrics.find((x) => String(x.id) === e.target.value);
                if (m) onChange([...aggregations, { fn: 'metric', metric: m.id, alias: m.slug }], breakouts);
              }}
              aria-label={t('Add a saved metric')}
              data-testid="add-saved-metric"
            >
              <option value="">{t('★ Saved metric…')}</option>
              {metrics.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          )}
        </Flex>
      </VStack>

      <VStack align="stretch" spacing={2} data-testid="group-by">
        <Text fontSize="xs" color="mutedText" fontWeight={700}>
          {t('Group by')}
          <Text as="span" fontWeight={400} color="faintText">
            {' '}
            {t('(one row per value)')}
          </Text>
        </Text>
        {breakouts.map((b, i) => {
          const type = typeOf(b.ref);
          return (
            <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="group-row">
              <ColumnSelect options={options} value={b.ref || undefined} onChange={(ref) => pickBreakout(i, ref)} maxW="220px" aria-label={t('Group by column')} />
              {(type === 'date' || type === 'datetime') && (
                <Select size="sm" w="auto" flexShrink={0} value={b.bucket ?? ''} onChange={(e) => setBrk(i, { ...b, bucket: (e.target.value || undefined) as Bucket | undefined })} aria-label={t('Date grouping')}>
                  <option value="">{t('Exact value')}</option>
                  {BUCKETS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {BY_BUCKET[x.value] ?? x.label}
                    </option>
                  ))}
                </Select>
              )}
              {type === 'number' && (
                <Select size="sm" w="auto" flexShrink={0} value={b.bin_width ?? ''} onChange={(e) => setBrk(i, { ...b, bin_width: e.target.value ? Number(e.target.value) : undefined })} aria-label={t('Number ranges')}>
                  <option value="">{t('Exact value')}</option>
                  {BINS.map((w) => (
                    <option key={w} value={w}>
                      {t('ranges of {n}', { n: w })}
                    </option>
                  ))}
                </Select>
              )}
              <IconButton aria-label={t('Remove grouping')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setBrk(i, null)} />
            </Flex>
          );
        })}
        <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange(aggregations, [...breakouts, { ref: '' }])} data-testid="add-group">
          {t('Group by')}
        </Button>
      </VStack>
      {top && <TopN aggregations={aggregations} breakouts={breakouts} options={options} namer={namer} top={top} />}
      {aggregations.length === 0 && breakouts.length === 0 && (
        <Box gridColumn="1 / -1">
          <Text fontSize="sm" color="faintText">
            {t('Not summarised: the question shows rows. Count or sum something and group by a column to get totals per group, for example a count per month.')}
          </Text>
        </Box>
      )}
    </SimpleGrid>
  );
}

/** "Top N by …": only the N biggest groups, ranked by one of the values (sorted biggest first + a row limit). */
function TopN({ aggregations, breakouts, options, namer, top }: Pick<SummarizeEditorProps, 'aggregations' | 'breakouts' | 'options'> & { namer: Namer; top: NonNullable<SummarizeEditorProps['top']> }) {
  const ranks = rankable({ aggregations, breakouts }, options);
  if (ranks.length === 0 || !breakouts.some((b) => b.ref)) return null;
  const current = topNOf({ aggregations, breakouts, order: top.order, limit: top.limit }, options);
  const set = (n: number | null, by: string | null) => {
    const next = withTopN({ order: top.order, limit: top.limit }, n, by);
    top.onChange(next.order, next.limit);
  };
  return (
    <Box gridColumn="1 / -1" data-testid="top-n">
      {current ? (
        <Flex gap={2} align="center" wrap="wrap">
          <Text fontSize="sm">{t('Only the biggest')}</Text>
          <Input size="sm" type="number" min={1} maxW="80px" value={current.n} onChange={(e) => set(Math.max(1, Number(e.target.value) || 1), current.by)} aria-label={t('How many')} data-testid="top-n-count" />
          <Text fontSize="sm">{t('ranked by')}</Text>
          <Select size="sm" w="auto" maxW="220px" value={current.by} onChange={(e) => set(current.n, e.target.value)} aria-label={t('Ranked by')} data-testid="top-n-by">
            {ranks.map((r) => (
              <option key={r.name} value={r.name}>
                {aggregationLabel(aggregations[r.index], namer).label}
              </option>
            ))}
          </Select>
          <IconButton aria-label={t('Show every group')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(null, null)} />
        </Flex>
      ) : (
        <Flex gap={3} align="center" wrap="wrap">
          <Button size="xs" variant="subtle" onClick={() => set(10, ranks[0].name)} data-testid="add-top-n">
            {t('Top N by…')}
          </Button>
          <Text fontSize="xs" color="faintText">
            {t('Only the biggest groups, for example the top 10 parts by scrap')}
          </Text>
        </Flex>
      )}
    </Box>
  );
}
