/**
 * The quick question (M12): one screen for newcomers, plain words, a live result.
 *
 *   Table  →  What do you want to see?  →  Split by  →  Only where  →  (Top N)      [result + caption]
 *
 * The choices are QuickParts (src/quick/quick.ts); what runs, what is saved and what "Open in full
 * editor" hands over is the builder question made from them, so nothing is lost on the way.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertIcon, Box, Button, Flex, HStack, IconButton, Input, Select, Skeleton, Switch, Text, VStack, Wrap, WrapItem, useBreakpointValue,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { Split } from '../components/layout/Split';
import { ValuePicker } from '../components/query/ValuePicker';
import { PlusIcon, XIcon } from '../icons';
import { QuestionHeader } from '../library/QuestionHeader';
import { SMART_DATES_DEFAULT, SMART_DATES_KEY } from '../lib/format';
import { byLabel, labelIn, nameMatches } from '../lib/names';
import { loadJson, saveJson } from '../lib/storage';
import { questionCaption } from '../query/caption';
import { columnOptions, prepareSpec } from '../query/draft';
import type { SchemaInfo } from '../query/draft';
import { labelColumns, namerFromOptions, outputLabels } from '../query/outputs';
import type { Bucket, Condition, FilterOp, QuerySpec } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { useSchema } from '../query/useSchema';
import type { VizState } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';
import { DATE_PRESETS, TIME_BUCKETS, canTop, mainDate, quickModel, quickNamer, quickSpec, splitRef, startParts } from './quick';
import type { DatePreset, QuickColumn, QuickModel, QuickParts, SeeFn } from './quick';
import { QuestionSuggestions } from './Suggestions';
import type { Suggestion } from './suggest';
import { t } from '../i18n/index.ts';

const AUTO_CHART: VizState = { mode: 'chart', spec: null }; // a chart when the result has one to draw
const storeKey = (connection: string) => `ncode_quick_${connection}`;
const SHOWN_CATEGORIES = 8;
const SHOWN_TABLES = 40;

interface Stored {
  parts: QuickParts | null;
  viz: VizState;
  picked: string | null; // the ready question it started from
}

function load(connection: string): Stored {
  try {
    const raw = sessionStorage.getItem(storeKey(connection));
    if (raw) {
      const s = JSON.parse(raw) as Stored;
      if (s && typeof s === 'object' && 'parts' in s) return { parts: s.parts ?? null, viz: s.viz ?? AUTO_CHART, picked: s.picked ?? null };
    }
  } catch {
    // a convenience only
  }
  return { parts: null, viz: AUTO_CHART, picked: null };
}

const SEE = (): { fn: SeeFn; label: string; number: boolean }[] => [
  { fn: 'count', label: t('Count of rows'), number: false },
  { fn: 'sum', label: t('Sum'), number: true },
  { fn: 'avg', label: t('Average'), number: true },
  { fn: 'min', label: t('Minimum'), number: true },
  { fn: 'max', label: t('Maximum'), number: true },
  { fn: 'rows', label: t('Just the rows'), number: false },
];

const PER = (): Record<Bucket, string> => ({
  minute: t('per minute'), hour: t('per hour'), day: t('per day'), week: t('per week'), month: t('per month'), quarter: t('per quarter'), year: t('per year'),
});

const PRESET = (): Record<DatePreset, string> => ({
  last_30_days: t('Last 30 days'),
  last_quarter: t('Last quarter'),
  this_year: t('This year'),
  last_12_months: t('Last 12 months'),
});

interface Props {
  connection: string;
  /** the "Full editor" switch, shown in the header */
  modeSwitch?: ReactNode;
  /** "Open in full editor": the builder takes over this question and chart */
  onOpenFull: (spec: QuerySpec, viz: VizState) => void;
}

