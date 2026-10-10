import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Checkbox, Collapse, Flex, HStack, Input, Select, Skeleton, Switch, Text, Tooltip,
  VStack, Wrap, WrapItem, useBreakpointValue, useDisclosure,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { NoConnectionsState } from '../components/EmptyStates';
import { EngineBadge } from '../components/EngineBadge';
import { Split } from '../components/layout/Split';
import { CustomColumnsEditor } from '../components/query/CustomColumnsEditor';
import { FilterEditor } from '../components/query/FilterEditor';
import { JoinEditor } from '../components/query/JoinEditor';
import { SortEditor } from '../components/query/SortEditor';
import { SqlPreviewModal } from '../components/query/SqlPreviewModal';
import { Step } from '../components/query/Step';
import { SummarizeEditor } from '../components/query/SummarizeEditor';
import { CodeIcon, RefreshIcon } from '../icons';
import { loadJson, saveJson } from '../lib/storage';
import { columnOptions, humanize, isSummarised, newSpec, prepareSpec, summaryOutputs } from '../query/draft';
import type { SchemaInfo } from '../query/draft';
import type { FilterGroup, QuerySpec } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { useSchema } from '../query/useSchema';
import { DEFAULT_VIZ } from '../viz/state';
import type { VizState } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';

const EMPTY_GROUP: FilterGroup = { op: 'and', rules: [] };
const draftKey = (connection: string) => `ncode_question_${connection}`;

/** Questions: the notebook-style builder (one draft per database, kept in this browser tab). */
export default function QuestionsPage() {
  const ws = useWorkspace();
  if (!ws.loaded) return <Skeleton h="400px" borderRadius="2xl" />;
  if (!ws.active) return <NoConnectionsState isAdmin={ws.isAdmin} onAdd={ws.openAddConnection} />;
  return <Builder key={ws.activeKey} connection={ws.activeKey} />;
}

