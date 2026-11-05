import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box, Button, Checkbox, Collapse, Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerOverlay, Flex, HStack, IconButton, Image, Input, Menu, MenuButton, MenuItem, MenuItemOption, MenuList, MenuOptionGroup, Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay, SimpleGrid, Skeleton, Spinner, Text, Textarea, useBreakpointValue, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, DownloadIcon, MoreIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon, XIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';
import { useWorkspace } from '../workspace/useWorkspace';
import {
  addCardLink, addChecklistItem, addComment, deleteAttachment, deleteCard, deleteChecklistItem, deleteComment, downloadAttachment, kanbanKeys, updateCard,
  removeCardLink, updateChecklistItem, updateComment, useCard, useFileUrl,
} from './api';
import type { CardInput } from './api';
import {
  ArrowDownIcon, ArrowUpIcon, BarChartIcon, CalendarIcon, CameraIcon, FileIcon, FlagIcon, HistoryIcon, ListChecksIcon, MessageIcon, PaperclipIcon, TagIcon,
  LinkIcon, PlayIcon, RepeatIcon, UserIcon,
} from './icons';
import {
  byPosition, colorHex, dateLabel, dueState, dueText, formatSize, fullTime, historySentence, isImage, personName, positionBetween, PRIORITY_COLOR,
  priorityLabel, progressOf, progressText, repeatLabel, timeAgo, todayIso, UPLOAD_ACCEPT, withAlpha,
} from './logic';
import { Choice } from './Choice';
import { DateField } from './DateField';
import { LinkPicker } from './LinkPicker';
import { LabelChip, PersonAvatar, PlainText, ProgressBar } from './parts';
import { attachOrQueue } from './upload';
import { isQueued, sendOrQueue } from './offline/queue';
import { useWaiting } from './offline/useWaiting';
import { WhoPicker } from './WhoPicker';
import type { Attachment, BoardDetail, Card, CardSummary, ChecklistItem, Column, Repeat } from './types';
import { PRIORITIES, REPEATS } from './types';
import { useNotify } from './useNotify';

type SaveState = 'idle' | 'saving' | 'saved' | 'queued' | 'error';

function Section({ icon, title, right, children, testId }: { icon: ReactNode; title: string; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Box as="section" data-testid={testId}>
      <Flex align="center" gap={2} mb={2.5} minH="32px">
        <Box color="brand.400">{icon}</Box>
        <Text as="h3" fontSize="md" fontWeight={700} flex={1}>
          {title}
        </Text>
        {right}
      </Flex>
      {children}
    </Box>
  );
}

/** One line of the facts card: an icon and a word on the left, the value (and its button) on the right. */
function FactRow({ icon, label, children, last = false }: { icon: ReactNode; label: string; children: ReactNode; last?: boolean }) {
  return (
    <Flex gap={3} py={2.5} align="flex-start" borderBottom={last ? undefined : '1px solid'} borderColor="lineColor" data-testid="fact-row">
      <HStack spacing={2} w={{ base: '96px', md: '120px' }} flexShrink={0} color="mutedText" pt="5px">
        {icon}
        <Text fontWeight={600} fontSize="sm">
          {label}
        </Text>
      </HStack>
      <Box flex={1} minW={0}>
        {children}
      </Box>
    </Flex>
  );
}

// ---------------------------------------------------------------- photos and files

function Thumb({ attachment, onOpen }: { attachment: Attachment; onOpen: () => void }) {
  const file = useFileUrl(attachment.thumb_url ?? attachment.url);
  return (
    <Tooltip label={t('Show {file}', { file: attachment.filename })} hasArrow>
      <Box as="button" type="button" onClick={onOpen} position="relative" borderRadius="lg" overflow="hidden" bg="chipBg" h="104px" w="100%" _hover={{ opacity: 0.9 }} data-testid="attachment-thumb">
        {file.data ? <Image src={file.data} alt={attachment.filename} w="100%" h="100%" objectFit="cover" /> : <Skeleton w="100%" h="100%" />}
      </Box>
    </Tooltip>
  );
}

