import { useEffect, useMemo, useState } from 'react';
import {
  Badge, Box, Button, Flex, FormControl, FormHelperText, FormLabel, HStack, IconButton, Input, InputGroup, InputLeftElement, Link,
  Select, SimpleGrid, Skeleton, Switch, Text, Textarea, Tooltip, VStack, Wrap, WrapItem, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { LoadError } from '../components/LoadError';
import { PageHeader } from '../components/PageHeader';
import { glossary, useGlossary } from '../glossary/api';
import {
  canSave, bodyOf, draftOf, groupByLetter, linkKey, otherNames, termDefinition, termName,
} from '../glossary/logic.ts';
import type { ColumnLink, GlossaryTerm, MetricLink, QuestionLink, RelatedLink, TermDraft } from '../glossary/logic.ts';
import { ArchiveIcon, BookIcon, ChartIcon, PencilIcon, PlusIcon, RefreshIcon, SearchIcon, TableIcon, TrashIcon, XIcon } from '../icons';
import { metricName, nameOf } from '../lib/names.ts';
import { useNames } from '../lib/useNames';
import { useQuestions } from '../library/api';
import { ConfirmDialog, DialogShell } from '../library/dialogs';
import { VerifiedBadge } from '../library/VerifiedBadge';
import { useSchema } from '../query/useSchema';
import { useMetrics } from '../semantic/api';
import { useWorkspace } from '../workspace/useWorkspace';
import { t } from '../i18n/index.ts';

/** /glossary: business terms in plain words, searchable in English and Russian (M11). */
export default function GlossaryPage() {
  const ws = useWorkspace();
  const [search, setSearch] = useSearchParams();
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const [editing, setEditing] = useState<GlossaryTerm | 'new' | null>(null);
  const focus = Number(search.get('term')) || null;
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(text.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [text]);
  const list = useGlossary({ q: query || undefined, archived: archived || undefined });

  // "See glossary: Scrap rate" links here with ?term=<id>: show that term
  useEffect(() => {
    if (focus && list.data) document.getElementById(`term-${focus}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focus, list.data]);

  const groups = useMemo(() => (query || archived ? null : groupByLetter(list.data ?? [])), [list.data, query, archived]);
  const card = (term: GlossaryTerm) => (
    <TermCard key={term.id} term={term} focused={term.id === focus} isAdmin={ws.isAdmin} onEdit={() => setEditing(term)} />
  );

  return (
    <VStack align="stretch" spacing={5} maxW="960px">
      <PageHeader
        title={t('Glossary')}
        subtitle={t('What the words in reports mean here, in plain language, with the metrics, columns and questions they belong to.')}
        actions={
          ws.isAdmin && (
            <HStack spacing={3} wrap="wrap">
              <HStack as="label" spacing={2} fontSize="sm" color="mutedText" cursor="pointer">
                <Switch size="sm" isChecked={archived} onChange={(e) => setArchived(e.target.checked)} data-testid="glossary-archived" />
                <Text>{t('Archived terms')}</Text>
              </HStack>
              <Button size="sm" variant="brand" leftIcon={<PlusIcon boxSize={4} />} onClick={() => setEditing('new')} data-testid="glossary-add">
                {t('Add a term')}
              </Button>
            </HStack>
          )
        }
      />
      <InputGroup>
        <InputLeftElement pointerEvents="none">
          <SearchIcon boxSize={4} color="faintText" />
        </InputLeftElement>
        <Input
          placeholder={t('Find a term, in English or Russian…')}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (focus) setSearch((prev) => { const next = new URLSearchParams(prev); next.delete('term'); return next; }, { replace: true });
          }}
          bg="panelBg"
          data-testid="glossary-search"
        />
      </InputGroup>

      {list.isPending ? (
        <Skeleton h="160px" borderRadius="xl" />
      ) : list.isError ? (
        <LoadError error={list.error} title={t('Could not load the glossary')} onRetry={() => void list.refetch()} />
      ) : list.data.length === 0 ? (
        query ? (
          <Text fontSize="sm" color="mutedText" data-testid="glossary-nothing">
            {t('No term matches “{query}”.', { query })}
          </Text>
        ) : archived ? (
          <Text fontSize="sm" color="mutedText">
            {t('The archive is empty.')}
          </Text>
        ) : (
          <EmptyGlossary isAdmin={ws.isAdmin} onAdd={() => setEditing('new')} />
        )
      ) : archived ? (
        <VStack align="stretch" spacing={2}>
          {list.data.map((term) => (
            <ArchivedRow key={term.id} term={term} />
          ))}
        </VStack>
      ) : groups ? (
        <VStack align="stretch" spacing={5}>
          {groups.map((g) => (
            <Box key={g.letter}>
              <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText" mb={2}>
                {g.letter}
              </Text>
              <VStack align="stretch" spacing={3}>
                {g.terms.map(card)}
              </VStack>
            </Box>
          ))}
        </VStack>
      ) : (
        <VStack align="stretch" spacing={3}>
          {list.data.map(card)}
        </VStack>
      )}

      {editing && <TermDialog term={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </VStack>
  );
}

// ---------------------------------------------------------------- one term

function TermCard({ term, focused, isAdmin, onEdit }: { term: GlossaryTerm; focused: boolean; isAdmin: boolean; onEdit: () => void }) {
  const toast = useToast();
  const others = otherNames(term);
  const archive = async () => {
    try {
      await glossary.archive(term.id, true);
      toast({ status: 'info', title: t('“{name}” archived', { name: termName(term) }), description: t('Admins find it under “Archived terms”.'), duration: 4000 });
    } catch (e) {
      toast({ status: 'error', title: t('Could not archive'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  return (
    <Box
      id={`term-${term.id}`}
      bg="panelBg"
      border="1px solid"
      borderColor={focused ? 'brand.400' : 'lineColor'}
      boxShadow={focused ? '0 0 0 3px rgba(99, 102, 241, 0.25)' : undefined}
      borderRadius="xl"
      px={4}
      py={3}
      data-testid="glossary-term"
    >
      <Flex align="flex-start" gap={2}>
        <Box flex={1} minW={0}>
          <Text as="h3" fontWeight={700} fontSize="md">
            {termName(term)}
          </Text>
          {others.length > 0 && (
            <Text fontSize="xs" color="mutedText">
              {t('Also called: {names}', { names: others.join(', ') })}
            </Text>
          )}
        </Box>
        {isAdmin && (
          <HStack spacing={0}>
            <Tooltip label={t('Edit')} hasArrow>
              <IconButton aria-label={t('Edit {name}', { name: termName(term) })} size="xs" variant="ghost" icon={<PencilIcon boxSize={3.5} />} onClick={onEdit} data-testid="glossary-edit" />
            </Tooltip>
            <Tooltip label={t('Archive')} hasArrow>
              <IconButton aria-label={t('Archive {name}', { name: termName(term) })} size="xs" variant="ghost" icon={<ArchiveIcon boxSize={3.5} />} onClick={() => void archive()} data-testid="glossary-archive" />
            </Tooltip>
          </HStack>
        )}
      </Flex>
      <Text fontSize="sm" mt={1.5} whiteSpace="pre-wrap">
        {termDefinition(term)}
      </Text>
      {term.related.length > 0 && <RelatedLinks links={term.related} />}
    </Box>
  );
}

function RelatedLinks({ links }: { links: RelatedLink[] }) {
  const groups: [string, RelatedLink[]][] = [
    [t('Metrics'), links.filter((l) => l.kind === 'metric')],
    [t('Columns'), links.filter((l) => l.kind === 'column')],
    [t('Questions'), links.filter((l) => l.kind === 'question')],
  ];
  return (
    <VStack align="stretch" spacing={1} mt={2.5}>
      {groups
        .filter(([, items]) => items.length > 0)
        .map(([label, items]) => (
          <Flex key={label} gap={2} align="baseline" wrap="wrap">
            <Text fontSize="xs" color="faintText" fontWeight={600} minW="72px">
              {label}
            </Text>
            <Wrap spacing={1.5} flex={1}>
              {items.map((link) => (
                <WrapItem key={linkKey(link)}>
                  <LinkChip link={link} />
                </WrapItem>
              ))}
            </Wrap>
          </Flex>
        ))}
    </VStack>
  );
}

function LinkChip({ link }: { link: RelatedLink }) {
  const state = link.missing ? (
    <Badge fontSize="2xs" colorScheme="red">{t('missing')}</Badge>
  ) : link.archived ? (
    <Badge fontSize="2xs">{t('archived')}</Badge>
  ) : null;
  return (
    <HStack spacing={1} opacity={link.missing || link.archived ? 0.6 : 1}>
      {link.kind === 'metric' ? <MetricChip link={link} /> : link.kind === 'column' ? <ColumnChip link={link} /> : <QuestionChip link={link} />}
      {state}
    </HStack>
  );
}

const chip = { fontSize: 'sm', px: 2, py: 0.5, borderRadius: 'md', bg: 'chipBg', display: 'inline-flex', alignItems: 'center', gap: 1.5 } as const;

function MetricChip({ link }: { link: MetricLink }) {
  const ws = useWorkspace();
  const navigate = useNavigate();
  const name = link.name ? metricName({ name: link.name, translations: link.translations }) : `#${link.id}`;
  const open = () => {
    if (link.connection) ws.selectConnection(link.connection);
    navigate('/questions');
  };
  return (
    <Tooltip label={t('A metric: pick it when you build a question')} hasArrow>
      <Link as="button" type="button" onClick={open} {...chip} data-testid="glossary-metric">
        <ChartIcon boxSize={3.5} color="brand.400" />
        {name}
      </Link>
    </Tooltip>
  );
}

function ColumnChip({ link }: { link: ColumnLink }) {
  const ws = useWorkspace();
  const names = useNames(link.connection);
  const column = nameOf(link.column, { display_name: link.display_name, translations: link.translations });
  const db = ws.connections.find((c) => c.key === link.connection)?.label ?? link.connection;
  const open = () => {
    ws.selectConnection(link.connection);
    ws.openInExplorer(link.table);
  };
  return (
    <Tooltip label={t('{db} · {table}.{column} · open the table', { db, table: link.table, column: link.column })} hasArrow>
      <Link as="button" type="button" onClick={open} {...chip} data-testid="glossary-column">
        <TableIcon boxSize={3.5} color="teal.400" />
        {names.table(link.table)} · {column}
      </Link>
    </Tooltip>
  );
}

function QuestionChip({ link }: { link: QuestionLink }) {
  return (
    <Link as={RouterLink} to={`/questions/${link.id}`} {...chip} data-testid="glossary-question">
      <ChartIcon boxSize={3.5} color="cyan.400" />
      {link.name ?? `#${link.id}`}
      <VerifiedBadge verified={link.verified} size="xs" />
    </Link>
  );
}

function ArchivedRow({ term }: { term: GlossaryTerm }) {
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const restore = async () => {
    try {
      await glossary.archive(term.id, false);
    } catch (e) {
      toast({ status: 'error', title: t('Could not restore'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    }
  };
  return (
    <Flex align="center" gap={3} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" px={3} py={2}>
      <Box flex={1} minW={0}>
        <Text fontWeight={600} fontSize="sm" noOfLines={1}>
          {termName(term)}
        </Text>
        <Text fontSize="xs" color="mutedText" noOfLines={1}>
          {termDefinition(term)}
        </Text>
      </Box>
      <Button size="xs" variant="subtle" leftIcon={<RefreshIcon boxSize={3} />} onClick={() => void restore()}>
        {t('Restore')}
      </Button>
      <IconButton aria-label={t('Delete {name}', { name: termName(term) })} size="xs" variant="ghost" icon={<TrashIcon boxSize={3.5} />} onClick={() => setDeleting(true)} />
      <ConfirmDialog
        isOpen={deleting}
        onClose={() => setDeleting(false)}
        title={t('Delete this term?')}
        confirmLabel={t('Delete')}
        body={t('“{name}” is removed for good.', { name: termName(term) })}
        onConfirm={() => glossary.remove(term.id)}
      />
    </Flex>
  );
}

function EmptyGlossary({ isAdmin, onAdd }: { isAdmin: boolean; onAdd: () => void }) {
  return (
    <VStack bg="panelBg" border="1px dashed" borderColor="lineColor" borderRadius="2xl" px={6} py={10} spacing={4} textAlign="center" data-testid="glossary-empty">
      <BookIcon boxSize={8} color="brand.300" />
      <Text fontWeight={650} fontSize="lg">
        {t('No terms yet')}
      </Text>
      <Text fontSize="sm" color="mutedText" maxW="480px">
        {t('The glossary explains the words your team uses in reports, once for everybody. For example:')}
      </Text>
      <Box bg="chipBg" borderRadius="lg" px={4} py={2.5} fontSize="sm" textAlign="left" maxW="480px">
        <Text as="span" fontWeight={700}>
          OEE
        </Text>{' '}
        — {t('Overall equipment effectiveness: availability × performance × quality')}
      </Box>
      {isAdmin ? (
        <Button size="sm" variant="brand" leftIcon={<PlusIcon boxSize={4} />} onClick={onAdd}>
          {t('Add the first term')}
        </Button>
      ) : (
        <Text fontSize="xs" color="faintText" maxW="420px">
          {t('Admins add the terms; ask yours to explain the words you meet in reports.')}
        </Text>
      )}
    </VStack>
  );
}

// ---------------------------------------------------------------- the editor (admins)

function TermDialog({ term, onClose }: { term: GlossaryTerm | null; onClose: () => void }) {
  const [draft, setDraft] = useState<TermDraft>(() => draftOf(term));
  const set = (patch: Partial<TermDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const add = (link: RelatedLink) => setDraft((d) => (d.related.some((l) => linkKey(l) === linkKey(link)) ? d : { ...d, related: [...d.related, link] }));
  const remove = (key: string) => setDraft((d) => ({ ...d, related: d.related.filter((l) => linkKey(l) !== key) }));
  return (
    <DialogShell
      isOpen
      onClose={onClose}
      title={term ? t('Edit “{name}”', { name: term.term }) : t('New term')}
      submitLabel={t('Save')}
      size="2xl"
      canSubmit={canSave(draft)}
      onSubmit={() => (term ? glossary.update(term.id, bodyOf(draft, term)) : glossary.create(bodyOf(draft)))}
    >
      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4}>
        <VStack align="stretch" spacing={3}>
          <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
            {t('ENGLISH (OR THE MAIN LANGUAGE)')}
          </Text>
          <FormControl isRequired>
            <FormLabel fontSize="sm">{t('Term')}</FormLabel>
            <Input size="sm" value={draft.term} onChange={(e) => set({ term: e.target.value })} maxLength={120} placeholder="OEE" autoFocus data-testid="term-name" />
          </FormControl>
          <FormControl isRequired>
            <FormLabel fontSize="sm">{t('What it means')}</FormLabel>
            <Textarea
              size="sm"
              rows={4}
              value={draft.definition}
              onChange={(e) => set({ definition: e.target.value })}
              maxLength={5000}
              placeholder={t('Overall equipment effectiveness: availability × performance × quality')}
              data-testid="term-definition"
            />
          </FormControl>
        </VStack>
        <VStack align="stretch" spacing={3}>
          <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText">
            {t('RUSSIAN')}
          </Text>
          <FormControl>
            <FormLabel fontSize="sm">{t('Term')}</FormLabel>
            <Input size="sm" value={draft.ruTerm} onChange={(e) => set({ ruTerm: e.target.value })} maxLength={120} placeholder="OEE" lang="ru" data-testid="term-name-ru" />
          </FormControl>
          <FormControl>
            <FormLabel fontSize="sm">{t('What it means')}</FormLabel>
            <Textarea
              size="sm"
              rows={4}
              value={draft.ruDefinition}
              onChange={(e) => set({ ruDefinition: e.target.value })}
              maxLength={5000}
              placeholder="Общая эффективность оборудования: доступность × производительность × качество"
              lang="ru"
              data-testid="term-definition-ru"
            />
          </FormControl>
        </VStack>
      </SimpleGrid>
      <FormControl>
        <FormLabel fontSize="sm">{t('Other names')}</FormLabel>
        <Input size="sm" value={draft.synonyms} onChange={(e) => set({ synonyms: e.target.value })} placeholder={t('e.g. overall efficiency, ОЭО')} data-testid="term-synonyms" />
        <FormHelperText fontSize="xs">{t('Separated by commas, in any language: people find the term by these words too.')}</FormHelperText>
      </FormControl>
      <Box>
        <Text fontSize="sm" fontWeight={500} mb={1}>
          {t('Related metrics, columns and questions')}
        </Text>
        {draft.related.length > 0 ? (
          <Wrap spacing={1.5} mb={2}>
            {draft.related.map((link) => (
              <WrapItem key={linkKey(link)}>
                <HStack spacing={0.5}>
                  <LinkChip link={link} />
                  <IconButton aria-label={t('Remove link')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => remove(linkKey(link))} />
                </HStack>
              </WrapItem>
            ))}
          </Wrap>
        ) : (
          <Text fontSize="xs" color="mutedText" mb={2}>
            {t('None yet. Link the metric that computes it, the columns that hold it, or the question that answers it.')}
          </Text>
        )}
        <LinkPicker onAdd={add} />
      </Box>
    </DialogShell>
  );
}

type PickKind = 'metric' | 'column' | 'question';

function LinkPicker({ onAdd }: { onAdd: (link: RelatedLink) => void }) {
  const ws = useWorkspace();
  const [kind, setKind] = useState<PickKind>('metric');
  const [connection, setConnection] = useState(ws.activeKey);
  const [picked, setPicked] = useState('');
  const [table, setTable] = useState('');
  const [text, setText] = useState('');
  const metrics = useMetrics(kind === 'metric' ? connection : '');
  const schema = useSchema(kind === 'column' ? connection : '');
  const questions = useQuestions({ q: text.trim() || undefined, limit: 30 }, kind === 'question');
  const columns = schema.data?.tables.find((tb) => tb.name === table)?.columns ?? [];
  const reset = () => {
    setPicked('');
    setTable('');
  };

  const link = (): RelatedLink | null => {
    if (!picked) return null;
    if (kind === 'metric') {
      const m = metrics.data?.find((x) => String(x.id) === picked);
      return m ? { kind: 'metric', id: m.id, name: m.name, connection: m.connection } : null;
    }
    if (kind === 'column') {
      const c = columns.find((x) => x.name === picked);
      return c && table ? { kind: 'column', connection, table, column: c.name, display_name: c.display_name ?? null } : null;
    }
    const q = questions.data?.find((x) => String(x.id) === picked);
    return q ? { kind: 'question', id: q.id, name: q.name, verified: q.verified } : null;
  };
  const ready = link();

  return (
    <Flex gap={2} wrap="wrap" align="center" data-testid="link-picker">
      <Select size="sm" w="140px" value={kind} onChange={(e) => { setKind(e.target.value as PickKind); reset(); }} aria-label={t('What to link')}>
        <option value="metric">{t('Metric')}</option>
        <option value="column">{t('Column')}</option>
        <option value="question">{t('Question')}</option>
      </Select>
      {kind !== 'question' && (
        <Select size="sm" w="170px" value={connection} onChange={(e) => { setConnection(e.target.value); reset(); }} aria-label={t('Database')}>
          {ws.connections.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </Select>
      )}
      {kind === 'metric' && (
        <Select size="sm" flex={1} minW="160px" value={picked} placeholder={t('Pick a metric…')} onChange={(e) => setPicked(e.target.value)} aria-label={t('Metric')}>
          {(metrics.data ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {metricName(m)}
            </option>
          ))}
        </Select>
      )}
      {kind === 'column' && (
        <>
          <Select size="sm" flex={1} minW="140px" value={table} placeholder={t('Table…')} onChange={(e) => { setTable(e.target.value); setPicked(''); }} aria-label={t('Table')}>
            {(schema.data?.tables ?? []).map((tb) => (
              <option key={tb.name} value={tb.name}>
                {tb.name}
              </option>
            ))}
          </Select>
          <Select size="sm" flex={1} minW="140px" value={picked} placeholder={t('Column…')} isDisabled={!table} onChange={(e) => setPicked(e.target.value)} aria-label={t('Column')}>
            {columns.map((c) => (
              <option key={c.name} value={c.name}>
                {c.display_name ? `${c.name} (${c.display_name})` : c.name}
              </option>
            ))}
          </Select>
        </>
      )}
      {kind === 'question' && (
        <>
          <Input size="sm" flex={1} minW="140px" value={text} onChange={(e) => { setText(e.target.value); setPicked(''); }} placeholder={t('Find a question…')} />
          <Select size="sm" flex={1} minW="160px" value={picked} placeholder={t('Pick a question…')} onChange={(e) => setPicked(e.target.value)} aria-label={t('Question')}>
            {(questions.data ?? []).map((q) => (
              <option key={q.id} value={q.id}>
                {q.name}
              </option>
            ))}
          </Select>
        </>
      )}
      <Button size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={3.5} />} isDisabled={!ready} onClick={() => { if (ready) { onAdd(ready); setPicked(''); } }} data-testid="link-add">
        {t('Add link')}
      </Button>
    </Flex>
  );
}