export function QuickQuestion({ connection, modeSwitch, onOpenFull }: Props) {
  const ws = useWorkspace();
  const conn = ws.connections.find((c) => c.key === connection);
  const schemaQuery = useSchema(connection);
  const [stored, setStored] = useState<Stored>(() => load(connection));
  const [smartDates, setSmartDates] = useState(() => loadJson(SMART_DATES_KEY, SMART_DATES_DEFAULT));
  const { state, run, cancel } = useQueryRun();
  const [ranSpec, setRanSpec] = useState<QuerySpec | null>(null);
  const vertical = useBreakpointValue({ base: true, lg: false }) ?? false;

  useEffect(() => {
    try {
      sessionStorage.setItem(storeKey(connection), JSON.stringify(stored));
    } catch {
      // a convenience only
    }
  }, [stored, connection]);
  useEffect(() => saveJson(SMART_DATES_KEY, smartDates), [smartDates]);

  const schema: SchemaInfo | null = useMemo(
    () => (schemaQuery.data ? { tables: schemaQuery.data.tables, relationships: schemaQuery.data.relationships } : null),
    [schemaQuery.data],
  );
  const parts = stored.parts && schema?.tables.some((x) => x.name === stored.parts!.table) ? stored.parts : null;
  const model = useMemo(() => (parts && schema ? quickModel(schema, parts.table) : null), [parts?.table, schema]); // eslint-disable-line react-hooks/exhaustive-deps
  const spec = useMemo(() => (parts && model && schema ? quickSpec(connection, parts, model, schema) : null), [connection, parts, model, schema]);
  const prepared = useMemo(() => (spec && schema ? prepareSpec(spec, schema) : null), [spec, schema]);
  const preparedJson = prepared && prepared.problems.length === 0 ? JSON.stringify(prepared.spec) : '';

  const start = useCallback(
    (s: QuerySpec, refresh = false) =>
      void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec: s, wait_ms: START_WAIT_MS, ...(refresh ? { refresh: true } : {}) })).data, true, () => setRanSpec(s)),
    [run],
  );
  // live result: shortly after the question stops changing
  useEffect(() => {
    if (!preparedJson) return;
    const timer = window.setTimeout(() => start(JSON.parse(preparedJson) as QuerySpec), 400);
    return () => window.clearTimeout(timer);
  }, [preparedJson, start]);

  // readable names and the caption of what is shown, and of what would be saved
  const describe = useCallback(
    (s: QuerySpec | null) => {
      if (!s || !schema) return null;
      const m = quickModel(schema, s.source.table);
      const options = columnOptions(s, schema);
      const base = namerFromOptions(options, { table: (name) => labelIn(schema.tables, name) });
      const namer = m ? quickNamer(base, m) : base;
      return { labels: outputLabels(s, namer, options), caption: questionCaption(s, namer) };
    },
    [schema],
  );
  const shown = useMemo(() => describe(ranSpec), [describe, ranSpec]);
  const now = useMemo(() => describe(prepared?.spec ?? null), [describe, prepared]);
  const shownState = useMemo(
    () => (state.result && shown ? { ...state, result: { ...state.result, columns: labelColumns(state.result.columns, shown.labels) } } : state),
    [state, shown],
  );

  if (schemaQuery.isPending) return <Skeleton h="400px" borderRadius="2xl" />;
  if (schemaQuery.isError || !schema)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(schemaQuery.error, t('Could not read the database structure'))}
      </Alert>
    );

  const setParts = (next: QuickParts | null) => setStored((s) => ({ parts: next, viz: next ? s.viz : AUTO_CHART, picked: null }));
  const change = (patch: Partial<QuickParts>) => parts && setParts({ ...parts, ...patch });
  const pickSuggestion = (s: Suggestion) => setStored({ parts: s.parts, viz: s.viz, picked: s.key });
  const tableLabel = parts ? labelIn(schema.tables, parts.table) : null;

  const controls = (
    <Box h="100%" overflowY="auto" pr={{ base: 0, lg: 3 }} pb={6} data-testid="quick-question">
      <VStack align="stretch" spacing={5}>
        <Section title={t('Table')} hint={parts ? undefined : t('Which rows do you want to look at? You can change it at any time.')}>
          {parts ? (
            <Flex align="center" gap={2} wrap="wrap">
              <Text fontWeight={700} data-testid="quick-table">
                {tableLabel}
              </Text>
              <Button size="xs" variant="ghost" onClick={() => setParts(null)} data-testid="quick-change-table">
                {t('Change')}
              </Button>
            </Flex>
          ) : (
            <TablePicker schema={schema} onPick={(table) => setStored({ parts: startParts(table), viz: AUTO_CHART, picked: null })} />
          )}
          {parts && <QuestionSuggestions connection={connection} schema={schema} table={parts.table} onPick={pickSuggestion} active={stored.picked} />}
        </Section>

        {parts && model && (
          <>
            <SeeSection parts={parts} model={model} onChange={change} />
            {parts.see.fn !== 'rows' && <SplitSection parts={parts} model={model} onChange={change} />}
            <WhereSection parts={parts} model={model} onChange={change} connection={connection} />
            {canTop(parts) && <TopSection parts={parts} model={model} onChange={change} />}
          </>
        )}
      </VStack>
    </Box>
  );

  const results = (
    <Box h="100%" bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden">
      {prepared && prepared.problems.length > 0 && (
        <Alert status="warning" fontSize="sm">
          <AlertIcon />
          {prepared.problems.join(' · ')}
        </Alert>
      )}
      {parts ? (
        <ResultView
          state={shownState}
          onCancel={cancel}
          smartDates={smartDates}
          onSmartDates={setSmartDates}
          filename={`${conn?.label ?? connection}_${parts.table}`}
          viz={stored.viz}
          onVizChange={(viz) => setStored((s) => ({ ...s, viz }))}
          caption={shownState.result ? (shown?.caption ?? null) : null}
          rowLimit={ranSpec?.limit ?? null}
          onRefresh={() => prepared && start(prepared.spec, true)}
        />
      ) : (
        <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
          {t('Pick a table to start. The result appears here while you choose.')}
        </Flex>
      )}
    </Box>
  );

  const ready = !!prepared && prepared.problems.length === 0;
  return (
    <Flex direction="column" h="100%" gap={3}>
      <QuestionHeader
        engine={conn?.engine}
        title={t('New question')}
        subtitle={
          <>
            {conn?.label}
            {tableLabel && ` · ${tableLabel}`}
          </>
        }
        saved={null}
        dirty={false}
        defaultName={(now?.caption ?? tableLabel ?? t('Question')).slice(0, 120)}
        payload={() => (ready && prepared ? { kind: 'builder', spec: prepared.spec, viz: stored.viz, parameters: [] } : null)}
        onSaved={() => {
          try {
            sessionStorage.removeItem(storeKey(connection));
          } catch {
            // nothing to clean up
          }
        }}
      >
        {modeSwitch}
        <Tooltip label={t('Joins, formulas, sorting and calculations: the same question with every step')} hasArrow openDelay={300}>
          <Button size="sm" variant="subtle" onClick={() => spec && onOpenFull(spec, stored.viz)} isDisabled={!spec} data-testid="quick-open-full">
            {t('Open in full editor')}
          </Button>
        </Tooltip>
        {parts && (
          <Button size="sm" variant="ghost" onClick={() => setParts(null)} data-testid="quick-start-over">
            {t('Start over')}
          </Button>
        )}
      </QuestionHeader>

      <Box flex={1} minH={0}>
        {vertical ? (
          <VStack align="stretch" spacing={4}>
            {controls}
            <Box h="70vh">{results}</Box>
          </VStack>
        ) : (
          <Split id="quick-split" first={controls} second={results} defaultFirst="38%" minFirst="26%" minSecond="34%" />
        )}
      </Box>
    </Flex>
  );
}

