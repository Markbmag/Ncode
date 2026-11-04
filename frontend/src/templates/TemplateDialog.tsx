import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, FormControl, FormHelperText, FormLabel, Grid, Input, Modal, ModalBody, ModalCloseButton,
  ModalContent, ModalFooter, ModalHeader, ModalOverlay, Select, SimpleGrid, Skeleton, Spinner, Text, VStack,
} from '@chakra-ui/react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { Visualization } from '../components/viz/Visualization';
import { LoadError } from '../components/LoadError';
import { CheckIcon, ChevronRightIcon, LayoutIcon, SparklesIcon } from '../icons';
import { useCollections } from '../library/api';
import { CollectionPicker } from '../library/dialogs';
import type { TaskSnapshot } from '../query/useQueryRun';
import { effectiveViz } from '../viz/state';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';
import { templates, useTemplates } from './api';
import { NO_ANSWERS, answer, canSkip, parseMinutes, requestMapping, roleGroups } from './logic';
import type { Answers } from './logic';
import type { Suggestion, TemplateInfo, TemplatePlan, TemplateRole } from './types';

const SKIP = '__skip__';

/** "New dashboard from a template": pick one, answer its questions about the data, see a card, create. */
export function TemplateDialog({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  return isOpen ? <TemplateFlow onClose={onClose} /> : null;
}

function TemplateFlow({ onClose }: { onClose: () => void }) {
  const ws = useWorkspace();
  const list = useTemplates();
  const [connection, setConnection] = useState(() => ws.connections.find((c) => c.source === 'demo')?.key ?? ws.activeKey);
  const [picked, setPicked] = useState<TemplateInfo | null>(null);
  return (
    <Modal isOpen onClose={onClose} size={picked ? '5xl' : '2xl'} scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent data-testid="template-dialog">
        <ModalHeader fontSize="lg">{picked ? picked.name : t('New dashboard from a template')}</ModalHeader>
        <ModalCloseButton />
        {picked ? (
          <MappingStep key={`${picked.id}:${connection}`} template={picked} connection={connection} onBack={() => setPicked(null)} onClose={onClose} />
        ) : (
          <ModalBody pb={6}>
            <VStack align="stretch" spacing={4}>
              <Text fontSize="md" color="mutedText">
                {t('Pick a ready-made dashboard. Ncode asks a few questions about your data, then makes ordinary questions and a dashboard you can change.')}
              </Text>
              <FormControl>
                <FormLabel fontSize="md" fontWeight={600}>{t('Which database holds the data?')}</FormLabel>
                <Select value={connection} onChange={(e) => setConnection(e.target.value)} data-testid="template-connection">
                  {ws.connections.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </Select>
              </FormControl>
              {list.isPending && <Skeleton h="160px" />}
              {list.isError && <LoadError compact error={list.error} title={t('Could not load the templates')} onRetry={() => void list.refetch()} />}
              <SimpleGrid columns={{ base: 1, md: 2 }} spacing={3}>
                {list.data?.map((tpl) => (
                  <Box
                    key={tpl.id}
                    as="button"
                    type="button"
                    textAlign="left"
                    p={4}
                    border="1px solid"
                    borderColor="lineColor"
                    borderRadius="xl"
                    bg="panelBg"
                    _hover={{ bg: 'panelHover', borderColor: 'green.400' }}
                    onClick={() => connection && setPicked(tpl)}
                    disabled={!connection}
                    data-testid={`template-${tpl.id}`}
                  >
                    <Flex align="center" gap={2} mb={1}>
                      <LayoutIcon boxSize={5} color="green.400" />
                      <Text fontSize="md" fontWeight={700}>{tpl.name}</Text>
                    </Flex>
                    <Text fontSize="sm" color="mutedText">{tpl.description}</Text>
                  </Box>
                ))}
              </SimpleGrid>
            </VStack>
          </ModalBody>
        )}
      </ModalContent>
    </Modal>
  );
}

function MappingStep({ template, connection, onBack, onClose }: { template: TemplateInfo; connection: string; onBack: () => void; onClose: () => void }) {
  const navigate = useNavigate();
  const collections = useCollections();
  const [answers, setAnswers] = useState<Answers>(NO_ANSWERS);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [name, setName] = useState(template.name);
  const [collection, setCollection] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const asked = useRef(0);

  // the server fills in what it can guess, each time an answer changes
  const requestJson = JSON.stringify(requestMapping(answers));
  useEffect(() => {
    const n = ++asked.current;
    templates.suggest(template.id, connection, JSON.parse(requestJson) as Record<string, string | number | null>).then(
      (res) => {
        if (n !== asked.current) return;
        setSuggestion(res);
        setSuggestError(null);
        setAnswers((prev) => (JSON.stringify(prev.mapping) === JSON.stringify(res.mapping) ? prev : { ...prev, mapping: res.mapping }));
      },
      (e: unknown) => n === asked.current && setSuggestError(apiErrorMessage(e, t('Could not read the database'))),
    );
  }, [template.id, connection, requestJson]);

  const ready = suggestion !== null && suggestion.complete && JSON.stringify(suggestion.mapping) === JSON.stringify(answers.mapping);
  const preview = usePreview(template.id, connection, ready ? JSON.stringify(answers.mapping) : null);
  const target = collection ?? collections.data?.personal_id ?? null;
  const pick = (key: string, value: string | number | null) => setAnswers((prev) => answer(template, prev, key, value));

  const create = async () => {
    setBusy(true);
    setCreateError(null);
    try {
      const made = await templates.create(template.id, { connection, mapping: answers.mapping, collection_id: target, name: name.trim() });
      onClose();
      navigate(`/dashboards/${made.dashboard.id}`);
    } catch (e) {
      setCreateError(apiErrorMessage(e, t('That did not work')));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <ModalBody>
        <Grid templateColumns={{ base: '1fr', lg: 'minmax(0, 1fr) minmax(0, 1fr)' }} gap={6}>
          <VStack align="stretch" spacing={5} data-testid="template-questions">
            <Text fontSize="md" color="mutedText">
              {t('Answer in your own data’s words. Ncode has guessed where it could; check the guesses and change them if needed.')}
            </Text>
            {suggestError && <Alert status="error" borderRadius="lg"><AlertIcon />{suggestError}</Alert>}
            {!suggestion && !suggestError && <Skeleton h="200px" />}
            {suggestion &&
              roleGroups(template, answers).map((group) => (
                <VStack key={group.table?.key ?? 'values'} align="stretch" spacing={3} p={3} border="1px solid" borderColor="lineColor" borderRadius="xl">
                  {group.table && <RoleField role={group.table} answers={answers} suggestion={suggestion} onPick={pick} />}
                  {group.columns.map((role) => (
                    <RoleField key={role.key} role={role} answers={answers} suggestion={suggestion} onPick={pick} />
                  ))}
                </VStack>
              ))}
          </VStack>
          <VStack align="stretch" spacing={4}>
            <PreviewPane suggestion={suggestion} preview={preview} />
            <FormControl isRequired>
              <FormLabel fontSize="md" fontWeight={600}>{t('Name of the dashboard')}</FormLabel>
              <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={200} data-testid="template-name" />
            </FormControl>
            <FormControl isRequired>
              <FormLabel fontSize="md" fontWeight={600}>{t('Collection')}</FormLabel>
              <CollectionPicker value={target} onChange={setCollection} />
              <FormHelperText fontSize="sm">{t('People who can see the collection can see the dashboard and its questions.')}</FormHelperText>
            </FormControl>
            {createError && <Alert status="error" borderRadius="lg"><AlertIcon />{createError}</Alert>}
          </VStack>
        </Grid>
      </ModalBody>
      <ModalFooter gap={2}>
        <Button variant="ghost" onClick={onBack}>{t('Back')}</Button>
        <Button
          variant="brand"
          size="lg"
          onClick={() => void create()}
          isLoading={busy}
          isDisabled={!ready || !name.trim() || target === null || preview.plan === null || preview.error !== null}
          leftIcon={<CheckIcon boxSize={4} />}
          data-testid="template-create"
        >
          {t('Create')}
        </Button>
      </ModalFooter>
    </>
  );
}

function RoleField({ role, answers, suggestion, onPick }: {
  role: TemplateRole; answers: Answers; suggestion: Suggestion; onPick: (key: string, value: string | number | null) => void;
}) {
  const guessed = suggestion.suggested.includes(role.key) && answers.mapping[role.key] !== undefined;
  const label = (
    <FormLabel fontSize={role.kind === 'table' ? 'md' : 'sm'} fontWeight={role.kind === 'table' ? 700 : 600} mb={1}>
      {role.ask}
      {guessed && (
        <Badge ml={2} colorScheme="green" fontSize="2xs" verticalAlign="middle">
          <SparklesIcon boxSize={3} /> {t('suggested')}
        </Badge>
      )}
    </FormLabel>
  );
  // keyed by the value: a value filled in by the server starts the field afresh
  if (role.kind === 'value') return <ValueField key={String(answers.mapping[role.key])} role={role} answers={answers} onPick={onPick} label={label} />;
  const value = answers.mapping[role.key];
  const options = suggestion.options[role.key] ?? [];
  return (
    <FormControl isRequired={!canSkip(role)} data-testid={`role-${role.key}`}>
      {label}
      <Select
        value={value === undefined ? (answers.skipped.includes(role.key) ? SKIP : '') : String(value)}
        onChange={(e) => onPick(role.key, e.target.value === SKIP ? null : e.target.value || null)}
        aria-label={role.ask}
      >
        {value === undefined && !answers.skipped.includes(role.key) && <option value="">{t('Choose…')}</option>}
        {canSkip(role) && <option value={SKIP}>{t('Not in my data')}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label === o.detail ? o.label : `${o.label}  (${o.detail})`}
          </option>
        ))}
      </Select>
      {role.help && <FormHelperText fontSize="sm">{role.help}</FormHelperText>}
    </FormControl>
  );
}