function Preview({ images, index, setIndex, onClose, onDelete }: { images: Attachment[]; index: number; setIndex: (i: number) => void; onClose: () => void; onDelete?: (a: Attachment) => void }) {
  const current = images[index];
  const file = useFileUrl(current?.url);
  if (!current) return null;
  return (
    <Modal isOpen onClose={onClose} size="4xl" isCentered>
      <ModalOverlay bg="rgba(0,0,0,0.85)" />
      <ModalContent bg="transparent" border="none" boxShadow="none" mx={2}>
        <ModalCloseButton color="white" zIndex={2} size="lg" />
        <ModalBody p={0} display="flex" flexDirection="column" alignItems="center" gap={3}>
          <Flex align="center" justify="center" minH="50vh" w="100%">
            {file.data ? <Image src={file.data} alt={current.filename} maxH="76vh" maxW="100%" objectFit="contain" borderRadius="lg" data-testid="preview-image" /> : <Spinner color="white" />}
          </Flex>
          <HStack color="white" spacing={3} wrap="wrap" justify="center">
            <Button leftIcon={<ChevronRightIcon boxSize={4} transform="rotate(180deg)" />} isDisabled={index === 0} onClick={() => setIndex(index - 1)}>
              {t('Previous')}
            </Button>
            <Text noOfLines={1} maxW="50vw">
              {current.filename} · {index + 1}/{images.length}
            </Text>
            <Button rightIcon={<ChevronRightIcon boxSize={4} />} isDisabled={index === images.length - 1} onClick={() => setIndex(index + 1)}>
              {t('Next')}
            </Button>
            <Button leftIcon={<DownloadIcon boxSize={4} />} onClick={() => void downloadAttachment(current.url, current.filename).catch(() => undefined)}>
              {t('Download')}
            </Button>
            {onDelete && (
              <Button leftIcon={<TrashIcon boxSize={4} />} colorScheme="red" variant="solid" onClick={() => onDelete(current)} data-testid="preview-delete">
                {t('Delete')}
              </Button>
            )}
          </HStack>
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------- steps

function StepRow({ item, index, count, canEdit, onToggle, onText, onMove, onDelete }: {
  item: ChecklistItem; index: number; count: number; canEdit: boolean;
  onToggle: (done: boolean) => void; onText: (text: string) => void; onMove: (by: -1 | 1) => void; onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(item.text);
  const save = () => {
    setEditing(false);
    if (text.trim() && text.trim() !== item.text) onText(text.trim());
    else setText(item.text);
  };
  return (
    <Flex align="center" gap={3} py={1.5} px={2} minH="48px" borderRadius="lg" role="group" _hover={{ bg: 'panelHover' }} data-testid="checklist-item">
      <Checkbox size="lg" isChecked={item.done} isDisabled={!canEdit} onChange={(e) => onToggle(e.target.checked)} colorScheme="green" aria-label={item.done ? t('Untick “{text}”', { text: item.text }) : t('Tick “{text}” as done', { text: item.text })} />
      {editing ? (
        <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={save} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') { setText(item.text); setEditing(false); } }} maxLength={500} aria-label={t('Step')} />
      ) : (
        <Box flex={1} minW={0}>
          <Text fontSize="md" textDecoration={item.done ? 'line-through' : undefined} color={item.done ? 'mutedText' : 'bodyText'} sx={{ overflowWrap: 'anywhere' }}>
            {item.text}
          </Text>
          {item.done && item.done_by && (
            <Text fontSize="sm" color="mutedText">
              {t('Done by {user}, {when}', { user: personName(item.done_by), when: item.done_at ? timeAgo(item.done_at) : '' })}
            </Text>
          )}
        </Box>
      )}
      {canEdit && !editing && (
        <Menu isLazy placement="bottom-end">
          <MenuButton as={IconButton} aria-label={t('More for the step “{text}”', { text: item.text })} size="sm" variant="ghost" icon={<MoreIcon boxSize={4} />} color="mutedText" data-testid="step-menu" />
          <MenuList zIndex={1700} fontSize="md">
            <MenuItem icon={<PencilIcon boxSize={4} />} onClick={() => setEditing(true)}>
              {t('Change the text')}
            </MenuItem>
            <MenuItem icon={<ArrowUpIcon boxSize={4} />} isDisabled={index === 0} onClick={() => onMove(-1)}>
              {t('Move the step up')}
            </MenuItem>
            <MenuItem icon={<ArrowDownIcon boxSize={4} />} isDisabled={index === count - 1} onClick={() => onMove(1)}>
              {t('Move the step down')}
            </MenuItem>
            <MenuItem icon={<TrashIcon boxSize={4} />} color="red.500" onClick={onDelete} data-testid="step-remove">
              {t('Remove the step')}
            </MenuItem>
          </MenuList>
        </Menu>
      )}
    </Flex>
  );
}

// ---------------------------------------------------------------- the drawer

interface CardDrawerProps {
  cardId: number;
  detail: BoardDetail;
  columns: Column[];
  canEdit: boolean;
  canManage: boolean;
  onClose: () => void;
  onChanged: () => void;
  onMove: (card: CardSummary, columnId: number) => void;
}

export function CardDrawer({ cardId, detail, columns, canEdit, canManage, onClose, onChanged, onMove }: CardDrawerProps) {
  const size = useBreakpointValue({ base: 'full', md: 'lg' }) ?? 'lg';
  const cardQuery = useCard(cardId);
  const card = cardQuery.data;
  return (
    <Drawer isOpen placement="right" onClose={onClose} size={size}>
      <DrawerOverlay bg="rgba(8,12,24,0.45)" />
      <DrawerContent data-testid="card-drawer" borderLeftRadius={{ base: 0, md: '2xl' }} overflow="hidden" fontSize="md">
        {cardQuery.isPending && cardQuery.fetchStatus === 'paused' ? (
          <Box p={6} data-testid="card-offline">
            <Flex justify="flex-end">
              <Button leftIcon={<XIcon boxSize={4} />} variant="subtle" onClick={onClose}>
                {t('Close')}
              </Button>
            </Flex>
            <Text mt={6} fontWeight={600} fontSize="lg">
              {t('No connection')}
            </Text>
            <Text color="mutedText">{t('This task was not opened on this device before, so it is not kept here. It opens once the connection is back.')}</Text>
          </Box>
        ) : cardQuery.isPending ? (
          <Box p={6}>
            <Skeleton h="32px" w="70%" mb={6} borderRadius="md" />
            <Skeleton h="90px" mb={4} borderRadius="lg" />
            <Skeleton h="180px" borderRadius="lg" />
          </Box>
        ) : !card ? (
          <Box p={6}>
            <Flex justify="flex-end">
              <Button leftIcon={<XIcon boxSize={4} />} variant="subtle" onClick={onClose}>
                {t('Close')}
              </Button>
            </Flex>
            <Text mt={6} fontWeight={600} fontSize="lg">
              {t('Could not open the task')}
            </Text>
            <Text color="mutedText">{apiErrorMessage(cardQuery.error, '')}</Text>
          </Box>
        ) : (
          <CardBody card={card} detail={detail} columns={columns} canEdit={canEdit && !card.archived} canManage={canManage} canRestore={canEdit} onClose={onClose} onChanged={onChanged} onMove={onMove} />
        )}
      </DrawerContent>
    </Drawer>
  );
}

function CardBody({ card, detail, columns, canEdit, canManage, canRestore, onClose, onChanged, onMove }: {
  card: Card; detail: BoardDetail; columns: Column[]; canEdit: boolean; canManage: boolean; canRestore: boolean;
  onClose: () => void; onChanged: () => void; onMove: (card: CardSummary, columnId: number) => void;
}) {
  const notify = useNotify();
  const ws = useWorkspace();
  const queryClient = useQueryClient();
  const today = todayIso();
  const column = columns.find((c) => c.id === card.column_id);
  const done = Boolean(column?.is_done || card.completed_at);
  const [title, setTitle] = useState(card.title);
  // a task just made from a photo (K2): its name is ready to be typed over
  const nameIt = new URLSearchParams(window.location.search).get('name') === '1' && canEdit;
  const [description, setDescription] = useState(card.description ?? '');
  const [newItem, setNewItem] = useState('');
  const [comment, setComment] = useState('');
  const [editingComment, setEditingComment] = useState<{ id: number; body: string } | null>(null);
  const [uploading, setUploading] = useState(0);
  const [preview, setPreview] = useState<number | null>(null);
  const [showMore, setShowMore] = useState(false); // history, links, removing: out of the way
  const [editing, setEditing] = useState<'title' | 'description' | null>(null); // which text is being typed
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const descriptionRef = useRef<HTMLTextAreaElement>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const key = kanbanKeys.card(card.id);
  const accent = colorHex(column?.color ?? detail.board.color);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: key });
    onChanged();
  };
  /** Every change saves at once; the header says "Saving…" / "Saved". */
  const run = async (what: () => Promise<unknown>, fallback = t('Could not save the change')): Promise<boolean> => {
    setSaveState('saving');
    try {
      const answer = await what();
      if (isQueued(answer)) {
        setSaveState('queued'); // K4: kept on the phone, sent when the connection is back
        return true;
      }
      // task changes answer with the whole task: show it at once
      if (answer && typeof answer === 'object' && (answer as Card).id === card.id && 'checklist_items' in answer) queryClient.setQueryData(key, answer);
      setSaveState('saved');
      refresh();
      return true;
    } catch (err) {
      setSaveState('error');
      notify(apiErrorMessage(err, fallback), { error: true });
      refresh();
      return false;
    }
  };
  const [picking, setPicking] = useState(false); // K3: choosing a Search & BI link
  // K4: comments and files made without a connection, until they are sent
  const waiting = useWaiting(card.id);
  const waitingComments = waiting.filter((op) => op.kind === 'comment');
  const waitingFiles = waiting.filter((op) => op.kind === 'attach');
  const firstOpen = columns.find((c) => !c.is_done);
  const patch = (body: CardInput) => {
    queryClient.setQueryData<Card>(key, (old) => (old ? ({ ...old, ...body } as Card) : old));
    return run(() => updateCard(card.id, body));
  };

  // the title and the description save by themselves a moment after typing stops
  const saveTitle = () => {
    const v = title.trim();
    if (v && v !== card.title) void patch({ title: v });
  };
  const saveDescription = () => {
    if ((description.trim() || null) !== (card.description || null)) void patch({ description: description.trim() || null });
  };
  const latest = useRef({ saveTitle, saveDescription });
  useEffect(() => {
    latest.current = { saveTitle, saveDescription };
  });
  useEffect(() => {
    if (title === card.title) return;
    const timer = setTimeout(() => latest.current.saveTitle(), 900);
    return () => clearTimeout(timer);
  }, [title, card.title]);
  useEffect(() => {
    if (description === (card.description ?? '')) return;
    const timer = setTimeout(() => latest.current.saveDescription(), 1200);
    return () => clearTimeout(timer);
  }, [description, card.description]);

  const items = [...card.checklist_items].sort(byPosition);
  const progress = progressOf({ done: items.filter((i) => i.done).length, total: items.length });
  const images = card.attachments_list.filter((a) => isImage(a.content_type));
  const files = card.attachments_list.filter((a) => !isImage(a.content_type));
  const cardLabels = detail.labels.filter((l) => card.labels.includes(l.id));
  const due = dueState(card.due_date, today, done);
  const history = [...card.history].sort((a, b) => b.created_at - a.created_at);
  const comments = [...card.comments_list].sort((a, b) => a.created_at - b.created_at);
  const people = detail.people.filter((p) => p.active !== false || card.assignees.includes(p.id));

  const toggleItem = (item: ChecklistItem, value: boolean) => {
    queryClient.setQueryData<Card>(key, (old) => (old ? { ...old, checklist_items: old.checklist_items.map((i) => (i.id === item.id ? { ...i, done: value, done_by: value ? ws.user.username : null, done_at: value ? Date.now() / 1000 : null } : i)) } : old));
    // the board's "2 of 3 steps" at once too (also without a connection)
    queryClient.setQueryData<BoardDetail>(kanbanKeys.board(detail.board.id), (old) => (old ? { ...old, cards: old.cards.map((c) => (c.id === card.id ? { ...c, checklist: { ...c.checklist, done: Math.max(0, c.checklist.done + (value ? 1 : -1)) } } : c)) } : old));
    void run(() => sendOrQueue({ kind: 'tick', cardId: card.id, itemId: item.id, done: value, label: value ? t('tick “{text}”', { text: item.text }) : t('untick “{text}”', { text: item.text }) }, () => updateChecklistItem(item.id, { done: value })));
  };
  const moveItem = (index: number, by: -1 | 1) => {
    const item = items[index];
    const others = items.filter((i) => i.id !== item.id);
    const at = index + by;
    const position = positionBetween(others[at - 1]?.position, others[at]?.position);
    queryClient.setQueryData<Card>(key, (old) => (old ? { ...old, checklist_items: old.checklist_items.map((i) => (i.id === item.id ? { ...i, position } : i)) } : old));
    void run(() => updateChecklistItem(item.id, { position }));
  };
  const removeItem = async (item: ChecklistItem) => {
    if (!(await run(() => deleteChecklistItem(item.id)))) return;
    notify(t('Removed the step “{text}”', { text: item.text }), {
      undo: () => void run(async () => {
        const answer = (await addChecklistItem(card.id, item.text)) as Card;
        const back = answer.checklist_items?.find((i) => i.text === item.text && !items.some((x) => x.id === i.id));
        if (back && (item.done || back.position !== item.position)) return updateChecklistItem(back.id, { done: item.done, position: item.position });
        return answer;
      }),
    });
  };
  const addItem = async () => {
    const text = newItem.trim();
    if (!text) return;
    setNewItem('');
    await run(() => addChecklistItem(card.id, text));
  };

  const upload = async (list: FileList | null) => {
    if (!list?.length) return;
    const chosen = [...list];
    setUploading((n) => n + chosen.length);
    setSaveState('saving');
    let ok = 0;
    let kept = 0;
    for (const file of chosen) {
      try {
        if (isQueued(await attachOrQueue(card.id, file))) kept += 1;
        else ok += 1;
      } catch (err) {
        notify(apiErrorMessage(err, t('Could not add {file}', { file: file.name })), { error: true });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    setSaveState(kept ? 'queued' : ok ? 'saved' : 'error');
    if (ok) notify(ok === 1 ? t('Added {file}', { file: chosen[0].name }) : t('Added {n} files', { n: ok }));
    if (kept) notify(tn(kept, '{n} file is kept on this device and sent when the connection is back', '{n} files are kept on this device and sent when the connection is back'));
    if (ok) refresh();
  };

  const sendComment = async () => {
    const body = comment.trim();
    if (!body) return;
    if (await run(() => sendOrQueue({ kind: 'comment', cardId: card.id, body, label: t('comment on “{title}”', { title: card.title }) }, () => addComment(card.id, body)), t('Could not save the comment'))) setComment('');
  };

  const removeFile = (a: Attachment) => {
    if (window.confirm(t('Delete the file “{file}” from this task? This cannot be undone.', { file: a.filename }))) void run(() => deleteAttachment(a.id));
  };

  const hide = async () => {
    if (!(await run(() => updateCard(card.id, { archived: true })))) return;
    onClose();
    notify(t('Hid the task “{title}”', { title: card.title }), { undo: () => void updateCard(card.id, { archived: false }).then(refresh) });
  };

  const doneColumn = columns.find((c) => c.is_done);
  const stageColor = colorHex(column?.color, column?.is_done ? '#22c55e' : '#94a3b8');
  const hasLinks = (card.links?.length ?? 0) > 0;
  const docs = files; // documents get a row; pictures show once, as pictures
  const linkPicker = picking && (
    <LinkPicker
      onClose={() => setPicking(false)}
      onPick={(kind, id) => {
        setPicking(false);
        void run(() => addCardLink(card.id, kind, id));
      }}
    />
  );
  const linksList = (
    <VStack align="stretch" spacing={2}>
      {(card.links ?? []).map((link) => (
        <Flex key={link.id} align="center" gap={2} p={2.5} borderRadius="lg" bg="chipBg" data-testid="card-link">
          <LinkIcon boxSize={4} color="mutedText" flexShrink={0} />
          <Box flex={1} minW={0}>
            <Text fontSize="sm" color="mutedText">
              {link.kind === 'dashboard' ? t('Dashboard') : t('Question')}
            </Text>
            {link.name ? (
              <Text as={RouterLink} to={link.url} fontWeight={600} color="brand.600" _dark={{ color: 'brand.200' }} textDecoration="underline" noOfLines={2} data-testid="card-link-open">
                {link.name}
              </Text>
            ) : (
              <Text color="mutedText">{link.kind === 'dashboard' ? t('A dashboard you cannot open') : t('A question you cannot open')}</Text>
            )}
          </Box>
          {canEdit && (
            <IconButton aria-label={t('Remove the link')} size="sm" variant="ghost" icon={<XIcon boxSize={4} />} onClick={() => void run(() => removeCardLink(link.id))} data-testid="card-link-remove" />
          )}
        </Flex>
      ))}
      {canEdit && (
        <Button variant="subtle" leftIcon={<PlusIcon boxSize={4} />} alignSelf="flex-start" maxW="100%" whiteSpace="normal" h="auto" minH="40px" py={2} textAlign="left" onClick={() => setPicking(true)} data-testid="add-link">
          {t('Link a dashboard or question')}
        </Button>
      )}
    </VStack>
  );

  return (
    <>
      <DrawerHeader borderBottom="1px solid" borderColor="lineColor" px={{ base: 4, md: 6 }} py={3} borderTop="5px solid" borderTopColor={done ? '#22c55e' : accent}>
        <Flex align="center" gap={2} wrap="wrap">
          {canEdit ? (
            <Menu isLazy placement="bottom-start">
              <MenuButton
                as={Button}
                variant="outline"
                borderRadius="full"
                borderColor={withAlpha(stageColor, 0.7)}
                bg={withAlpha(stageColor, 0.14)}
                rightIcon={<ChevronDownIcon boxSize={4} />}
                leftIcon={done ? <CheckIcon boxSize={4} color="#16a34a" /> : <Box w="10px" h="10px" borderRadius="full" bg={stageColor} />}
                minW={0}
                aria-label={t('Stage: {name}', { name: column?.name ?? '' })}
                data-testid="card-column"
              >
                <Text as="span" noOfLines={1}>
                  {column?.name}
                </Text>
              </MenuButton>
              <MenuList zIndex={1700} fontSize="md">
                <Text px={3} py={1} fontSize="sm" color="mutedText">
                  {t('Move to…')}
                </Text>
                {columns.map((c) => (
                  <MenuItem key={c.id} isDisabled={c.id === card.column_id} onClick={() => onMove(card, c.id)} data-testid="move-to-stage">
                    <HStack spacing={2.5}>
                      <Box w="10px" h="10px" borderRadius="full" bg={colorHex(c.color, c.is_done ? '#22c55e' : '#94a3b8')} />
                      <Text as="span">{c.name}</Text>
                      {c.id === card.column_id && <CheckIcon boxSize={4} />}
                    </HStack>
                  </MenuItem>
                ))}
              </MenuList>
            </Menu>
          ) : (
            <HStack spacing={2} px={3} py={1.5} borderRadius="full" bg={withAlpha(stageColor, 0.14)} fontWeight={600} data-testid="card-column">
              <Box w="10px" h="10px" borderRadius="full" bg={stageColor} />
              <Text as="span">{column?.name}</Text>
            </HStack>
          )}
          <Text fontSize="sm" color={saveState === 'error' ? 'red.500' : saveState === 'queued' ? 'orange.500' : 'mutedText'} data-testid="save-state" aria-live="polite" display={saveState === 'idle' ? 'none' : 'block'} order={{ base: 10, md: 0 }} w={{ base: '100%', md: 'auto' }}>
            {saveState === 'saving' ? t('Saving…') : saveState === 'saved' ? t('Saved') : saveState === 'queued' ? t('Kept, sent later') : saveState === 'error' ? t('Not saved') : ''}
          </Text>
          <Box flex={1} />
          {canEdit && !done && doneColumn && (
            <Button bg="#16a34a" color="white" _hover={{ bg: '#15803d' }} _active={{ bg: '#166534' }} leftIcon={<CheckIcon boxSize={4} />} onClick={() => onMove(card, doneColumn.id)} data-testid="mark-done">
              {t('Done')}
            </Button>
          )}
          <Tooltip label={t('Close')} hasArrow>
            <IconButton aria-label={t('Close')} variant="subtle" icon={<XIcon boxSize={5} />} onClick={onClose} data-testid="card-close" />
          </Tooltip>
        </Flex>
      </DrawerHeader>

      <DrawerBody px={{ base: 4, md: 6 }} py={5}>
        <VStack align="stretch" spacing={5}>
          {card.archived && (
            <Flex align="center" gap={3} p={3} borderRadius="xl" bg="rgba(249,115,22,0.12)" border="1px solid" borderColor="rgba(249,115,22,0.4)" wrap="wrap" data-testid="hidden-banner">
              <Text fontWeight={700} flex={1} minW="180px">
                {t('This task is not on the board.')}
              </Text>
              {canRestore && (
                <HStack>
                  <Button leftIcon={<RefreshIcon boxSize={4} />} onClick={() => void run(() => updateCard(card.id, { archived: false })).then((ok) => ok && notify(t('The task is back on the board')))} data-testid="restore-card">
                    {t('Bring back')}
                  </Button>
                  <Button
                    colorScheme="red"
                    variant="ghost"
                    leftIcon={<TrashIcon boxSize={4} />}
                    onClick={() => {
                      if (window.confirm(t('Delete the task “{title}” for good? Its steps, comments, photos and files are deleted too. This cannot be undone.', { title: card.title }))) {
                        void run(() => deleteCard(card.id)).then((ok) => {
                          if (!ok) return;
                          onClose();
                          notify(t('Deleted the task “{title}”', { title: card.title }));
                        });
                      }
                    }}
                    data-testid="delete-card"
                  >
                    {t('Delete for good')}
                  </Button>
                </HStack>
              )}
            </Flex>
          )}

          {/* what: the name and the details, as text you click to change */}
          <Box>
            {nameIt && (
              <HStack spacing={3} align="center" mb={2}>
                {images[0] && (
                  <Box w="72px" flexShrink={0}>
                    <Thumb attachment={images[0]} onOpen={() => setPreview(0)} />
                  </Box>
                )}
                <Text fontWeight={600} color="brand.600" _dark={{ color: 'brand.200' }} data-testid="name-it-hint">
                  {t('The photo is added. Give the task a short name:')}
                </Text>
              </HStack>
            )}
            {canEdit ? (
              <>
                <Flex align="center" gap={2} mb={1.5}>
                  <Text as="label" htmlFor="card-title" fontSize="sm" fontWeight={700} color="mutedText">
                    {t('Name')}
                  </Text>
                  {editing !== 'title' && (
                    <Button size="xs" variant="ghost" color="brand.500" _dark={{ color: 'brand.200' }} leftIcon={<PencilIcon boxSize={3} />} onClick={() => titleRef.current?.focus()} data-testid="edit-title">
                      {t('Change')}
                    </Button>
                  )}
                </Flex>
                <Textarea
                  id="card-title"
                  ref={titleRef}
                  autoFocus={nameIt}
                  onFocus={(e) => {
                    setEditing('title');
                    if (nameIt) e.currentTarget.select();
                  }}
                  value={title}
                  onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
                  onBlur={() => {
                    setEditing(null);
                    saveTitle();
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
                  px={3}
                  py={1.5}
                  borderRadius="lg"
                  cursor="text"
                  fontSize="22px"
                  fontWeight={750}
                  lineHeight="1.3"
                  rows={1}
                  resize="none"
                  sx={{ fieldSizing: 'content' }}
                  maxLength={300}
                  aria-label={t('Task')}
                  data-testid="card-title"
                />
                {editing === 'title' && (
                  <Text fontSize="sm" color="mutedText" mt={1} data-testid="title-hint">
                    {t('Press Enter or click outside to save.')}
                  </Text>
                )}
                <Flex align="center" gap={2} mt={4} mb={1.5}>
                  <Text as="label" htmlFor="card-description" fontSize="sm" fontWeight={700} color="mutedText">
                    {t('Description')}
                  </Text>
                  {editing !== 'description' && (
                    <Button size="xs" variant="ghost" color="brand.500" _dark={{ color: 'brand.200' }} leftIcon={<PencilIcon boxSize={3} />} onClick={() => descriptionRef.current?.focus()} data-testid="edit-description">
                      {description ? t('Change') : t('Add')}
                    </Button>
                  )}
                </Flex>
                <Textarea
                  ref={descriptionRef}
                  id="card-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onFocus={() => setEditing('description')}
                  onBlur={() => {
                    setEditing(null);
                    saveDescription();
                  }}
                  px={3}
                  py={2}
                  borderRadius="lg"
                  borderStyle={description || editing === 'description' ? 'solid' : 'dashed'}
                  cursor="text"
                  color={description ? 'bodyText' : 'mutedText'}
                  minH="48px"
                  rows={2}
                  resize="none"
                  sx={{ fieldSizing: 'content' }}
                  placeholder={t('What needs doing, where, how (not required). Click here to write.')}
                  aria-label={t('Description')}
                  data-testid="description-input"
                />
              </>
            ) : (
              <>
                <Text fontSize="22px" fontWeight={750} lineHeight="1.3" data-testid="card-title">
                  {card.title}
                </Text>
                {card.description ? (
                  <Box mt={2} fontSize="md" data-testid="card-description">
                    <PlainText text={card.description} />
                  </Box>
                ) : null}
              </>
            )}
          </Box>

          {/* who, when, how important, labels: one card of facts */}
          <Box border="1px solid" borderColor="lineColor" borderRadius="xl" px={{ base: 3, md: 4 }} py={1} data-testid="card-facts">
            <FactRow icon={<UserIcon boxSize={4} />} label={t('Who')}>
              <WhoPicker
                assignees={card.assignees}
                names={card.assignee_names ?? []}
                people={people}
                allPeople={detail.people}
                canEdit={canEdit}
                onChange={(change) => void patch(change)}
              />
            </FactRow>

            <FactRow icon={<CalendarIcon boxSize={4} />} label={t('Due')}>
              <Flex gap={2} align="center" wrap="wrap">
                <DateField
                  value={card.due_date}
                  onChange={(v) => void patch({ due_date: v })}
                  label={t('Due')}
                  placeholder={canEdit ? t('Choose a date') : t('No date')}
                  isDisabled={!canEdit}
                  tone={due === 'overdue' ? 'red.500' : undefined}
                  min={card.start_date}
                  limitNote={card.start_date ? t('The due date cannot be before the start ({date}).', { date: dateLabel(card.start_date) }) : undefined}
                  testId="card-due"
                />
                {card.due_date && (
                  <Text fontWeight={700} fontSize="sm" color={due === 'overdue' ? 'red.500' : due === 'today' || due === 'soon' ? 'orange.500' : due === 'done' ? 'green.500' : 'mutedText'} data-testid="due-text">
                    {dueText(card.due_date, today, done)}
                  </Text>
                )}
              </Flex>
            </FactRow>

            <FactRow icon={<PlayIcon boxSize={4} />} label={t('Starts')}>
              <DateField
                value={card.start_date}
                onChange={(v) => void patch({ start_date: v })}
                label={t('Starts')}
                placeholder={canEdit ? t('Not required') : t('No date')}
                isDisabled={!canEdit}
                max={card.due_date}
                limitNote={card.due_date ? t('The start cannot be after the due date ({date}).', { date: dateLabel(card.due_date) }) : undefined}
                testId="card-start"
              />
            </FactRow>

            <FactRow icon={<RepeatIcon boxSize={4} />} label={t('Repeats')}>
              <Choice
                value={card.repeat ?? ''}
                options={[{ value: '', label: t('Does not repeat') }, ...REPEATS.map((r) => ({ value: r, label: repeatLabel(r) }))]}
                onChange={(v) => void patch({ repeat: (v || null) as Repeat | null })}
                label={t('Repeats')}
                isDisabled={!canEdit}
                testId="card-repeat"
              />
              {card.repeat && firstOpen && (
                <Text fontSize="sm" color="mutedText" mt={1.5} data-testid="repeat-hint">
                  {t('When it is done, the next one appears in “{stage}” with its new date, the same people and steps.', { stage: firstOpen.name })}
                </Text>
              )}
            </FactRow>

            <FactRow icon={<FlagIcon boxSize={4} />} label={t('Importance')}>
              <Menu isLazy>
                <MenuButton
                  as={Button}
                  size="sm"
                  variant="outline"
                  isDisabled={!canEdit}
                  borderColor={withAlpha(PRIORITY_COLOR[card.priority], 0.6)}
                  bg={withAlpha(PRIORITY_COLOR[card.priority], 0.12)}
                  leftIcon={<Box w="9px" h="9px" borderRadius="full" bg={PRIORITY_COLOR[card.priority]} />}
                  rightIcon={canEdit ? <ChevronDownIcon boxSize={4} /> : undefined}
                  _disabled={{ opacity: 1, cursor: 'default' }}
                  data-testid="card-priority"
                >
                  {priorityLabel(card.priority)}
                </MenuButton>
                <MenuList zIndex={1700} fontSize="md">
                  <MenuOptionGroup type="radio" value={card.priority} onChange={(v) => v !== card.priority && void patch({ priority: v as (typeof PRIORITIES)[number] })}>
                    {PRIORITIES.map((p) => (
                      <MenuItemOption key={p} value={p} data-testid={`priority-${p}`}>
                        <HStack spacing={2}>
                          <Box w="10px" h="10px" borderRadius="full" bg={PRIORITY_COLOR[p]} />
                          <Text as="span">{priorityLabel(p)}</Text>
                        </HStack>
                      </MenuItemOption>
                    ))}
                  </MenuOptionGroup>
                </MenuList>
              </Menu>
            </FactRow>

            <FactRow icon={<TagIcon boxSize={4} />} label={t('Labels')} last>
              <Flex gap={1.5} wrap="wrap" align="center">
                {cardLabels.map((l) => (
                  <LabelChip key={l.id} label={l} />
                ))}
                {canEdit && (
                  <Menu closeOnSelect={false} isLazy>
                    <MenuButton as={Button} size="sm" variant="ghost" leftIcon={<PlusIcon boxSize={3.5} />} color="brand.500" _dark={{ color: 'brand.200' }} data-testid="labels-pick">
                      {cardLabels.length ? t('Change') : t('Add a label')}
                    </MenuButton>
                    <MenuList zIndex={1700}>
                      {detail.labels.length ? (
                        <MenuOptionGroup type="checkbox" value={card.labels.map(String)} onChange={(v) => void patch({ labels: (Array.isArray(v) ? v : [v]).map(Number) })}>
                          {detail.labels.map((l) => (
                            <MenuItemOption key={l.id} value={String(l.id)}>
                              <LabelChip label={l} />
                            </MenuItemOption>
                          ))}
                        </MenuOptionGroup>
                      ) : (
                        <Text px={3} py={2} color="mutedText" maxW="280px">
                          {t('The board has no labels yet: add them with More → Labels at the top of the board.')}
                        </Text>
                      )}
                    </MenuList>
                  </Menu>
                )}
                {!canEdit && !cardLabels.length && <Text color="mutedText">{t('None')}</Text>}
              </Flex>
            </FactRow>
          </Box>

          {/* steps: the action plan */}
          <Section
            icon={<ListChecksIcon boxSize={5} />}
            title={t('Steps')}
            right={progress.total ? <Text fontWeight={700} color={progress.percent === 100 ? 'green.500' : 'mutedText'} data-testid="plan-progress">{progressText(progress)}</Text> : undefined}
            testId="action-plan"
          >
            {progress.total > 0 && (
              <Box mb={2}>
                <ProgressBar value={progress.percent} color={accent} h="8px" />
              </Box>
            )}
            <VStack align="stretch" spacing={0}>
              {items.map((item, i) => (
                <StepRow
                  key={item.id}
                  item={item}
                  index={i}
                  count={items.length}
                  canEdit={canEdit}
                  onToggle={(v) => toggleItem(item, v)}
                  onText={(text) => void run(() => updateChecklistItem(item.id, { text }))}
                  onMove={(by) => moveItem(i, by)}
                  onDelete={() => void removeItem(item)}
                />
              ))}
            </VStack>
            {canEdit && (
              <Flex mt={2} gap={2}>
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addItem()} placeholder={items.length ? t('Another step…') : t('A step, e.g. “Order the parts”')} maxLength={500} aria-label={t('New step')} data-testid="new-step" />
                <Button onClick={() => void addItem()} isDisabled={!newItem.trim()} leftIcon={<PlusIcon boxSize={4} />} flexShrink={0} data-testid="add-step">
                  {t('Add')}
                </Button>
              </Flex>
            )}
            {!canEdit && !items.length && <Text color="mutedText">{t('No steps yet.')}</Text>}
          </Section>

          {/* photos and files: pictures once, documents as rows */}
          <Section
            icon={<PaperclipIcon boxSize={5} />}
            title={t('Photos and files')}
            testId="attachments"
            right={
              canEdit ? (
                <HStack spacing={2}>
                  <Button size="sm" variant="subtle" leftIcon={<CameraIcon boxSize={4} />} onClick={() => cameraInput.current?.click()} display={{ base: 'inline-flex', md: 'none' }} data-testid="take-photo">
                    {t('Photo')}
                  </Button>
                  <Button size="sm" variant="subtle" leftIcon={uploading ? <Spinner size="xs" /> : <PlusIcon boxSize={4} />} onClick={() => fileInput.current?.click()} data-testid="add-file">
                    {uploading ? t('Adding…') : t('Add')}
                  </Button>
                </HStack>
              ) : undefined
            }
          >
            <input ref={fileInput} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} data-testid="file-input" />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} data-testid="camera-input" />
            {images.length > 0 && (
              <SimpleGrid columns={{ base: 3, md: 4 }} spacing={2} mb={docs.length ? 3 : 0}>
                {images.map((a, i) => (
                  <Thumb key={a.id} attachment={a} onOpen={() => setPreview(i)} />
                ))}
              </SimpleGrid>
            )}
            <VStack align="stretch" spacing={1}>
              {docs.map((a) => (
                <Flex key={a.id} align="center" gap={3} px={2} py={2} borderRadius="lg" _hover={{ bg: 'panelHover' }} data-testid="attachment-row">
                  <Box color="mutedText">
                    <FileIcon boxSize={5} />
                  </Box>
                  <Box flex={1} minW={0}>
                    <Text fontWeight={600} noOfLines={1}>
                      {a.filename}
                    </Text>
                    <Text fontSize="sm" color="mutedText">
                      {formatSize(a.size)} · {personName(a.uploaded_by, detail.people)} · {timeAgo(a.created_at)}
                    </Text>
                  </Box>
                  <Tooltip label={t('Download {file}', { file: a.filename })} hasArrow>
                    <IconButton aria-label={t('Download {file}', { file: a.filename })} variant="ghost" icon={<DownloadIcon boxSize={4} />} onClick={() => void downloadAttachment(a.url, a.filename).catch((err: unknown) => notify(apiErrorMessage(err, t('Could not download the file')), { error: true }))} />
                  </Tooltip>
                  {canEdit && (
                    <Tooltip label={t('Delete {file}', { file: a.filename })} hasArrow>
                      <IconButton aria-label={t('Delete {file}', { file: a.filename })} variant="ghost" icon={<TrashIcon boxSize={4} />} onClick={() => removeFile(a)} />
                    </Tooltip>
                  )}
                </Flex>
              ))}
            </VStack>
            {waitingFiles.map((op) => (
              <Flex key={op.id} align="center" gap={3} px={2} py={2} borderRadius="lg" border="1px dashed" borderColor="orange.400" mt={1} data-testid="waiting-file">
                <Box color="orange.400">
                  <CameraIcon boxSize={5} />
                </Box>
                <Box flex={1} minW={0}>
                  <Text fontWeight={600} noOfLines={1}>
                    {op.kind === 'attach' ? op.name : ''}
                  </Text>
                  <Text fontSize="sm" color="orange.500">
                    {t('Waiting to be sent')}
                  </Text>
                </Box>
              </Flex>
            ))}
            {!card.attachments_list.length && !waitingFiles.length && <Text color="mutedText">{canEdit ? t('None yet.') : t('No photos or files.')}</Text>}
          </Section>

          {/* links to Search & BI: in the main part when there are some */}
          {hasLinks && (
            <Section icon={<BarChartIcon boxSize={5} />} title={t('Search & BI')} testId="links">
              {linksList}
            </Section>
          )}

          {/* comments */}
          <Section icon={<MessageIcon boxSize={5} />} title={t('Comments')} testId="comments">
            <VStack align="stretch" spacing={4}>
              {comments.map((c) => {
                const author = personName(c.user, detail.people);
                const mine = author === ws.user.username;
                return (
                  <Flex key={c.id} gap={3} data-testid="comment">
                    <PersonAvatar name={author} size="sm" />
                    <Box flex={1} minW={0}>
                      <HStack spacing={2} fontSize="sm">
                        <Text fontWeight={700}>{author}</Text>
                        <Tooltip label={fullTime(c.created_at)} hasArrow>
                          <Text color="mutedText">{timeAgo(c.created_at)}</Text>
                        </Tooltip>
                        {c.edited_at && <Text color="mutedText">{t('(edited)')}</Text>}
                      </HStack>
                      {editingComment?.id === c.id ? (
                        <Box mt={1}>
                          <Textarea value={editingComment.body} onChange={(e) => setEditingComment({ id: c.id, body: e.target.value })} rows={3} />
                          <HStack mt={2}>
                            <Button size="sm" onClick={() => { const body = editingComment.body.trim(); setEditingComment(null); if (body) void run(() => updateComment(c.id, body)); }}>
                              {t('Save')}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditingComment(null)}>
                              {t('Cancel')}
                            </Button>
                          </HStack>
                        </Box>
                      ) : (
                        <Box mt={1} px={3} py={2} borderRadius="lg" bg="chipBg" fontSize="md">
                          <PlainText text={c.body} />
                        </Box>
                      )}
                      {(mine || canManage) && editingComment?.id !== c.id && (
                        <HStack spacing={3} mt={1}>
                          {mine && (
                            <Button size="sm" variant="link" fontWeight={500} color="mutedText" onClick={() => setEditingComment({ id: c.id, body: c.body })}>
                              {t('Edit')}
                            </Button>
                          )}
                          <Button size="sm" variant="link" fontWeight={500} color="mutedText" onClick={() => window.confirm(t('Delete this comment? This cannot be undone.')) && void run(() => deleteComment(c.id))}>
                            {t('Delete')}
                          </Button>
                        </HStack>
                      )}
                    </Box>
                  </Flex>
                );
              })}
              {waitingComments.map((op) => (
                <Flex key={op.id} gap={3} data-testid="waiting-comment">
                  <PersonAvatar name={ws.user.username} size="sm" />
                  <Box flex={1} minW={0}>
                    <Text fontSize="sm" color="orange.500" fontWeight={600}>
                      {t('Waiting to be sent')}
                    </Text>
                    <Box mt={1} px={3} py={2} borderRadius="lg" border="1px dashed" borderColor="orange.400" fontSize="md">
                      <PlainText text={op.kind === 'comment' ? op.body : ''} />
                    </Box>
                  </Box>
                </Flex>
              ))}
              {canEdit ? (
                <Flex gap={2} align="flex-end">
                  <Textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void sendComment()}
                    rows={1}
                    minH="44px"
                    resize="none"
                    sx={{ fieldSizing: 'content' }}
                    placeholder={t('Write a comment…')}
                    aria-label={t('Write a comment…')}
                    data-testid="comment-input"
                  />
                  <Button onClick={() => void sendComment()} isDisabled={!comment.trim()} leftIcon={<MessageIcon boxSize={4} />} flexShrink={0} h="44px" data-testid="comment-send">
                    {t('Send')}
                  </Button>
                </Flex>
              ) : (
                !comments.length && <Text color="mutedText">{t('No comments yet.')}</Text>
              )}
            </VStack>
          </Section>

          {/* the rest, out of the way: links, history, who made it, removing */}
          <Box borderTop="1px solid" borderColor="lineColor" pt={3}>
            <Button variant="ghost" w="100%" justifyContent="space-between" whiteSpace="normal" h="auto" minH="40px" py={2} textAlign="left" rightIcon={<ChevronDownIcon boxSize={5} transform={showMore ? 'rotate(180deg)' : undefined} />} onClick={() => setShowMore(!showMore)} data-testid="card-more">
              <HStack spacing={2.5}>
                <MoreIcon boxSize={4} />
                <Text as="span">{canEdit ? t('More: history, links, remove') : t('More: history')}</Text>
              </HStack>
            </Button>
            <Collapse in={showMore} animateOpacity>
              <VStack align="stretch" spacing={5} pt={3}>
                {!hasLinks && canEdit && (
                  <Box data-testid="links">
                    <Text fontWeight={700} mb={1} display="flex" alignItems="center" gap={2}>
                      <BarChartIcon boxSize={4} color="brand.400" />
                      {t('Search & BI')}
                    </Text>
                    <Text fontSize="sm" color="mutedText" mb={2}>
                      {t('Point this task at a dashboard or question, e.g. the scrap figures it is about.')}
                    </Text>
                    {linksList}
                  </Box>
                )}
                <Box data-testid="history-tab">
                  <Text fontWeight={700} mb={2} display="flex" alignItems="center" gap={2}>
                    <HistoryIcon boxSize={4} color="brand.400" />
                    {t('History')}
                  </Text>
                  <VStack align="stretch" spacing={3} data-testid="history">
                    {history.map((h) => {
                      const who = personName(h.user, detail.people);
                      return (
                        <Flex key={h.id} gap={3} align="flex-start" data-testid="history-entry">
                          <PersonAvatar name={who} size="xs" />
                          <Box flex={1} minW={0}>
                            <Text>{historySentence(h, { people: detail.people, columns, labels: detail.labels })}</Text>
                            <Tooltip label={fullTime(h.created_at)} hasArrow>
                              <Text fontSize="sm" color="mutedText" display="inline-block">
                                {timeAgo(h.created_at)}
                              </Text>
                            </Tooltip>
                          </Box>
                        </Flex>
                      );
                    })}
                    {!history.length && <Text color="mutedText">{t('Nothing happened yet.')}</Text>}
                  </VStack>
                  <Text fontSize="sm" color="mutedText" mt={3}>
                    {t('Created by {user} {when}', { user: personName(card.created_by, detail.people), when: timeAgo(card.created_at) })}
                  </Text>
                </Box>
                {canEdit && !card.archived && (
                  <Box>
                    <Button variant="subtle" leftIcon={<TrashIcon boxSize={4} />} onClick={() => void hide()} data-testid="archive-card">
                      {t('Remove from the board')}
                    </Button>
                    <Text fontSize="sm" color="mutedText" mt={1.5}>
                      {t('The task disappears from the board; you can bring it back from More → Hidden tasks.')}
                    </Text>
                  </Box>
                )}
              </VStack>
            </Collapse>
          </Box>
        </VStack>
      </DrawerBody>
      {linkPicker}
      {preview !== null && <Preview images={images} index={preview} setIndex={setPreview} onClose={() => setPreview(null)} onDelete={canEdit ? (a) => { setPreview(null); removeFile(a); } : undefined} />}
    </>
  );
}