// ---------------------------------------------------------------- parts of the screen

function Section({ title, hint, children, testId }: { title: string; hint?: string; children: ReactNode; testId?: string }) {
  return (
    <Box data-testid={testId}>
      <Text fontSize="sm" fontWeight={700} mb={hint ? 0.5 : 1.5}>
        {title}
      </Text>
      {hint && (
        <Text fontSize="xs" color="mutedText" mb={1.5}>
          {hint}
        </Text>
      )}
      {children}
    </Box>
  );
}

function Chip({ active = false, onClick, children, testId, title }: { active?: boolean; onClick: () => void; children: ReactNode; testId?: string; title?: string }) {
  return (
    <WrapItem maxW="100%">
      <Button
        size="sm"
        variant={active ? 'brand' : 'subtle'}
        fontWeight={active ? 700 : 500}
        whiteSpace="normal"
        h="auto"
        minH={8}
        py={1}
        onClick={onClick}
        aria-pressed={active}
        title={title}
        data-testid={testId}
      >
        {children}
      </Button>
    </WrapItem>
  );
}

const hintOf = (c: QuickColumn) =>
  [c.via.length ? t('through {tables}', { tables: c.via.join(' → ') }) : null, c.description].filter(Boolean).join(' — ') || undefined;

function TablePicker({ schema, onPick }: { schema: SchemaInfo; onPick: (table: string) => void }) {
  const [find, setFind] = useState('');
  const all = useMemo(() => byLabel(schema.tables), [schema]);
  const matching = all.filter((p) => nameMatches(find, p.name, p.label));
  return (
    <VStack align="stretch" spacing={2}>
      {all.length > 12 && <Input size="sm" value={find} onChange={(e) => setFind(e.target.value)} placeholder={t('Find a table…')} aria-label={t('Find a table')} maxW="320px" />}
      <Wrap spacing={1.5}>
        {matching.slice(0, SHOWN_TABLES).map((p) => (
          <Chip key={p.name} onClick={() => onPick(p.name)} testId={`quick-table-${p.name}`} title={[p.showTechnical ? p.name : null, p.description].filter(Boolean).join(' — ') || undefined}>
            {p.label}
          </Chip>
        ))}
      </Wrap>
      {matching.length > SHOWN_TABLES && (
        <Text fontSize="xs" color="faintText">
          {t('{n} more: type to find them', { n: matching.length - SHOWN_TABLES })}
        </Text>
      )}
      {matching.length === 0 && (
        <Text fontSize="sm" color="faintText">
          {t('No table matches.')}
        </Text>
      )}
    </VStack>
  );
}