function ValueField({ role, answers, onPick, label }: {
  role: TemplateRole; answers: Answers; onPick: (key: string, value: string | number | null) => void; label: React.ReactNode;
}) {
  const current = answers.mapping[role.key];
  const [text, setText] = useState(current === undefined ? '' : String(current));
  const bad = text.trim() !== '' && parseMinutes(text) === null;
  return (
    <FormControl isInvalid={bad} data-testid={`role-${role.key}`}>
      {label}
      <Input
        inputMode="numeric"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          const n = parseMinutes(text);
          if (text.trim() === '') onPick(role.key, null);
          else if (n !== null && n !== current) onPick(role.key, n);
        }}
        maxW="160px"
        aria-label={role.ask}
      />
      {role.help && <FormHelperText fontSize="sm">{role.help}</FormHelperText>}
    </FormControl>
  );
}

interface PreviewState {
  plan: TemplatePlan | null;
  task: TaskSnapshot | null;
  error: string | null;
  loading: boolean;
}

const NO_PREVIEW: PreviewState = { plan: null, task: null, error: null, loading: false };

/** The plan for the current answers and one card running (debounced; a newer answer cancels the wait). */
function usePreview(templateId: string, connection: string, mappingJson: string | null): PreviewState {
  const [state, setState] = useState<PreviewState & { key: string | null }>({ ...NO_PREVIEW, key: null });
  useEffect(() => {
    if (mappingJson === null) return;
    let alive = true;
    const timer = setTimeout(async () => {
      try {
        const plan = await templates.preview(templateId, connection, JSON.parse(mappingJson));
        if (!alive) return;
        let task = plan.preview.task;
        setState({ key: mappingJson, plan, task, error: null, loading: task.status === 'running' });
        while (alive && task.status === 'running') {
          task = (await http.get<TaskSnapshot>(`/api/query/tasks/${task.task_id}`, { params: { wait_ms: 5000 } })).data;
        }
        if (alive) setState({ key: mappingJson, plan, task, error: null, loading: false });
      } catch (e) {
        if (alive) setState({ key: mappingJson, ...NO_PREVIEW, error: apiErrorMessage(e, t('The preview could not be made')) });
      }
    }, 400);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [templateId, connection, mappingJson]);
  if (mappingJson === null) return NO_PREVIEW;
  // answers changed: the last plan stays in view while the new one loads
  return state.key === mappingJson ? state : { ...state, error: null, loading: true };
}

function PreviewPane({ suggestion, preview }: { suggestion: Suggestion | null; preview: PreviewState }) {
  const { plan, task } = preview;
  const result = task?.status === 'completed' ? task.result : null;
  const viz = useMemo(() => (plan && result ? effectiveViz(plan.preview.viz, result).spec : null), [plan, result]);
  if (suggestion && !suggestion.complete)
    return (
      <Box p={4} borderRadius="xl" bg="panelHover" data-testid="template-lacking">
        <Text fontSize="md" fontWeight={600} mb={2}>{t('Still to answer:')}</Text>
        {suggestion.error && <Text color="red.400" fontSize="sm" mb={2}>{suggestion.error}</Text>}
        {suggestion.lacking.map((q) => (
          <Flex key={q} gap={2} fontSize="sm" align="center">
            <ChevronRightIcon boxSize={4} /> {q}
          </Flex>
        ))}
      </Box>
    );
  if (preview.error) return <Alert status="error" borderRadius="lg"><AlertIcon />{preview.error}</Alert>;
  if (!plan) return <Skeleton h="260px" borderRadius="xl" />;
  return (
    <VStack align="stretch" spacing={3} data-testid="template-preview">
      <Box border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" bg="panelBg">
        <Text fontSize="sm" fontWeight={700} px={3} pt={2.5}>{plan.preview.name}</Text>
        <Box h="220px" px={1}>
          {task?.status === 'error' ? (
            <Text fontSize="sm" color="red.400" p={3}>{task.error}</Text>
          ) : result && viz ? (
            <Visualization result={result} viz={viz} />
          ) : (
            <Flex h="100%" align="center" justify="center"><Spinner size="sm" color="faintText" /></Flex>
          )}
        </Box>
      </Box>
      <Box>
        <Text fontSize="md" fontWeight={600} mb={1}>{t('The dashboard will have these cards:')}</Text>
        {plan.cards.map((c) => (
          <Flex key={c.key} gap={2} fontSize="sm" align="center">
            <CheckIcon boxSize={4} color="green.400" /> {c.title}
          </Flex>
        ))}
        {plan.missing.length > 0 && (
          <Box mt={2} data-testid="template-missing">
            <Text fontSize="md" fontWeight={600} mb={1}>{t('Left out, because the data has no column for it:')}</Text>
            {plan.missing.map((m) => (
              <Text key={m.name} fontSize="sm" color="mutedText">
                {m.name}: {m.reason}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    </VStack>
  );
}
