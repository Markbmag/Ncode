import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box, Button, Checkbox, Collapse, Drawer, DrawerBody, DrawerContent, DrawerFooter, DrawerHeader, DrawerOverlay, Flex, HStack, IconButton, Image, Input, Menu, MenuButton, MenuItem, MenuItemOption, MenuList, MenuOptionGroup, Modal, ModalBody, ModalCloseButton, ModalContent, ModalOverlay, SimpleGrid, Skeleton, Spinner, Text, Textarea, useBreakpointValue, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { useQueryClient } from '@tanstack/react-query';
import { apiErrorMessage } from '../api';
import { CheckIcon, ChevronDownIcon, ChevronRightIcon, DownloadIcon, PencilIcon, PlusIcon, RefreshIcon, TrashIcon, XIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { useWorkspace } from '../workspace/useWorkspace';
import {
  addChecklistItem, addComment, deleteAttachment, deleteCard, deleteChecklistItem, deleteComment, downloadAttachment, kanbanKeys, updateCard,
  updateChecklistItem, updateComment, useCard, useFileUrl,
} from './api';
import type { CardInput } from './api';
import {
  AlignLeftIcon, ArrowDownIcon, ArrowUpIcon, CalendarIcon, CameraIcon, FileIcon, FlagIcon, HistoryIcon, ListChecksIcon, MessageIcon, PaperclipIcon, TagIcon,
  UserIcon,
} from './icons';
import {
  byPosition, colorHex, dueState, dueText, formatSize, fullTime, historySentence, isImage, personName, positionBetween, PRIORITY_COLOR,
  priorityLabel, progressOf, progressText, timeAgo, todayIso, UPLOAD_ACCEPT, withAlpha,
} from './logic';
import { LabelChip, PersonAvatar, PlainText, ProgressBar } from './parts';
import { attachFile } from './upload';
import type { Attachment, BoardDetail, Card, CardSummary, ChecklistItem, Column } from './types';
import { PRIORITIES } from './types';
import { useNotify } from './useNotify';

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

function Section({ icon, title, right, children, testId }: { icon: ReactNode; title: string; right?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Box as="section" data-testid={testId} borderTop="1px solid" borderColor="lineColor" pt={5}>
      <Flex align="center" gap={2.5} mb={3}>
        <Box color="brand.400">{icon}</Box>
        <Text as="h3" fontSize="lg" fontWeight={700} flex={1}>
          {title}
        </Text>
        {right}
      </Flex>
      {children}
    </Box>
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

function Preview({ images, index, setIndex, onClose }: { images: Attachment[]; index: number; setIndex: (i: number) => void; onClose: () => void }) {
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
        <HStack spacing={0.5} opacity={{ base: 1, md: 0.35 }} _groupHover={{ opacity: 1 }} sx={{ '&:focus-within': { opacity: 1 } }}>
          <Tooltip label={t('Move the step up')} hasArrow>
            <IconButton aria-label={t('Move the step up')} size="sm" variant="ghost" icon={<ArrowUpIcon boxSize={4} />} isDisabled={index === 0} onClick={() => onMove(-1)} />
          </Tooltip>
          <Tooltip label={t('Move the step down')} hasArrow>
            <IconButton aria-label={t('Move the step down')} size="sm" variant="ghost" icon={<ArrowDownIcon boxSize={4} />} isDisabled={index === count - 1} onClick={() => onMove(1)} />
          </Tooltip>
          <Tooltip label={t('Change the text')} hasArrow>
            <IconButton aria-label={t('Change the text')} size="sm" variant="ghost" icon={<PencilIcon boxSize={4} />} onClick={() => setEditing(true)} />
          </Tooltip>
          <Tooltip label={t('Remove the step')} hasArrow>
            <IconButton aria-label={t('Remove the step')} size="sm" variant="ghost" icon={<TrashIcon boxSize={4} />} onClick={onDelete} />
          </Tooltip>
        </HStack>
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
        {cardQuery.isPending ? (
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
  const [showHistory, setShowHistory] = useState(false);
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
    void run(() => updateChecklistItem(item.id, { done: value }));
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
    for (const file of chosen) {
      try {
        await attachFile(card.id, file);
        ok += 1;
      } catch (err) {
        notify(apiErrorMessage(err, t('Could not add {file}', { file: file.name })), { error: true });
      } finally {
        setUploading((n) => n - 1);
      }
    }
    setSaveState(ok ? 'saved' : 'error');
    if (ok) notify(ok === 1 ? t('Added {file}', { file: chosen[0].name }) : t('Added {n} files', { n: ok }));
    refresh();
  };

  const sendComment = async () => {
    const body = comment.trim();
    if (!body) return;
    if (await run(() => addComment(card.id, body), t('Could not save the comment'))) setComment('');
  };

  const hide = async () => {
    if (!(await run(() => updateCard(card.id, { archived: true })))) return;
    onClose();
    notify(t('Hid the task “{title}”', { title: card.title }), { undo: () => void updateCard(card.id, { archived: false }).then(refresh) });
  };

  return (
    <>
      <DrawerHeader borderBottom="1px solid" borderColor="lineColor" px={{ base: 4, md: 6 }} py={3} borderTop="5px solid" borderTopColor={done ? '#22c55e' : accent}>
        <Flex align="center" gap={2} wrap="wrap">
          {canEdit ? (
            <Menu isLazy placement="bottom-start">
              <Tooltip label={t('Move this task to another stage')} hasArrow>
                <MenuButton as={Button} variant="subtle" rightIcon={<ChevronDownIcon boxSize={4} />} data-testid="card-column">
                  {t('Stage: {name}', { name: column?.name ?? '' })}
                </MenuButton>
              </Tooltip>
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
            <Text fontWeight={600} color="mutedText">
              {t('Stage: {name}', { name: column?.name ?? '' })}
            </Text>
          )}
          {card.archived && (
            <Text fontWeight={700} color="orange.500">
              {t('Hidden')}
            </Text>
          )}
          <Box flex={1} />
          <Text fontSize="sm" color={saveState === 'error' ? 'red.500' : 'mutedText'} data-testid="save-state" aria-live="polite">
            {saveState === 'saving' ? t('Saving…') : saveState === 'saved' ? t('Saved') : saveState === 'error' ? t('Not saved') : canEdit ? t('Changes save by themselves') : ''}
          </Text>
          <Button variant="subtle" leftIcon={<XIcon boxSize={4} />} onClick={onClose} data-testid="card-close">
            {t('Close')}
          </Button>
        </Flex>
      </DrawerHeader>

      <DrawerBody px={{ base: 4, md: 6 }} py={5}>
        <VStack align="stretch" spacing={6}>
          {/* what */}
          <Box as="section">
            <Flex align="center" gap={2.5} mb={3}>
              <Box color="brand.400">
                <AlignLeftIcon boxSize={5} />
              </Box>
              <Text as="h3" fontSize="lg" fontWeight={700}>
                {t('What needs to be done')}
              </Text>
            </Flex>
            {canEdit ? (
              <VStack align="stretch" spacing={3}>
                {nameIt && (
                  <HStack spacing={3} align="center">
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
                <Textarea
                  autoFocus={nameIt}
                  onFocus={nameIt ? (e) => e.currentTarget.select() : undefined}
                  value={title}
                  onChange={(e) => setTitle(e.target.value.replace(/\n/g, ' '))}
                  onBlur={saveTitle}
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), (e.target as HTMLTextAreaElement).blur())}
                  fontSize="18px"
                  fontWeight={700}
                  rows={1}
                  resize="none"
                  minH="48px"
                  sx={{ fieldSizing: 'content' }}
                  maxLength={300}
                  aria-label={t('Task')}
                  data-testid="card-title"
                />
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  onBlur={saveDescription}
                  rows={4}
                  placeholder={t('More details (optional): what, where, how…')}
                  aria-label={t('More details')}
                  data-testid="description-input"
                />
              </VStack>
            ) : (
              <Box>
                <Text fontSize="18px" fontWeight={700} data-testid="card-title">
                  {card.title}
                </Text>
                {card.description ? (
                  <Box mt={2} fontSize="md" data-testid="card-description">
                    <PlainText text={card.description} />
                  </Box>
                ) : null}
              </Box>
            )}
          </Box>

          {/* who */}
          <Section icon={<UserIcon boxSize={5} />} title={t('Who does it')}>
            <Flex gap={2} wrap="wrap" align="center">
              {card.assignees.map((id) => {
                const name = personName(id, detail.people);
                return (
                  <HStack key={id} spacing={2} pl={1} pr={canEdit ? 1 : 3} py={1} borderRadius="full" bg="chipBg" data-testid="assignee">
                    <PersonAvatar name={name} size="sm" />
                    <Text fontWeight={600}>{name}</Text>
                    {canEdit && (
                      <Tooltip label={t('Take {name} off this task', { name })} hasArrow>
                        <IconButton aria-label={t('Take {name} off this task', { name })} size="sm" variant="ghost" borderRadius="full" icon={<XIcon boxSize={3.5} />} onClick={() => void patch({ assignees: card.assignees.filter((x) => x !== id) })} />
                      </Tooltip>
                    )}
                  </HStack>
                );
              })}
              {canEdit && (
                <Menu closeOnSelect={false} isLazy>
                  <MenuButton as={Button} variant="subtle" leftIcon={<PlusIcon boxSize={4} />} data-testid="assignees-button">
                    {card.assignees.length ? t('Add or remove people') : t('Choose who does it')}
                  </MenuButton>
                  <MenuList zIndex={1700} maxH="50vh" overflowY="auto">
                    <MenuOptionGroup type="checkbox" value={card.assignees.map(String)} onChange={(v) => void patch({ assignees: (Array.isArray(v) ? v : [v]).map(Number) })}>
                      {people.map((p) => (
                        <MenuItemOption key={p.id} value={String(p.id)} fontSize="md">
                          <HStack>
                            <PersonAvatar name={p.username} size="xs" />
                            <Text as="span">{p.username}</Text>
                          </HStack>
                        </MenuItemOption>
                      ))}
                    </MenuOptionGroup>
                  </MenuList>
                </Menu>
              )}
              {!canEdit && !card.assignees.length && <Text color="mutedText">{t('Nobody yet')}</Text>}
            </Flex>
          </Section>

          {/* when */}
          <Section icon={<CalendarIcon boxSize={5} />} title={t('When')}>
            <SimpleGrid columns={2} spacing={3}>
              <Box>
                <Text as="label" htmlFor="card-start" fontWeight={600} display="block" mb={1}>
                  {t('Starts')}
                </Text>
                <Input id="card-start" type="date" value={card.start_date ?? ''} isReadOnly={!canEdit} onChange={(e) => void patch({ start_date: e.target.value || null })} data-testid="card-start" />
              </Box>
              <Box>
                <Text as="label" htmlFor="card-due" fontWeight={600} display="block" mb={1}>
                  {t('Due')}
                </Text>
                <Input
                  id="card-due"
                  type="date"
                  value={card.due_date ?? ''}
                  isReadOnly={!canEdit}
                  onChange={(e) => void patch({ due_date: e.target.value || null })}
                  borderColor={due === 'overdue' ? 'red.500' : undefined}
                  data-testid="card-due"
                />
              </Box>
            </SimpleGrid>
            {card.due_date && (
              <Text mt={2} fontWeight={700} color={due === 'overdue' ? 'red.500' : due === 'today' || due === 'soon' ? 'orange.500' : due === 'done' ? 'green.500' : 'mutedText'} data-testid="due-text">
                {dueText(card.due_date, today, done)}
              </Text>
            )}
          </Section>

          {/* priority and labels */}
          <Section icon={<FlagIcon boxSize={5} />} title={t('How important')}>
            <Flex gap={2} wrap="wrap" role="radiogroup" aria-label={t('Priority')} data-testid="card-priority">
              {PRIORITIES.map((p) => {
                const active = card.priority === p;
                const color = PRIORITY_COLOR[p];
                return (
                  <Button
                    key={p}
                    role="radio"
                    aria-checked={active}
                    isDisabled={!canEdit && !active}
                    onClick={() => canEdit && !active && void patch({ priority: p })}
                    variant="outline"
                    borderColor={active ? color : 'lineColor'}
                    bg={active ? withAlpha(color, 0.16) : 'transparent'}
                    color={active ? color : 'mutedText'}
                    leftIcon={active ? <CheckIcon boxSize={4} /> : <Box w="10px" h="10px" borderRadius="full" bg={color} />}
                    _hover={canEdit ? { bg: withAlpha(color, 0.1) } : undefined}
                    data-testid={`priority-${p}`}
                  >
                    {priorityLabel(p)}
                  </Button>
                );
              })}
            </Flex>
            <HStack mt={4} spacing={2} align="center" wrap="wrap">
              <TagIcon boxSize={4} color="mutedText" />
              <Text fontWeight={600} mr={1}>
                {t('Labels')}
              </Text>
              {cardLabels.map((l) => (
                <LabelChip key={l.id} label={l} />
              ))}
              {canEdit && (
                <Menu closeOnSelect={false} isLazy>
                  <MenuButton as={Button} size="sm" variant="subtle" leftIcon={<PlusIcon boxSize={3.5} />} data-testid="labels-pick">
                    {cardLabels.length ? t('Change labels') : t('Add a label')}
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
            </HStack>
          </Section>

          {/* steps */}
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
              <Flex mt={2} gap={2} direction={{ base: 'column', sm: 'row' }}>
                <Input value={newItem} onChange={(e) => setNewItem(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void addItem()} placeholder={t('A step, e.g. “Order the parts”')} maxLength={500} aria-label={t('New step')} data-testid="new-step" />
                <Button onClick={() => void addItem()} isDisabled={!newItem.trim()} leftIcon={<PlusIcon boxSize={4} />} flexShrink={0} data-testid="add-step">
                  {t('Add a step')}
                </Button>
              </Flex>
            )}
            {!canEdit && !items.length && <Text color="mutedText">{t('No steps yet.')}</Text>}
          </Section>

          {/* photos and files */}
          <Section icon={<PaperclipIcon boxSize={5} />} title={t('Photos and files')} testId="attachments">
            <input ref={fileInput} type="file" multiple accept={UPLOAD_ACCEPT} hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} data-testid="file-input" />
            <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={(e) => { void upload(e.target.files); e.target.value = ''; }} data-testid="camera-input" />
            {canEdit && (
              <Flex gap={2} mb={3} wrap="wrap">
                <Button size="lg" flex={1} minW="200px" variant="subtle" border="1px dashed" borderColor="lineColor" leftIcon={uploading ? <Spinner size="sm" /> : <PaperclipIcon boxSize={5} />} onClick={() => fileInput.current?.click()} data-testid="add-file">
                  {uploading ? t('Adding…') : t('Add photo or file')}
                </Button>
                <Button size="lg" variant="subtle" leftIcon={<CameraIcon boxSize={5} />} onClick={() => cameraInput.current?.click()} display={{ base: 'inline-flex', md: 'none' }} data-testid="take-photo">
                  {t('Take a photo')}
                </Button>
              </Flex>
            )}
            {images.length > 0 && (
              <SimpleGrid columns={{ base: 3, md: 4 }} spacing={2} mb={3}>
                {images.map((a, i) => (
                  <Thumb key={a.id} attachment={a} onOpen={() => setPreview(i)} />
                ))}
              </SimpleGrid>
            )}
            <VStack align="stretch" spacing={1}>
              {[...files, ...images].map((a) => (
                <Flex key={a.id} align="center" gap={3} px={2} py={2} borderRadius="lg" _hover={{ bg: 'panelHover' }} data-testid="attachment-row">
                  <Box color="mutedText">{isImage(a.content_type) ? <CameraIcon boxSize={5} /> : <FileIcon boxSize={5} />}</Box>
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
                      <IconButton
                        aria-label={t('Delete {file}', { file: a.filename })}
                        variant="ghost"
                        icon={<TrashIcon boxSize={4} />}
                        onClick={() => window.confirm(t('Delete the file “{file}” from this task? This cannot be undone.', { file: a.filename })) && void run(() => deleteAttachment(a.id))}
                      />
                    </Tooltip>
                  )}
                </Flex>
              ))}
            </VStack>
            {!card.attachments_list.length && !canEdit && <Text color="mutedText">{t('No photos or files.')}</Text>}
          </Section>

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
              {canEdit ? (
                <Flex gap={3}>
                  <PersonAvatar name={ws.user.username} size="sm" />
                  <Box flex={1}>
                    <Textarea value={comment} onChange={(e) => setComment(e.target.value)} onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && void sendComment()} rows={2} placeholder={t('Write a comment…')} aria-label={t('Write a comment…')} data-testid="comment-input" />
                    <Button mt={2} onClick={() => void sendComment()} isDisabled={!comment.trim()} leftIcon={<MessageIcon boxSize={4} />} data-testid="comment-send">
                      {t('Add the comment')}
                    </Button>
                  </Box>
                </Flex>
              ) : (
                !comments.length && <Text color="mutedText">{t('No comments yet.')}</Text>
              )}
            </VStack>
          </Section>

          {/* history */}
          <Section
            icon={<HistoryIcon boxSize={5} />}
            title={t('History')}
            right={
              <Button size="sm" variant="ghost" rightIcon={<ChevronDownIcon boxSize={4} transform={showHistory ? 'rotate(180deg)' : undefined} />} onClick={() => setShowHistory(!showHistory)} data-testid="history-tab">
                {showHistory ? t('Hide the history') : t('Show who did what')}
              </Button>
            }
          >
            <Collapse in={showHistory} animateOpacity>
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
            </Collapse>
          </Section>
        </VStack>
      </DrawerBody>

      {(canEdit || (card.archived && canRestore)) && (
        <DrawerFooter borderTop="1px solid" borderColor="lineColor" justifyContent="space-between" gap={2} px={{ base: 4, md: 6 }}>
          <Text fontSize="sm" color="mutedText" noOfLines={1}>
            {t('Created by {user} {when}', { user: personName(card.created_by, detail.people), when: timeAgo(card.created_at) })}
          </Text>
          {card.archived ? (
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
          ) : (
            <Tooltip label={t('The task disappears from the board; you can bring it back from More → Hidden tasks.')} hasArrow>
              <Button variant="subtle" leftIcon={<TrashIcon boxSize={4} />} onClick={() => void hide()} data-testid="archive-card">
                {t('Remove from the board')}
              </Button>
            </Tooltip>
          )}
        </DrawerFooter>
      )}
      {preview !== null && <Preview images={images} index={preview} setIndex={setPreview} onClose={() => setPreview(null)} />}
    </>
  );
}