interface PartProps {
  parts: QuickParts;
  model: QuickModel;
  onChange: (patch: Partial<QuickParts>) => void;
}

function SeeSection({ parts, model, onChange }: PartProps) {
  const options = SEE().filter((o) => !o.number || model.numbers.length > 0);
  const ref = parts.see.ref && model.numbers.some((n) => n.ref === parts.see.ref) ? parts.see.ref : model.numbers[0]?.ref;
  const needsNumber = ['sum', 'avg', 'min', 'max'].includes(parts.see.fn);
  return (
    <Section title={t('What do you want to see?')} testId="quick-see">
      <Wrap spacing={1.5}>
        {options.map((o) => (
          <Chip key={o.fn} active={parts.see.fn === o.fn} onClick={() => onChange({ see: o.number ? { fn: o.fn, ref } : { fn: o.fn } })} testId={`quick-see-${o.fn}`}>
            {o.label}
          </Chip>
        ))}
      </Wrap>
      {needsNumber && (
        <HStack spacing={2} mt={2}>
          <Text fontSize="sm" color="mutedText">
            {t('of')}
          </Text>
          {model.numbers.length > 1 ? (
            <Select size="sm" maxW="260px" value={ref} onChange={(e) => onChange({ see: { ...parts.see, ref: e.target.value } })} aria-label={t('Number column')} data-testid="quick-see-column">
              {model.numbers.map((n) => (
                <option key={n.ref} value={n.ref} title={n.description ?? undefined}>
                  {n.label}
                </option>
              ))}
            </Select>
          ) : (
            <Text fontSize="sm" fontWeight={600} title={model.numbers[0]?.description ?? undefined}>
              {model.numbers[0]?.label}
            </Text>
          )}
        </HStack>
      )}
      {parts.see.fn === 'rows' && (
        <Text fontSize="xs" color="faintText" mt={1.5}>
          {t('Every row as it is stored, with the names of related rows in place of their numbers.')}
        </Text>
      )}
    </Section>
  );
}

