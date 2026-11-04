/**
 * History of a question or a dashboard (M15): who saved it, when, and what changed; any version can
 * be opened read-only - a question with its result and its SQL or query, a dashboard as a small
 * picture of its layout with its cards and filters - and restored. Restoring keeps the version
 * shown now in the history too, so it can be undone the same way.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Code, Drawer, DrawerBody, DrawerCloseButton, DrawerContent, DrawerFooter, DrawerHeader,
  DrawerOverlay, Flex, HStack, Skeleton, Text, VStack, useToast,
} from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { apiErrorMessage, http } from '../api';
import { ResultView } from '../components/data/ResultView';
import { ChevronRightIcon, HistoryIcon } from '../icons';
import { SMART_DATES_DEFAULT } from '../lib/format';
import { captionOf } from '../query/caption';
import type { QuerySpec } from '../query/types';
import { START_WAIT_MS, useQueryRun } from '../query/useQueryRun';
import type { TaskSnapshot } from '../query/useQueryRun';
import { localDateText } from '../viz/format';
import type { VizState } from '../viz/state';
import { DialogShell } from './dialogs';
import { cardLabel, previewBoxes, restoreNotes, savedLine } from './versions';
import type { DashboardVersionData, HistoryKind, QuestionVersionData, VersionDetail, VersionInfo } from './versions';
import { useVersions, versionKeys, versions } from './versionsApi';
import type { SavedQuestion } from './api';
import { t, tn } from '../i18n/index.ts';

interface Props {
  kind: HistoryKind;
  id: number;
  isOpen: boolean;
  onClose: () => void;
  canEdit: boolean;
  /** questions: the saved question now (the Verified badge note when restoring) */
  question?: SavedQuestion | null;
  /** the restored question or dashboard, as the server answered */
  onRestored?: (item: unknown) => void;
}