function Builder({ connection }: { connection: string }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const schemaQuery = useSchema(connection);
  const [draft, setDraft] = useState<QuerySpec | null>(() => {
    try {
      const raw = sessionStorage.getItem(draftKey(connection));
      return raw ? (JSON.parse(raw) as QuerySpec) : null;
    } catch {
      return null;
    }
  });
  const [autoPreview, setAutoPreview] = useState(() => loadJson('ncode_auto_preview', true));
  const [smartDates, setSmartDates] = useState(() => loadJson('ncode_smart_dates', false));
  const [showFields, setShowFields] = useState(false);
  const [viz, setViz] = useState<VizState>(() => {
    try {
      const raw = sessionStorage.getItem(`${draftKey(connection)}_viz`);
      return raw ? (JSON.parse(raw) as VizState) : DEFAULT_VIZ;
    } catch {
      return DEFAULT_VIZ;
    }
  });
  const sqlModal = useDisclosure();
  const { state, run, cancel } = useQueryRun();
  const vertical = useBreakpointValue({ base: true, lg: false }) ?? false;

  useEffect(() => saveJson('ncode_auto_preview', autoPreview), [autoPreview]);
  useEffect(() => {
    try {
      sessionStorage.setItem(`${draftKey(connection)}_viz`, JSON.stringify(viz));
    } catch {
      // a convenience only
    }
  }, [viz, connection]);
  useEffect(() => saveJson('ncode_smart_dates', smartDates), [smartDates]);
  useEffect(() => {
    try {
      if (draft) sessionStorage.setItem(draftKey(connection), JSON.stringify(draft));
      else sessionStorage.removeItem(draftKey(connection));
    } catch {
      // the draft is a convenience
    }
  }, [draft, connection]);

  const schema: SchemaInfo | null = useMemo(
    () => (schemaQuery.data ? { tables: schemaQuery.data.tables, relationships: schemaQuery.data.relationships } : null),
    [schemaQuery.data],
  );
  const tableNames = useMemo(() => (schema ? schema.tables.map((t) => t.name).sort((a, b) => a.localeCompare(b)) : []), [schema]);
  const validDraft = draft && schema && tableNames.includes(draft.source.table) ? draft : null;

  const prepared = useMemo(() => (validDraft && schema ? prepareSpec(validDraft, schema) : null), [validDraft, schema]);
  const preparedJson = prepared ? JSON.stringify(prepared.spec) : '';

  const runNow = () => {
    if (!prepared || prepared.problems.length > 0) return;
    const spec = prepared.spec;
    void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec, wait_ms: START_WAIT_MS })).data);
  };

  // Live preview: run shortly after the question stops changing.
  useEffect(() => {
    if (!autoPreview || !preparedJson || (prepared?.problems.length ?? 0) > 0) return;
    const timer = window.setTimeout(() => {
      const spec = JSON.parse(preparedJson) as QuerySpec;
      void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec, wait_ms: START_WAIT_MS })).data);
    }, 700);
    return () => window.clearTimeout(timer);
  }, [preparedJson, autoPreview, prepared?.problems.length, run]);

  // Ctrl/Cmd+Enter runs now
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        runNow();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  if (schemaQuery.isPending) return <Skeleton h="400px" borderRadius="2xl" />;
  if (schemaQuery.isError || !schema)
    return (
      <Alert status="error" borderRadius="xl">
        <AlertIcon />
        {apiErrorMessage(schemaQuery.error, 'Could not read the database structure')}
      </Alert>
    );

  const update = (patch: Partial<QuerySpec>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const pickSource = (table: string) => setDraft(table ? { ...newSpec(connection, table), limit: draft?.limit } : null);

  const options = validDraft ? columnOptions(validDraft, schema) : [];
  const summarised = validDraft ? isSummarised(validDraft) : false;
  const outputs = validDraft && summarised ? summaryOutputs(validDraft, options) : [];
  const outputOptions = outputs.map((o) => ({ ref: o.name, label: o.name, type: o.type }));
  const baseOptions = validDraft ? columnOptions({ ...validDraft, expressions: [] }, schema) : [];

  const builder = (
    <Box h="100%" overflowY="auto" pr={{ base: 0, lg: 3 }} pb={6} data-testid="builder">
      <VStack align="stretch" spacing={4}>
        <Step title="Data" color="brand.300" testId="step-data">
          <Select size="sm" value={validDraft?.source.table ?? ''} onChange={(e) => pickSource(e.target.value)} placeholder="Pick a table…" aria-label="Table">
            {tableNames.map((t) => (
              <option key={t} value={t}>
                {humanize(t)}
              </option>
            ))}
          </Select>
        </Step>

        {validDraft && (
          <>
            <Step title="Join" color="teal.300" testId="step-join">
              <JoinEditor spec={validDraft} schema={schema} onChange={(joins) => update({ joins })} />
            </Step>

            <Step title="Custom columns" color="cyan.300" hint="Formulas such as [total] - [discount] or round([total] / [qty], 2).">
              <CustomColumnsEditor columns={validDraft.expressions ?? []} onChange={(expressions) => update({ expressions })} options={baseOptions} />
            </Step>

            <Step title="Filter" color="purple.300" testId="step-filter">
              <FilterEditor group={validDraft.filters ?? EMPTY_GROUP} onChange={(filters) => update({ filters })} options={options} />
            </Step>

            <Step title="Summarise" color="green.300" testId="step-summarise">
              <SummarizeEditor
                aggregations={validDraft.aggregations ?? []}
                breakouts={validDraft.breakouts ?? []}
                options={options}
                onChange={(aggregations, breakouts) => update({ aggregations, breakouts, ...(isSummarised({ ...validDraft, aggregations, breakouts }) ? {} : { having: null }) })}
              />
            </Step>

            {summarised ? (
              <Step title="Filter the summary" color="pink.300" hint="Like HAVING in SQL: e.g. only groups whose total is above 1000.">
                <FilterEditor group={validDraft.having ?? EMPTY_GROUP} onChange={(having) => update({ having })} options={outputOptions} emptyText="Every group is shown." />
              </Step>
            ) : (
              <Step
                title="Columns"
                color="blue.300"
                actions={
                  <Button size="xs" variant="ghost" onClick={() => setShowFields((v) => !v)}>
                    {showFields ? 'Done' : 'Choose'}
                  </Button>
                }
              >
                <Text fontSize="sm" color="mutedText">
                  {validDraft.fields?.length ? `${validDraft.fields.length} chosen` : 'All columns'}
                </Text>
                <Collapse in={showFields} animateOpacity>
                  <Wrap spacing={2} pt={2}>
                    {options.map((o) => {
                      const chosen = (validDraft.fields ?? []).some((f) => f.ref === o.ref);
                      return (
                        <WrapItem key={o.ref}>
                          <Checkbox
                            size="sm"
                            isChecked={chosen}
                            onChange={(e) =>
                              update({ fields: e.target.checked ? [...(validDraft.fields ?? []), { ref: o.ref }] : (validDraft.fields ?? []).filter((f) => f.ref !== o.ref) })
                            }
                          >
                            <Text fontSize="xs">{o.label}</Text>
                          </Checkbox>
                        </WrapItem>
                      );
                    })}
                  </Wrap>
                </Collapse>
              </Step>
            )}

            <Step title="Sort" color="orange.300">
              <SortEditor order={validDraft.order ?? []} options={summarised ? outputOptions : options} onChange={(order) => update({ order })} />
            </Step>

            <Step title="Row limit" color="gray.400">
              <HStack>
                <Input
                  size="sm"
                  type="number"
                  min={1}
                  max={ws.limits.query_max_rows}
                  maxW="140px"
                  placeholder={String(ws.limits.query_default_rows)}
                  value={validDraft.limit ?? ''}
                  onChange={(e) => update({ limit: e.target.value ? Math.min(Number(e.target.value), ws.limits.query_max_rows ?? 10000) : null })}
                  aria-label="Row limit"
                />
                <Text fontSize="xs" color="faintText">
                  at most {(ws.limits.query_max_rows ?? 10000).toLocaleString()}
                </Text>
              </HStack>
            </Step>
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
      <ResultView
        state={state}
        onCancel={cancel}
        smartDates={smartDates}
        onSmartDates={setSmartDates}
        filename={`${ws.active?.label ?? connection}_${validDraft?.source.table ?? 'question'}`}
        viz={viz}
        onVizChange={setViz}
        empty={
          <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
            {validDraft ? 'Run the question to see the result (Ctrl/Cmd + Enter).' : 'Pick a table to start. The result appears here while you build.'}
          </Flex>
        }
      />
    </Box>
  );

  return (
    <Flex direction="column" h="100%" gap={3}>
      <Flex align="center" gap={3} wrap="wrap">
        {ws.active && <EngineBadge engine={ws.active.engine} size={32} />}
        <Box>
          <Text fontSize="lg" fontWeight={700} lineHeight="1.2">
            New question
          </Text>
          <Text fontSize="xs" color="mutedText">
            {ws.active?.label}
            {validDraft && ` · ${humanize(validDraft.source.table)}`}
          </Text>
        </Box>
        <Box flex={1} />
        <HStack spacing={2}>
          <Tooltip label="Run automatically after each change" hasArrow>
            <HStack spacing={1.5}>
              <Switch size="sm" id="auto-preview" isChecked={autoPreview} onChange={(e) => setAutoPreview(e.target.checked)} />
              <Text as="label" htmlFor="auto-preview" fontSize="xs" color="mutedText">
                Live preview
              </Text>
            </HStack>
          </Tooltip>
          {summarised && <Badge colorScheme="green">summarised</Badge>}
          <Button size="sm" variant="subtle" leftIcon={<CodeIcon boxSize={4} />} onClick={sqlModal.onOpen} isDisabled={!prepared || prepared.problems.length > 0} data-testid="view-sql">
            View SQL
          </Button>
          <Button size="sm" leftIcon={<RefreshIcon boxSize={4} />} onClick={runNow} isDisabled={!prepared || prepared.problems.length > 0} data-testid="run-question">
            Run
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} isDisabled={!draft}>
            Start over
          </Button>
        </HStack>
      </Flex>

      <Box flex={1} minH={0} h={{ base: 'auto', lg: undefined }}>
        {vertical ? (
          <VStack align="stretch" spacing={4}>
            {builder}
            <Box h="70vh">{results}</Box>
          </VStack>
        ) : (
          <Split id="question-split" first={builder} second={results} defaultFirst="42%" minFirst="28%" minSecond="30%" />
        )}
      </Box>

      {prepared && (
        <SqlPreviewModal
          isOpen={sqlModal.isOpen}
          onClose={sqlModal.onClose}
          spec={prepared.spec}
          engine={ws.active?.engine}
          onOpenInEditor={(sql) => navigate('/sql', { state: { connection, sql } })}
        />
      )}
    </Flex>
  );
}