function SplitSection({ parts, model, onChange }: PartProps) {
  const first = model.categories.slice(0, SHOWN_CATEGORIES);
  const more = model.categories.slice(SHOWN_CATEGORIES);
  const pickedMore = more.find((c) => c.ref === parts.category);
  const dateRef = parts.time?.ref ?? mainDate(parts, model);
  const setCategory = (ref: string | null) => onChange({ category: ref, top: ref ? parts.top : null });
  if (model.categories.length === 0 && model.dates.length === 0) return null;
  return (
    <Section title={t('Split by')} hint={t('One row (a bar, a line) per value. Pick one, a period, or both.')} testId="quick-split">
      {model.categories.length > 0 && (
        <Wrap spacing={1.5}>
          {first.map((c) => (
            <Chip key={c.ref} active={parts.category === c.ref} onClick={() => setCategory(parts.category === c.ref ? null : c.ref)} testId={`quick-split-${c.ref}`} title={hintOf(c)}>
              {c.label}
            </Chip>
          ))}
          {more.length > 0 && (
            <WrapItem>
              <Select
                size="sm"
                maxW="200px"
                value={pickedMore?.ref ?? ''}
                variant={pickedMore ? 'filled' : 'outline'}
                onChange={(e) => setCategory(e.target.value || null)}
                aria-label={t('More columns')}
                data-testid="quick-split-more"
              >
                <option value="">{t('More…')}</option>
                {more.map((c) => (
                  <option key={c.ref} value={c.ref} title={hintOf(c)}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </WrapItem>
          )}
        </Wrap>
      )}
      {dateRef && (
        <Flex align="center" gap={2} wrap="wrap" mt={2.5}>
          <Text fontSize="sm" color="mutedText">
            {t('Over time')}
          </Text>
          {model.dates.length > 1 && (
            <Select
              size="sm"
              w="auto"
              maxW="200px"
              value={dateRef}
              onChange={(e) => onChange({ time: parts.time ? { ...parts.time, ref: e.target.value } : null, when: parts.when ? { ...parts.when, ref: e.target.value } : null })}
              aria-label={t('Date column')}
              data-testid="quick-time-column"
            >
              {model.dates.map((d) => (
                <option key={d.ref} value={d.ref}>
                  {d.label}
                </option>
              ))}
            </Select>
          )}
          <Wrap spacing={1.5}>
            {TIME_BUCKETS.map((bucket) => {
              const active = parts.time?.bucket === bucket;
              return (
                <Chip key={bucket} active={active} onClick={() => onChange({ time: active ? null : { ref: dateRef, bucket }, top: active ? parts.top : null })} testId={`quick-time-${bucket}`}>
                  {PER()[bucket]}
                </Chip>
              );
            })}
          </Wrap>
        </Flex>
      )}
    </Section>
  );
}

const NUMBER_OPS: { op: FilterOp; label: string }[] = [
  { op: '>=', label: '≥' },
  { op: '<=', label: '≤' },
  { op: '=', label: '=' },
  { op: '!=', label: '≠' },
];

function WhereSection({ parts, model, onChange, connection }: PartProps & { connection: string }) {
  const dateRef = mainDate(parts, model);
  // categories by their names (a key column shown by its related name is filtered by that name)
  const columns = [
    ...model.categories.map((c) => ({ ref: c.filterRef ?? c.ref, label: c.label, type: c.filterRef ? 'string' : c.type, hint: hintOf(c) })),
    ...model.numbers.map((c) => ({ ref: c.ref, label: c.label, type: c.type, hint: hintOf(c) })),
  ];
  const setWhere = (i: number, c: Condition | null) => onChange({ where: c ? parts.where.map((x, k) => (k === i ? c : x)) : parts.where.filter((_, k) => k !== i) });
  const fresh = (ref: string): Condition => {
    const type = columns.find((c) => c.ref === ref)?.type;
    return type === 'number' ? { ref, op: '>=', value: '' } : type === 'boolean' ? { ref, op: 'is_true' } : { ref, op: 'in', value: [] };
  };
  return (
    <Section title={t('Only where')} hint={t('Leave it as it is to use every row.')} testId="quick-where">
      {dateRef && (
        <Flex align="center" gap={2} wrap="wrap" mb={2.5}>
          <Text fontSize="sm" color="mutedText">
            {model.dates.find((d) => d.ref === dateRef)?.label ?? t('When')}
          </Text>
          <Wrap spacing={1.5}>
            <Chip active={!parts.when} onClick={() => onChange({ when: null })} testId="quick-when-any">
              {t('Any time')}
            </Chip>
            {DATE_PRESETS.map((preset) => (
              <Chip key={preset} active={parts.when?.preset === preset} onClick={() => onChange({ when: { ref: dateRef, preset } })} testId={`quick-when-${preset}`}>
                {PRESET()[preset]}
              </Chip>
            ))}
          </Wrap>
        </Flex>
      )}
      <VStack align="stretch" spacing={2}>
        {parts.where.map((c, i) => {
          const column = columns.find((x) => x.ref === c.ref);
          return (
            <Flex key={`${i}-${c.ref}`} gap={2} align="center" wrap="wrap" data-testid="quick-where-row">
              <Select size="sm" maxW="200px" value={c.ref} onChange={(e) => setWhere(i, fresh(e.target.value))} aria-label={t('Filter column')}>
                {columns.map((x) => (
                  <option key={x.ref} value={x.ref} title={x.hint}>
                    {x.label}
                  </option>
                ))}
              </Select>
              {column?.type === 'number' ? (
                <>
                  <Select size="sm" w="auto" value={c.op} onChange={(e) => setWhere(i, { ...c, op: e.target.value as FilterOp })} aria-label={t('Operator')}>
                    {NUMBER_OPS.map((o) => (
                      <option key={o.op} value={o.op}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                  <Input size="sm" type="number" maxW="120px" value={String(c.value ?? '')} onChange={(e) => setWhere(i, { ...c, value: e.target.value === '' ? '' : Number(e.target.value) })} aria-label={t('Value')} />
                </>
              ) : column?.type === 'boolean' ? (
                <Select size="sm" w="auto" value={c.op} onChange={(e) => setWhere(i, { ref: c.ref, op: e.target.value as FilterOp })} aria-label={t('Value')}>
                  <option value="is_true">{t('yes')}</option>
                  <option value="is_false">{t('no')}</option>
                </Select>
              ) : (
                <>
                  <Text fontSize="sm" color="mutedText">
                    {t('is')}
                  </Text>
                  <ValuePicker
                    connection={connection}
                    table={splitRef(c.ref ?? '', model)?.table ?? parts.table}
                    column={splitRef(c.ref ?? '', model)?.column ?? ''}
                    type={column?.type}
                    multiple
                    value={c.value}
                    onChange={(value) => setWhere(i, { ...c, op: 'in', value: Array.isArray(value) ? value : [] })}
                    maxW="100%"
                    testId="quick-where-value"
                  />
                </>
              )}
              <IconButton aria-label={t('Remove filter')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => setWhere(i, null)} />
            </Flex>
          );
        })}
        {columns.length > 0 && (
          <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange({ where: [...parts.where, fresh(columns[0].ref)] })} data-testid="quick-add-where">
            {t('Add a condition')}
          </Button>
        )}
      </VStack>
    </Section>
  );
}

function TopSection({ parts, model, onChange }: PartProps) {
  const on = !!parts.top;
  const value = parts.see.fn === 'count' ? t('Count of rows') : model.numbers.find((n) => n.ref === parts.see.ref)?.label;
  return (
    <Section title={t('Top N')} testId="quick-top">
      <Flex align="center" gap={2} wrap="wrap">
        <Switch size="sm" id="quick-top" isChecked={on} onChange={(e) => onChange({ top: e.target.checked ? 10 : null })} data-testid="quick-top-switch" />
        <Text as="label" htmlFor="quick-top" fontSize="sm">
          {t('Only the biggest')}
        </Text>
        {on && (
          <>
            <Input size="sm" type="number" min={1} maxW="80px" value={parts.top ?? ''} onChange={(e) => onChange({ top: Math.max(1, Number(e.target.value) || 1) })} aria-label={t('How many')} data-testid="quick-top-n" />
            {value && (
              <Text fontSize="sm" color="mutedText">
                {t('by {value}', { value })}
              </Text>
            )}
          </>
        )}
      </Flex>
    </Section>
  );
}