export function HistoryDrawer({ kind, id, isOpen, onClose, canEdit, question, onRestored }: Props) {
  const [open, setOpen] = useState<number | null>(null); // the version looked at; null = the list
  const close = () => {
    setOpen(null);
    onClose();
  };
  return (
    <Drawer isOpen={isOpen} onClose={close} size={open === null ? 'md' : 'xl'} placement="right">
      <DrawerOverlay />
      <DrawerContent data-testid="history-drawer">
        <DrawerCloseButton />
        {isOpen && (
          <HistoryInner kind={kind} id={id} open={open} setOpen={setOpen} canEdit={canEdit} question={question} onClose={close} onRestored={onRestored} />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function HistoryInner({ kind, id, open, setOpen, canEdit, question, onClose, onRestored }: Omit<Props, 'isOpen'> & { open: number | null; setOpen: (n: number | null) => void }) {
  const list = useVersions(kind, id);
  const items = list.data?.versions ?? [];
  const info = items.find((v) => v.version === open) ?? null;
  return (
    <>
      <DrawerHeader fontSize="lg" pr={12}>
        <HStack spacing={2}>
          <HistoryIcon boxSize={5} />
          <Text>{open === null ? t('History') : t('Version {n}', { n: open })}</Text>
        </HStack>
        {open === null && (
          <Text fontSize="sm" fontWeight={400} color="mutedText" mt={1}>
            {kind === 'question'
              ? t('Every time the question is saved, the version is kept here. Open one to look at it, or restore it.')
              : t('Every time the dashboard is saved, the version is kept here. Open one to look at it, or restore it.')}
          </Text>
        )}
      </DrawerHeader>
      <DrawerBody>
        {list.isPending && <Skeleton h="160px" borderRadius="xl" />}
        {list.isError && (
          <Alert status="error" borderRadius="lg" fontSize="sm">
            <AlertIcon />
            {apiErrorMessage(list.error, t('The history could not be loaded'))}
          </Alert>
        )}
        {list.data && open === null && <VersionList items={items} keep={list.data.keep} onOpen={setOpen} />}
        {open !== null && <VersionView kind={kind} id={id} n={open} info={info} />}
      </DrawerBody>
      <DrawerFooter gap={2} flexWrap="wrap">
        {open !== null ? (
          <>
            <Button size="md" variant="ghost" onClick={() => setOpen(null)} data-testid="history-back">
              {t('Back to the list')}
            </Button>
            <Box flex={1} />
            {canEdit && info && !info.current && (
              <RestoreButton kind={kind} id={id} info={info} question={question} onDone={(item) => { onRestored?.(item); setOpen(null); onClose(); }} />
            )}
            {info?.current && (
              <Text fontSize="sm" color="mutedText">
                {t('This is the version you see now.')}
              </Text>
            )}
          </>
        ) : (
          <Button size="md" variant="ghost" onClick={onClose}>
            {t('Close')}
          </Button>
        )}
      </DrawerFooter>
    </>
  );
}

function VersionList({ items, keep, onOpen }: { items: VersionInfo[]; keep: number; onOpen: (n: number) => void }) {
  if (!items.length)
    return (
      <Text fontSize="md" color="mutedText">
        {t('No saved versions yet. The next save starts the history.')}
      </Text>
    );
  return (
    <VStack align="stretch" spacing={2} data-testid="history-list">
      {items.map((v) => (
        <Flex
          key={v.version}
          as="button"
          type="button"
          onClick={() => onOpen(v.version)}
          align="center"
          gap={3}
          textAlign="left"
          px={4}
          py={3}
          minH="56px"
          border="1px solid"
          borderColor="lineColor"
          borderRadius="xl"
          bg="panelBg"
          _hover={{ borderColor: 'brand.400' }}
          data-testid={`history-version-${v.version}`}
        >
          <Box flex={1} minW={0}>
            <HStack spacing={2}>
              <Text fontSize="md" fontWeight={600}>
                {v.summary || t('Saved')}
              </Text>
              {v.current && <Badge colorScheme="green">{t('now')}</Badge>}
            </HStack>
            <Text fontSize="sm" color="mutedText">
              {t('Version {n}', { n: v.version })} · {savedLine(v)}
            </Text>
          </Box>
          <ChevronRightIcon boxSize={4} color="faintText" />
        </Flex>
      ))}
      {items.length >= keep && (
        <Text fontSize="sm" color="faintText" pt={1}>
          {tn(keep, 'Only the newest {n} version is kept.', 'Only the newest {n} versions are kept.')}
        </Text>
      )}
    </VStack>
  );
}

function VersionView({ kind, id, n, info }: { kind: HistoryKind; id: number; n: number; info: VersionInfo | null }) {
  const detail = useQuery({
    queryKey: [...versionKeys.list(kind, id), n],
    queryFn: () => versions.get<QuestionVersionData | DashboardVersionData>(kind, id, n),
    staleTime: Infinity, // a saved version never changes
  });
  if (detail.isPending) return <Skeleton h="240px" borderRadius="xl" />;
  if (detail.isError || !detail.data)
    return (
      <Alert status="error" borderRadius="lg" fontSize="sm">
        <AlertIcon />
        {apiErrorMessage(detail.error, t('This version could not be opened'))}
      </Alert>
    );
  const v = detail.data;
  return (
    <VStack align="stretch" spacing={4} data-testid="history-version">
      <Box>
        <Text fontSize="md" fontWeight={600}>
          {(info ?? v).summary || t('Saved')}
        </Text>
        <Text fontSize="sm" color="mutedText">
          {savedLine(v)}
        </Text>
        <Text fontSize="sm" color="mutedText" mt={1}>
          {t('A saved version: you can look at it here. Nothing changes until you restore it.')}
        </Text>
      </Box>
      {kind === 'question' ? (
        <QuestionVersion id={id} n={n} data={v.data as QuestionVersionData} />
      ) : (
        <DashboardVersion v={v as VersionDetail<DashboardVersionData>} />
      )}
    </VStack>
  );
}

function QuestionVersion({ id, n, data }: { id: number; n: number; data: QuestionVersionData }) {
  const { state, run, cancel } = useQueryRun();
  const [smartDates, setSmartDates] = useState(SMART_DATES_DEFAULT);
  useEffect(() => {
    void run(async () => (await http.post<TaskSnapshot>(versions.runUrl(id, n), { params: {}, wait_ms: START_WAIT_MS })).data);
  }, [id, n, run]);
  const caption = data.kind === 'builder' ? captionOf({ kind: 'builder', spec: data.spec as unknown as QuerySpec, description: data.description }) : null;
  const sql = data.kind === 'sql' ? String((data.spec as { sql?: string }).sql ?? '') : data.kind === 'federated' ? String((data.spec as { sql?: string }).sql ?? '') : '';
  return (
    <>
      <Box>
        <Text fontSize="xl" fontWeight={700}>
          {data.name}
        </Text>
        {data.description && (
          <Text fontSize="sm" color="mutedText" whiteSpace="pre-wrap">
            {data.description}
          </Text>
        )}
      </Box>
      <Box h="340px" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid="history-result">
        <ResultView
          state={state}
          onCancel={cancel}
          smartDates={smartDates}
          onSmartDates={setSmartDates}
          filename={t('{name} (version {n})', { name: data.name, n })}
          viz={(data.viz as VizState | null) ?? undefined}
          caption={state.result ? caption : null}
          rowLimit={(data.spec as { limit?: number | null }).limit ?? null}
          empty={
            <Flex h="100%" align="center" justify="center" color="mutedText" fontSize="sm">
              {t('Loading…')}
            </Flex>
          }
        />
      </Box>
      {sql ? (
        <Box>
          <Text fontSize="sm" fontWeight={600} mb={1}>
            {t('SQL of this version')}
          </Text>
          <Code display="block" whiteSpace="pre-wrap" p={3} borderRadius="lg" fontSize="sm" data-testid="history-sql">
            {sql}
          </Code>
        </Box>
      ) : (
        caption && (
          <Box>
            <Text fontSize="sm" fontWeight={600} mb={1}>
              {t('What this version asks')}
            </Text>
            <Text fontSize="md">{caption}</Text>
          </Box>
        )
      )}
      {data.parameters.length > 0 && (
        <Text fontSize="sm" color="mutedText">
          {t('Parameters: {names}', { names: data.parameters.map((p) => p.label || p.name).join(', ') })}
        </Text>
      )}
    </>
  );
}

function DashboardVersion({ v }: { v: VersionDetail<DashboardVersionData> }) {
  const data = v.data;
  const tabs = data.tabs.length ? data.tabs : [{ id: '', name: '' }];
  return (
    <>
      <Box>
        <Text fontSize="xl" fontWeight={700}>
          {data.name}
        </Text>
        {data.description && (
          <Text fontSize="sm" color="mutedText" whiteSpace="pre-wrap">
            {data.description}
          </Text>
        )}
      </Box>
      <Box>
        <Text fontSize="sm" fontWeight={600} mb={1}>
          {t('Filters')}
        </Text>
        <Text fontSize="md" data-testid="history-filters">
          {data.filters.length ? data.filters.map((f) => f.label).join(', ') : t('No filters')}
        </Text>
      </Box>
      {tabs.map((tab) => (
        <LayoutPreview key={tab.id} data={data} tab={tab.id || null} name={tab.name} questions={v.questions ?? {}} />
      ))}
      <Box>
        <Text fontSize="sm" fontWeight={600} mb={1}>
          {tn(data.cards.length, '{n} card', '{n} cards')}
        </Text>
        <VStack as="ol" align="stretch" spacing={1} pl={5} fontSize="md" data-testid="history-cards">
          {data.cards.map((c) => (
            <Text as="li" key={c.key}>
              {cardLabel(c, v.questions ?? {})}
            </Text>
          ))}
        </VStack>
      </Box>
    </>
  );
}

const PREVIEW_ROW = 14; // px per grid row in the small picture

function LayoutPreview({ data, tab, name, questions }: { data: DashboardVersionData; tab: string | null; name: string; questions: NonNullable<VersionDetail<unknown>['questions']> }) {
  const { boxes, rows } = useMemo(() => previewBoxes(data, tab, questions), [data, tab, questions]);
  if (!boxes.length) return null;
  return (
    <Box>
      {name && (
        <Text fontSize="sm" fontWeight={600} mb={1}>
          {t('Tab “{name}”', { name })}
        </Text>
      )}
      <Box position="relative" h={`${Math.min(rows, 40) * PREVIEW_ROW}px`} overflow="hidden" bg="appBg" borderRadius="lg" border="1px solid" borderColor="lineColor" aria-hidden>
        {boxes.map((b) => (
          <Box
            key={b.key}
            position="absolute"
            left={`calc(${b.left}% + 2px)`}
            width={`calc(${b.width}% - 4px)`}
            top={`${b.top * PREVIEW_ROW + 2}px`}
            height={`${b.height * PREVIEW_ROW - 4}px`}
            bg={b.kind === 'question' ? 'panelBg' : 'transparent'}
            border="1px solid"
            borderColor={b.kind === 'question' ? 'brand.300' : 'lineColor'}
            borderRadius="md"
            px={1.5}
            py={0.5}
            overflow="hidden"
          >
            <Text fontSize="xs" fontWeight={b.kind === 'heading' ? 700 : 500} noOfLines={2}>
              {b.label}
            </Text>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

function RestoreButton({ kind, id, info, question, onDone }: { kind: HistoryKind; id: number; info: VersionInfo; question?: SavedQuestion | null; onDone: (item: unknown) => void }) {
  const toast = useToast();
  const [asking, setAsking] = useState(false);
  const detail = useQuery({
    queryKey: [...versionKeys.list(kind, id), info.version],
    queryFn: () => versions.get<QuestionVersionData | DashboardVersionData>(kind, id, info.version),
    staleTime: Infinity,
  });
  const notes = kind === 'question' && question && detail.data ? restoreNotes(question, detail.data.data as QuestionVersionData) : [];
  return (
    <>
      <Button size="md" variant="brand" onClick={() => setAsking(true)} data-testid="history-restore">
        {t('Restore this version')}
      </Button>
      <DialogShell
        isOpen={asking}
        onClose={() => setAsking(false)}
        title={t('Restore version {n}?', { n: info.version })}
        submitLabel={t('Restore')}
        onSubmit={async () => {
          const item = await versions.restore(kind, id, info.version);
          toast({ status: 'success', title: t('Version {n} restored', { n: info.version }), duration: 2500 });
          onDone(item);
        }}
      >
        <VStack align="stretch" spacing={2} fontSize="md">
          <Text>
            {kind === 'question'
              ? t('The question will look again as it was on {when}.', { when: localDateText(info.saved_at * 1000, true) })
              : t('The dashboard will look again as it was on {when}.', { when: localDateText(info.saved_at * 1000, true) })}
          </Text>
          <Text color="mutedText" fontSize="sm">
            {t('What you see now stays in the history, so you can go back to it the same way.')}
          </Text>
          {notes.map((note) => (
            <Text key={note} color="orange.400" fontSize="sm">
              {note}
            </Text>
          ))}
        </VStack>
      </DialogShell>
    </>
  );
}
