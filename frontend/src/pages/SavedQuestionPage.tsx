import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Box, Button, Flex, HStack, IconButton, Skeleton, Text, VStack, useToast,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { Link as RouterLink, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { CopyIcon, PencilIcon, RefreshIcon, SaveIcon } from '../icons';
import { SMART_DATES_DEFAULT, SMART_DATES_KEY } from '../lib/format';
import { connectionLabel, tableLabel } from '../lib/names';
import { loadJson, saveJson } from '../lib/storage';
import { library, useQuestion } from '../library/api';
import type { SavedQuestion } from '../library/api';
import { withBase } from '../library/conflict';
import { useEditConflict } from '../library/ConflictDialog';
import { EDIT_PARAM, EditorModeContext, withEditing } from '../library/editorMode';
import { ParametersBar } from '../library/ParametersBar';
import { bindSpec, shapeOf, specParams, valuesFromSearch, valuesToSearch } from '../library/params';
import type { ParamShape, ParamValue, ParamValues } from '../library/params';
import { QuestionHeader } from '../library/QuestionHeader';
import { labelColumns } from '../query/outputs';
import type { QuerySpec } from '../query/types';
import { useQuestionCaption } from '../query/useCaption';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { DEFAULT_VIZ } from '../viz/state';
import type { VizState } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';
import { Builder } from './QuestionsPage';
import { CombineWorkspace } from './CombinePage';
import { SqlWorkbench } from './SqlPage';
import { t } from '../i18n/index.ts';
import { LoadError } from '../components/LoadError';

/**
 * /questions/:id - a saved question, opened as its result (M12). "Edit" (?edit=1) opens the builder,
 * the SQL editor or Combine around it; people who may only view it get "Duplicate to edit".
 */
export default function SavedQuestionPage() {
  const id = Number(useParams().id);
  const ws = useWorkspace();
  const question = useQuestion(id);
  const q = question.data;
  const [search, setSearch] = useSearchParams();
  const { selectConnection, activeKey } = ws;
  const usable = !!q && ws.connections.some((c) => c.key === q.connection);
  const canEdit = q?.access === 'edit';
  const editing = canEdit && search.get(EDIT_PARAM) === '1';
  // opening the editor is a step the browser's Back undoes; going back to the result replaces it
  const setEditing = useCallback((on: boolean) => setSearch((prev) => withEditing(prev, on), { replace: !on }), [setSearch]);
  const editorMode = useMemo(() => ({ onDone: () => setEditing(false) }), [setEditing]);

  // Opening a question also selects its database in the sidebar, once. The editors work on the
  // question's own database either way, so picking another one in the sidebar later is harmless.
  const synced = useRef<number | null>(null);
  useEffect(() => {
    if (!q || !usable || synced.current === q.id) return;
    synced.current = q.id;
    if (q.connection !== activeKey) selectConnection(q.connection);
  }, [q, usable, activeKey, selectConnection]);

  if (question.isPending || !ws.loaded) return <Skeleton h="400px" borderRadius="2xl" />;
  if (question.isError || !q)
    return (
      <LoadError
        error={question.error ?? new Error('missing')}
        title={t('This question could not be opened')}
        onRetry={() => void question.refetch()}
        actions={
          <Button as={RouterLink} to="/library" size="sm" variant="ghost">
            {t('Go to the library')}
          </Button>
        }
      />
    );
  if (q.kind !== 'federated' && !usable) return <NoDatabase q={q} />;
  if (!editing) return <QuestionView key={q.id} q={q} onEdit={canEdit ? () => setEditing(true) : null} />;
  return (
    <EditorModeContext.Provider value={editorMode}>
      {q.kind === 'federated' ? (
        <CombineWorkspace key={q.id} saved={q} />
      ) : q.kind === 'sql' ? (
        <SqlWorkbench key={q.id} connection={q.connection} initialSql={null} saved={q} />
      ) : (
        <Builder key={q.id} connection={q.connection} saved={q} />
      )}
    </EditorModeContext.Provider>
  );
}

const blank = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** A value worth sending: something typed, and both ends of a "between". */
function filled(value: ParamValue, shape: ParamShape | undefined): boolean {
  if (Array.isArray(value)) return shape === 'pair' ? value.length === 2 && !value.some(blank) : value.some((v) => !blank(v));
  return !blank(value);
}

/** The result of a saved question, full width: parameters, chart or table, caption and description. */
function QuestionView({ q, onEdit }: { q: SavedQuestion; onEdit: (() => void) | null }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const toast = useToast();
  const conn = ws.connections.find((c) => c.key === q.connection);
  const [searchParams, setSearchParams] = useSearchParams();
  const [values, setValuesState] = useState<ParamValues>(() => valuesFromSearch(searchParams));
  const setValues = (next: ParamValues) => {
    setValuesState(next);
    setSearchParams((prev) => valuesToSearch(next, prev), { replace: true }); // a shareable link with the values
  };
  // another look (table / chart, chart settings): just for now, or saved by those who may edit
  const [ownViz, setOwnViz] = useState<VizState | null>(null);
  const viz = ownViz ?? q.viz ?? DEFAULT_VIZ;
  const vizChanged = ownViz !== null && JSON.stringify(ownViz) !== JSON.stringify(q.viz ?? DEFAULT_VIZ);
  const [savingViz, setSavingViz] = useState(false);
  const conflict = useEditConflict();
  const [smartDates, setSmartDates] = useState(() => loadJson(SMART_DATES_KEY, SMART_DATES_DEFAULT));
  useEffect(() => saveJson(SMART_DATES_KEY, smartDates), [smartDates]);
  const { state, run, cancel } = useQueryRun();
  const named = useQuestionCaption(q);

  const spec = q.kind === 'builder' ? (q.spec as QuerySpec) : null;
  const shapes = useMemo(() => {
    const out: Record<string, ParamShape> = {};
    if (spec) for (const use of specParams(spec)) out[use.name] ??= shapeOf(use.op);
    return out;
  }, [spec]);
  // required builder parameters are asked for before running; only filled-in values are sent
  const missing = spec ? bindSpec(spec, q.parameters, values).missing : [];
  const params = JSON.stringify(Object.fromEntries(Object.entries(values).filter(([name, v]) => filled(v, shapes[name]))));
  const start = useCallback(
    (refresh = false) =>
      void run(async () => (await http.post<TaskSnapshot>(`/api/questions/${q.id}/run`, { params: JSON.parse(params), wait_ms: START_WAIT_MS, ...(refresh ? { refresh: true } : {}) })).data),
    [q.id, params, run],
  );
  const blocked = missing.length > 0;
  useEffect(() => {
    if (blocked) return;
    const timer = window.setTimeout(() => start(), 250); // values typed in quick succession run once
    return () => window.clearTimeout(timer);
  }, [start, blocked]);

  const shown = useMemo(
    () => (state.result && named.labels ? { ...state, result: { ...state.result, columns: labelColumns(state.result.columns, named.labels) } } : state),
    [state, named.labels],
  );
  const rowLimit = (q.spec as { limit?: number | null } | null)?.limit ?? null;
  const subtitle = q.kind === 'federated' ? null : [conn ? connectionLabel(conn) : q.connection, spec ? tableLabel(q.connection, spec.source.table) : null].filter(Boolean).join(' · ');

  const saveViz = async (overwrite = false): Promise<void> => {
    if (!ownViz) return;
    setSavingViz(true);
    try {
      await library.updateQuestion(q.id, withBase({ viz: ownViz }, q.updated_at, overwrite)); // a new chart keeps the Verified badge
      toast({ status: 'success', title: t('Saved'), duration: 1500 });
    } catch (e) {
      const offered = conflict.offer(e, {
        reload: async () => {
          await library.reloadQuestion(q.id);
          setOwnViz(null);
        },
        overwrite: () => saveViz(true),
      });
      if (!offered) toast({ status: 'error', title: t('Could not save'), description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
    } finally {
      setSavingViz(false);
    }
  };
  const duplicateToEdit = async () => {
    try {
      const copy = await library.duplicate(q.id);
      toast({ status: 'success', title: copy.collection?.name ? t('Saved to {name}', { name: copy.collection.name }) : t('Saved to the library'), duration: 2500 });
      navigate(`/questions/${copy.id}?${EDIT_PARAM}=1`);
    } catch (e) {
      toast({ status: 'error', title: t('Could not duplicate'), description: apiErrorMessage(e, t('Please try again')), duration: 6000, isClosable: true });
    }
  };
  const primary = onEdit ? (
    <HStack spacing={2}>
      {vizChanged && (
        <>
          <Tooltip label={t('Back to the saved chart')} hasArrow>
            <IconButton aria-label={t('Back to the saved chart')} size="sm" variant="ghost" icon={<RefreshIcon boxSize={4} />} onClick={() => setOwnViz(null)} data-testid="reset-chart" />
          </Tooltip>
          <Button size="sm" variant="subtle" leftIcon={<SaveIcon boxSize={4} />} isLoading={savingViz} onClick={() => void saveViz()} data-testid="save-chart">
            {t('Save the chart')}
          </Button>
        </>
      )}
      <Button size="sm" variant="brand" leftIcon={<PencilIcon boxSize={4} />} onClick={onEdit} data-testid="edit-question">
        {t('Edit')}
      </Button>
    </HStack>
  ) : (
    <Tooltip label={t('You can only view this question. A copy of your own can be changed.')} hasArrow openDelay={300}>
      <Button size="sm" variant="brand" leftIcon={<CopyIcon boxSize={4} />} onClick={() => void duplicateToEdit()} data-testid="duplicate-to-edit">
        {t('Duplicate to edit')}
      </Button>
    </Tooltip>
  );

  return (
    <Flex direction="column" h="100%" gap={3} data-testid="question-view">
      <QuestionHeader engine={conn?.engine} title={q.name} subtitle={subtitle} saved={q} dirty={false} payload={() => null} defaultName={q.name} viewing primary={primary} />
      {conflict.dialog}
      {q.description && (
        // on a phone the result comes first, the description after it
        <Text order={{ base: 2, lg: 0 }} fontSize="sm" color="mutedText" whiteSpace="pre-wrap" noOfLines={4} title={q.description} data-testid="question-description">
          {q.description}
        </Text>
      )}
      <Flex direction="column" flex={{ base: 'none', lg: 1 }} h={{ base: '70vh', lg: 'auto' }} minH={{ base: 0, lg: '240px' }} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid="question-result">
        {blocked && (
          <Alert status="warning" fontSize="sm">
            <AlertIcon />
            {missing.map((m) => t('Give a value for “{name}”', { name: m })).join(' · ')}
          </Alert>
        )}
        <ParametersBar defs={q.parameters} shapes={shapes} values={values} onValues={setValues} onDefs={null} />
        <Box flex={1} minH={0}>
          <ResultView
            state={shown}
            onCancel={cancel}
            smartDates={smartDates}
            onSmartDates={setSmartDates}
            filename={q.name}
            viz={viz}
            onVizChange={setOwnViz}
            caption={shown.result ? named.caption : null}
            rowLimit={rowLimit}
            onRefresh={() => start(true)}
            empty={
              <Flex h="100%" align="center" justify="center" p={6} color="mutedText" fontSize="sm" textAlign="center">
                {blocked ? t('Fill in the values above to see the result.') : t('Loading…')}
              </Flex>
            }
          />
        </Box>
      </Flex>
    </Flex>
  );
}

function NoDatabase({ q }: { q: SavedQuestion }) {
  return (
    <VStack align="stretch" spacing={4}>
      <QuestionHeader title={q.name} saved={q} dirty={false} payload={() => null} defaultName={q.name} viewing />
      <Alert status="warning" borderRadius="xl">
        <AlertIcon />
        {t('This question uses the database “{name}”, which you do not have access to. Ask an admin for access to run it.', { name: q.connection })}
      </Alert>
    </VStack>
  );
}
