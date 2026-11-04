import { memo, useCallback, useMemo, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import {
  Badge, Box, Button, Flex, Heading, HStack, IconButton, Input, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Portal, Select, Skeleton, Text, Textarea, useToast, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import {
  closestCorners, DndContext, DragOverlay, KeyboardSensor, MeasuringStrategy, MouseSensor, TouchSensor, useDroppable, useSensor, useSensors,
} from '@dnd-kit/core';
import type { DragEndEvent, DragOverEvent, DragStartEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { ArchiveIcon, CheckIcon, ChevronDownIcon, EyeIcon, MoreIcon, PencilIcon, PlusIcon, SettingsIcon, TrashIcon, UsersIcon, XIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';
import { useWorkspace } from '../workspace/useWorkspace';
import { createCard, createColumn, deleteColumn, kanbanKeys, moveCard, undoRepeat, updateCard, updateColumn, useArchivedCards, useBoard } from './api';
import { CalendarView } from './CalendarView';
import { CardDrawer } from './CardDrawer';
import { CardFace } from './CardFace';
import { BoardSettingsDialog, LabelsDialog, MembersDialog } from './dialogs';
import { ArrowLeftIcon, CalendarIcon, CameraIcon, FilterIcon, KanbanIcon, TagIcon } from './icons';
import {
  applyMove, byPosition, colorHex, filterActive, filterCount, groupName, liveSentence, matchesFilter, NO_FILTER, PALETTE, personName, positionBetween,
  dayTitle, photoTaskTitle, priorityLabel, stageInView, tabColumn, todayIso, withAlpha,
} from './logic';
import type { CardFilter } from './logic';
import { AvatarStack, EmptyState, PersonAvatar } from './parts';
import type { BoardDetail, BoardEvent, Card, CardSummary, Column, Priority } from './types';
import { PRIORITIES } from './types';
import { useBoardSocket } from './useBoardSocket';
import { useNotify } from './useNotify';
import { MoveSheet, StageTabs } from './phone';
import { attachFile } from './upload';

const cardKey = (id: number) => `c${id}`;
const colKey = (id: number) => `col${id}`;
const idOf = (key: string | number) => Number(String(key).replace(/^col|^c/, ''));
type Items = Record<number, number[]>;
const COLUMN_W = { base: 'calc(100vw - 48px)', sm: '316px' };

function findColumn(key: string | number, items: Items): number | null {
  const s = String(key);
  if (s.startsWith('col')) return idOf(s);
  const id = idOf(s);
  for (const [col, ids] of Object.entries(items)) if (ids.includes(id)) return Number(col);
  return null;
}

/** The drag started with a finger (phones and tablets), not a mouse or the keyboard. */
const isTouch = (event: Event | null | undefined) => typeof TouchEvent !== 'undefined' && event instanceof TouchEvent;

// ---------------------------------------------------------------- one task that can be dragged

interface SortableCardProps {
  card: CardSummary;
  board: BoardDetail;
  columns: Column[];
  today: string;
  done: boolean;
  accent: string;
  disabled: boolean;
  onOpen: (id: number) => void;
  onMove: (card: CardSummary, columnId: number) => void;
}

const SortableCard = memo(function SortableCard({ card, board, columns, today, done, accent, disabled, onOpen, onMove }: SortableCardProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: cardKey(card.id), disabled, data: { type: 'card' } });
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      {...(disabled ? { role: 'button', tabIndex: 0 } : attributes)}
      {...(disabled ? {} : listeners)}
      onClick={() => onOpen(card.id)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(card.id);
        else listeners?.onKeyDown?.(e);
      }}
      sx={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', userSelect: 'none' }}
      borderRadius="xl"
      _focusVisible={{ outline: '2px solid', outlineColor: 'brand.400', outlineOffset: '2px' }}
      aria-label={t('Open the task {title}', { title: card.title })}
    >
      <CardFace
        card={card}
        labels={board.labels}
        people={board.people}
        today={today}
        done={done}
        accent={accent}
        ghost={isDragging}
        columns={disabled ? undefined : columns}
        onMove={disabled ? undefined : onMove}
      />
    </Box>
  );
});

// ---------------------------------------------------------------- a stage (column)

interface ColumnViewProps {
  column: Column;
  index: number;
  columns: Column[];
  ids: number[];
  cardsById: Map<number, CardSummary>;
  total: number; // tasks in the stage without filters
  board: BoardDetail;
  today: string;
  canEdit: boolean;
  onOpen: (id: number) => void;
  onMove: (card: CardSummary, columnId: number) => void;
  onAdd: (column: Column, title: string) => Promise<void>;
  onChangeColumn: (column: Column, body: Partial<Column>) => void;
  onMoveColumn: (column: Column, by: -1 | 1) => void;
  onDeleteColumn: (column: Column) => void;
  onPhotoTask: (column: Column, file: File) => Promise<void>;
}

function ColumnView({ column, index, columns, ids, cardsById, total, board, today, canEdit, onOpen, onMove, onAdd, onChangeColumn, onMoveColumn, onDeleteColumn, onPhotoTask }: ColumnViewProps) {
  const camera = useRef<HTMLInputElement>(null);
  const [sending, setSending] = useState(false);
  const { setNodeRef, isOver } = useDroppable({ id: colKey(column.id), data: { type: 'column' } });
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(column.name);
  const accent = colorHex(column.color, column.is_done ? '#22c55e' : '#94a3b8');
  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    const text = title.trim();
    if (!text) return;
    setTitle('');
    await onAdd(column, text);
  };
  const rename = (e?: FormEvent) => {
    e?.preventDefault();
    setRenaming(false);
    if (name.trim() && name.trim() !== column.name) onChangeColumn(column, { name: name.trim() });
    else setName(column.name);
  };
  return (
    <Flex
      direction="column"
      w={COLUMN_W}
      flexShrink={0}
      maxH="100%"
      bg="columnBg"
      borderRadius="2xl"
      borderTop="4px solid"
      borderTopColor={accent}
      sx={{ scrollSnapAlign: 'center' }}
      data-testid="column"
      data-column-id={column.id}
      data-column-name={column.name}
    >
      <Flex align="center" gap={2} px={3.5} pt={3} pb={2} minH="52px">
        {renaming ? (
          <Box as="form" onSubmit={rename} flex={1}>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onBlur={() => rename()} onKeyDown={(e) => e.key === 'Escape' && (setName(column.name), setRenaming(false))} maxLength={80} aria-label={t('Stage name')} bg="cardBg" />
          </Box>
        ) : (
          <HStack flex={1} minW={0} spacing={2}>
            {column.is_done && (
              <Tooltip label={t('Tasks here count as done')} hasArrow>
                <Flex w="22px" h="22px" borderRadius="full" bg="#22c55e" color="white" align="center" justify="center" flexShrink={0}>
                  <CheckIcon boxSize={3.5} />
                </Flex>
              </Tooltip>
            )}
            <Text fontWeight={700} fontSize="17px" noOfLines={1} data-testid="column-name">
              {column.name}
            </Text>
            <Tooltip label={tn(total, '{n} task', '{n} tasks')} hasArrow>
              <Badge bg={withAlpha(accent, 0.18)} color="bodyText" borderRadius="full" px={2.5} fontSize="sm" fontWeight={700}>
                {ids.length === total ? total : `${ids.length}/${total}`}
              </Badge>
            </Tooltip>
          </HStack>
        )}
        {canEdit && !renaming && (
          <Menu isLazy placement="bottom-end">
            <Tooltip label={t('Rename, colour, delete this stage')} hasArrow openDelay={400}>
              <MenuButton as={Button} size="sm" variant="ghost" rightIcon={<ChevronDownIcon boxSize={4} />} color="mutedText" data-testid="column-menu">
                {t('More')}
              </MenuButton>
            </Tooltip>
            <Portal>
              <MenuList zIndex={1600} fontSize="md" minW="250px">
                <MenuItem icon={<PencilIcon boxSize={4} />} onClick={() => setRenaming(true)}>
                  {t('Rename this stage')}
                </MenuItem>
                <MenuItem icon={<CheckIcon boxSize={4} />} onClick={() => onChangeColumn(column, { is_done: !column.is_done })} data-testid="column-done-toggle">
                  {column.is_done ? t('Tasks here are not done yet') : t('Tasks here count as done')}
                </MenuItem>
                <Box px={3} py={2}>
                  <Text fontSize="sm" color="mutedText" mb={2}>
                    {t('Colour')}
                  </Text>
                  <Flex gap={1.5} wrap="wrap">
                    {PALETTE.map((p) => (
                      <Tooltip key={p.name} label={p.name} hasArrow>
                        <Box as="button" type="button" aria-label={p.name} w="26px" h="26px" borderRadius="md" bg={p.hex} boxShadow={column.color === p.name ? `0 0 0 2px var(--chakra-colors-panelBg), 0 0 0 4px ${p.hex}` : undefined} onClick={() => onChangeColumn(column, { color: p.name })} />
                      </Tooltip>
                    ))}
                  </Flex>
                </Box>
                <MenuDivider />
                <MenuItem isDisabled={index === 0} onClick={() => onMoveColumn(column, -1)}>
                  {t('Move this stage left')}
                </MenuItem>
                <MenuItem isDisabled={index === columns.length - 1} onClick={() => onMoveColumn(column, 1)}>
                  {t('Move this stage right')}
                </MenuItem>
                <MenuDivider />
                <MenuItem icon={<TrashIcon boxSize={4} />} color="red.500" isDisabled={total > 0} onClick={() => onDeleteColumn(column)} data-testid="column-delete">
                  {total > 0 ? t('Delete this stage (move its tasks first)') : t('Delete this stage')}
                </MenuItem>
              </MenuList>
            </Portal>
          </Menu>
        )}
      </Flex>

      {canEdit && (
        <Box px={2} pb={2}>
          {adding ? (
            <Box as="form" onSubmit={(e: FormEvent) => void submit(e)}>
              <Textarea
                autoFocus
                rows={2}
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void submit();
                  } else if (e.key === 'Escape') {
                    setAdding(false);
                    setTitle('');
                  }
                }}
                placeholder={t('What needs to be done?')}
                bg="cardBg"
                borderRadius="xl"
                resize="none"
                fontSize="md"
                maxLength={300}
                aria-label={t('What needs to be done?')}
                data-testid="new-card-title"
              />
              <HStack mt={2} spacing={2}>
                <Button type="submit" isDisabled={!title.trim()} leftIcon={<PlusIcon boxSize={4} />} data-testid="new-card-save">
                  {t('Add the task')}
                </Button>
                <Button variant="ghost" leftIcon={<XIcon boxSize={4} />} onClick={() => { setAdding(false); setTitle(''); }}>
                  {t('Cancel')}
                </Button>
              </HStack>
            </Box>
          ) : (
            <HStack spacing={2}>
            <Button
              flex={1}
              h="44px"
              variant="ghost"
              justifyContent="flex-start"
              leftIcon={<PlusIcon boxSize={5} />}
              bg="cardBg"
              border="1px dashed"
              borderColor="rgba(99,102,241,0.45)"
              borderRadius="xl"
              color="brand.600"
              _dark={{ color: 'brand.200' }}
              fontSize="md"
              fontWeight={700}
              boxShadow="card"
              _hover={{ bg: 'cardHoverBg', borderColor: 'brand.400' }}
              onClick={() => setAdding(true)}
              data-testid="column-add-card"
            >
              {t('Add a task')}
            </Button>
            {/* phones: a new task straight from a photo (K2) */}
            <Tooltip label={t('New task from a photo')} hasArrow>
              <IconButton
                aria-label={t('New task from a photo')}
                icon={<CameraIcon boxSize={5} />}
                h="44px"
                minW="44px"
                variant="subtle"
                borderRadius="xl"
                display={{ base: 'inline-flex', md: 'none' }}
                isLoading={sending}
                onClick={() => camera.current?.click()}
                data-testid="column-photo-task"
              />
            </Tooltip>
            <input
              ref={camera}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                setSending(true);
                void onPhotoTask(column, file).finally(() => setSending(false));
              }}
              data-testid="column-photo-input"
            />
            </HStack>
          )}
        </Box>
      )}

      <SortableContext items={ids.map(cardKey)} strategy={verticalListSortingStrategy}>
        <Flex
          ref={setNodeRef}
          direction="column"
          gap={2.5}
          px={2}
          pb={2}
          pt={0.5}
          flex={1}
          minH="72px"
          overflowY="auto"
          overflowX="hidden"
          borderRadius="xl"
          bg={isOver && !ids.length ? 'dropBg' : undefined}
          transition="background 0.15s"
          data-testid="column-cards"
        >
          {ids.map((id) => {
            const card = cardsById.get(id);
            return card ? (
              <SortableCard
                key={id}
                card={card}
                board={board}
                columns={columns}
                today={today}
                done={column.is_done || card.completed_at !== null}
                accent={column.color ?? board.board.color ?? 'indigo'}
                disabled={!canEdit}
                onOpen={onOpen}
                onMove={onMove}
              />
            ) : null;
          })}
          {!ids.length && (
            <Flex flex={1} minH="72px" align="center" justify="center" border="1px dashed" borderColor="lineColor" borderRadius="xl" color="mutedText" fontSize="sm" textAlign="center" px={3}>
              {total ? t('No task matches the filters') : canEdit ? t('Drag a task here, or use “Move to…” on a task') : t('No tasks here')}
            </Flex>
          )}
        </Flex>
      </SortableContext>
    </Flex>
  );
}

function AddColumn({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    await onAdd(name.trim());
    setName('');
  };
  if (!open) {
    return (
      <Button
        flexShrink={0}
        w={COLUMN_W}
        h="52px"
        variant="ghost"
        border="1px dashed"
        borderColor="lineColor"
        borderRadius="2xl"
        color="mutedText"
        fontSize="md"
        leftIcon={<PlusIcon boxSize={5} />}
        onClick={() => setOpen(true)}
        sx={{ scrollSnapAlign: 'center' }}
        data-testid="add-column"
      >
        {t('Add a stage')}
      </Button>
    );
  }
  return (
    <Box as="form" onSubmit={(e: FormEvent) => void submit(e)} flexShrink={0} w={COLUMN_W} p={3} bg="columnBg" borderRadius="2xl" alignSelf="flex-start">
      <Text fontWeight={600} mb={2}>
        {t('Name of the new stage')}
      </Text>
      <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && setOpen(false)} placeholder={t('e.g. Waiting for parts')} maxLength={80} bg="cardBg" data-testid="new-column-name" />
      <HStack mt={2}>
        <Button type="submit" isDisabled={!name.trim()} leftIcon={<PlusIcon boxSize={4} />} data-testid="new-column-save">
          {t('Add the stage')}
        </Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>
          {t('Cancel')}
        </Button>
      </HStack>
    </Box>
  );
}

/** The board's hidden tasks: open one to bring it back or delete it. */
function HiddenTasks({ boardId, onOpen, onClose }: { boardId: number; onOpen: (id: number) => void; onClose: () => void }) {
  const cards = useArchivedCards(boardId, true);
  return (
    <Modal isOpen onClose={onClose} size="md" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={3}>
        <ModalHeader>{t('Hidden tasks')}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          <Text color="mutedText" mb={3}>
            {t('Hidden tasks are not shown on the board. Open one to bring it back.')}
          </Text>
          {cards.isPending ? (
            <Skeleton h="44px" borderRadius="lg" />
          ) : cards.data?.length ? (
            <VStack align="stretch" spacing={2}>
              {cards.data.map((c) => (
                <Button key={c.id} variant="subtle" justifyContent="flex-start" h="44px" onClick={() => { onClose(); onOpen(c.id); }} data-testid="archived-card">
                  {c.title}
                </Button>
              ))}
            </VStack>
          ) : (
            <Text>{t('No hidden tasks.')}</Text>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  );
}

// ---------------------------------------------------------------- filters

function FilterBar({ filter, setFilter, board, me }: { filter: CardFilter; setFilter: (f: CardFilter) => void; board: BoardDetail; me: number | null }) {
  const [more, setMore] = useState(false);
  const chip = (active: boolean) => ({
    size: 'md' as const,
    variant: 'subtle',
    borderRadius: 'full',
    bg: active ? 'rgba(99,102,241,0.18)' : 'chipBg',
    color: active ? 'brand.600' : 'bodyText',
    _dark: { color: active ? 'brand.200' : 'bodyText' },
    border: '1px solid',
    borderColor: active ? 'rgba(99,102,241,0.55)' : 'transparent',
    flexShrink: 0,
    fontWeight: 600,
  });
  const extra = filter.person !== null || filter.label !== null || filter.priority !== null;
  return (
    <Flex gap={2} align="center" overflowX="auto" py={1.5} px={{ base: 3, md: 5 }} data-testid="filter-bar" sx={{ scrollbarWidth: 'none' }}>
      <Text as="span" fontWeight={600} color="mutedText" flexShrink={0} display={{ base: 'none', md: 'inline' }}>
        {t('Show:')}
      </Text>
      {me !== null && (
        <Button {...chip(filter.mine)} leftIcon={filter.mine ? <CheckIcon boxSize={4} /> : undefined} onClick={() => setFilter({ ...filter, mine: !filter.mine })} data-testid="filter-mine">
          {t('My tasks')}
        </Button>
      )}
      <Button {...chip(filter.overdue)} leftIcon={filter.overdue ? <CheckIcon boxSize={4} /> : undefined} onClick={() => setFilter({ ...filter, overdue: !filter.overdue })} data-testid="filter-overdue">
        {t('Late tasks')}
      </Button>
      <Button {...chip(more || extra)} leftIcon={<FilterIcon boxSize={4} />} onClick={() => setMore(!more)} data-testid="filter-more">
        {more ? t('Fewer filters') : t('More filters')}
      </Button>
      {(more || extra) && (
        <>
          <Select w="auto" minW="150px" flexShrink={0} borderRadius="full" value={filter.person ?? ''} onChange={(e) => setFilter({ ...filter, person: e.target.value ? Number(e.target.value) : null })} aria-label={t('Person')} data-testid="filter-person">
            <option value="">{t('Anyone')}</option>
            {board.people.filter((p) => p.active !== false).map((p) => (
              <option key={p.id} value={p.id}>
                {p.username}
              </option>
            ))}
          </Select>
          <Select w="auto" minW="140px" flexShrink={0} borderRadius="full" value={filter.label ?? ''} onChange={(e) => setFilter({ ...filter, label: e.target.value ? Number(e.target.value) : null })} aria-label={t('Label')} data-testid="filter-label">
            <option value="">{t('Any label')}</option>
            {board.labels.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select w="auto" minW="150px" flexShrink={0} borderRadius="full" value={filter.priority ?? ''} onChange={(e) => setFilter({ ...filter, priority: (e.target.value || null) as Priority | null })} aria-label={t('Priority')} data-testid="filter-priority">
            <option value="">{t('Any priority')}</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {priorityLabel(p)}
              </option>
            ))}
          </Select>
        </>
      )}
      {filterActive({ ...filter, q: '' }) && (
        <Button variant="ghost" flexShrink={0} leftIcon={<XIcon boxSize={4} />} onClick={() => setFilter({ ...NO_FILTER, q: filter.q })}>
          {t('Show all tasks ({n} filters on)', { n: filterCount({ ...filter, q: '' }) })}
        </Button>
      )}
    </Flex>
  );
}

/** What to do on a new board, in three steps. */
function FirstSteps({ firstColumn, doneColumn }: { firstColumn: string; doneColumn: string }) {
  const steps = [
    t('Add a task with “+ Add a task” under {column}.', { column: firstColumn }),
    t('When you start it, drag it on, or press “Move to…” on the task.'),
    t('Tick its steps as you go, then move it to {column}.', { column: doneColumn }),
  ];
  return (
    <Flex mx={{ base: 3, md: 5 }} mt={2} mb={1} p={4} gap={{ base: 3, md: 6 }} direction={{ base: 'column', md: 'row' }} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="2xl" data-testid="first-steps">
      <Text fontWeight={700} fontSize="lg" flexShrink={0}>
        {t('How it works')}
      </Text>
      {steps.map((s, i) => (
        <HStack key={i} align="flex-start" spacing={2.5} flex={1}>
          <Flex w="28px" h="28px" borderRadius="full" bg="brand.500" color="white" fontWeight={700} align="center" justify="center" flexShrink={0}>
            {i + 1}
          </Flex>
          <Text>{s}</Text>
        </HStack>
      ))}
    </Flex>
  );
}

/** Board | Calendar (K3): the same tasks as stages or on their dates. */
function ViewSwitch({ view, onChange, wide = false }: { view: 'board' | 'calendar'; onChange: (v: 'board' | 'calendar') => void; wide?: boolean }) {
  const items = [
    { key: 'board' as const, label: t('Board'), icon: <KanbanIcon boxSize={4} /> },
    { key: 'calendar' as const, label: t('Calendar'), icon: <CalendarIcon boxSize={4} /> },
  ];
  return (
    <HStack spacing={0} bg="chipBg" borderRadius="lg" p="3px" role="group" aria-label={t('Show the board as')} data-testid="view-switch" w={wide ? '100%' : undefined}>
      {items.map((it) => (
        <Button
          key={it.key}
          flex={wide ? 1 : undefined}
          size="sm"
          h={wide ? '40px' : '36px'}
          fontSize="md"
          variant={view === it.key ? 'solid' : 'ghost'}
          bg={view === it.key ? 'cardBg' : 'transparent'}
          boxShadow={view === it.key ? 'card' : undefined}
          leftIcon={it.icon}
          aria-pressed={view === it.key}
          onClick={() => onChange(it.key)}
          data-testid={`view-${it.key}`}
        >
          {it.label}
        </Button>
      ))}
    </HStack>
  );
}

// ---------------------------------------------------------------- the page

function BoardSkeleton() {
  return (
    <Box p={{ base: 3, md: 5 }}>
      <Skeleton h="34px" w="260px" borderRadius="lg" mb={5} />
      <HStack align="flex-start" spacing={3} overflow="hidden">
        {[5, 3, 4].map((n, i) => (
          <Box key={i} w="316px" flexShrink={0} bg="columnBg" borderRadius="2xl" p={2}>
            <Skeleton h="22px" w="140px" mb={3} borderRadius="md" />
            {Array.from({ length: n }, (_, j) => (
              <Skeleton key={j} h={j % 2 ? '104px' : '72px'} borderRadius="xl" mb={2} />
            ))}
          </Box>
        ))}
      </HStack>
    </Box>
  );
}

export default function BoardPage() {
  const params = useParams();
  const boardId = Number(params.board);
  const cardId = params.card ? Number(params.card) : null;
  const [search, setSearch] = useSearchParams();
  const view: 'board' | 'calendar' = search.get('view') === 'calendar' ? 'calendar' : 'board';
  const q = search.get('q') ?? '';
  const navigate = useNavigate();
  const toast = useToast();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const ws = useWorkspace();
  const boardQuery = useBoard(boardId);
  const detail = boardQuery.data;
  const [filterState, setFilter] = useState<CardFilter>(NO_FILTER);
  const filter = useMemo(() => ({ ...filterState, q }), [filterState, q]);
  const [drag, setDrag] = useState<{ id: number; from: number; items: Items } | null>(null);
  const [dialog, setDialog] = useState<'members' | 'labels' | 'settings' | 'hidden' | null>(null);
  const today = todayIso();
  const scroller = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0); // phones: the stage in view
  const [sheet, setSheet] = useState<number | null>(null); // phones: the task held for "Move to"

  const onOther = useCallback(
    (event: BoardEvent, title: string | null) => {
      const id = `live-${event.by}-${event.action}-${event.card_id ?? ''}`;
      if (toast.isActive(id)) return; // the same change again (e.g. several steps added): one note is enough
      toast({
        id,
        position: 'bottom-left',
        duration: 4000,
        render: () => (
          <HStack bg="panelBg" border="1px solid" borderColor="lineColor" boxShadow="xl" borderRadius="xl" px={3.5} py={2.5} spacing={2.5} data-testid="live-toast">
            <PersonAvatar name={event.by ?? '?'} size="sm" />
            <Text fontSize="md">{liveSentence(event, title)}</Text>
          </HStack>
        ),
      });
    },
    [toast],
  );
  const live = useBoardSocket(boardId, ws.user.username, onOther);

  const me = detail?.people.find((p) => p.username === ws.user.username)?.id ?? null;
  const canEdit = Boolean(detail && !detail.board.archived && (detail.board.can_edit ?? (ws.isAdmin || detail.board.role)));
  const canManage = Boolean(detail && (detail.board.can_manage ?? (ws.isAdmin || detail.board.role === 'owner')));
  const columns = useMemo(() => [...(detail?.columns ?? [])].sort(byPosition), [detail?.columns]);
  const doneColumns = useMemo(() => new Set(columns.filter((c) => c.is_done).map((c) => c.id)), [columns]);
  const cardsById = useMemo(() => new Map((detail?.cards ?? []).map((c) => [c.id, c])), [detail?.cards]);

  const { visible, totals } = useMemo(() => {
    const ctx = { me, today, doneColumns, labels: detail?.labels ?? [] };
    const v: Items = {};
    const tot: Record<number, number> = {};
    for (const c of columns) {
      v[c.id] = [];
      tot[c.id] = 0;
    }
    for (const card of [...(detail?.cards ?? [])].sort(byPosition)) {
      if (!(card.column_id in v) || card.archived) continue;
      tot[card.column_id] += 1;
      if (matchesFilter(card, filter, ctx)) v[card.column_id].push(card.id);
    }
    return { visible: v, totals: tot };
  }, [detail?.cards, detail?.labels, columns, filter, me, today, doneColumns]);
  const items = drag?.items ?? visible;

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: kanbanKeys.board(boardId) });
    void queryClient.invalidateQueries({ queryKey: ['kanban', 'boards'] });
  }, [queryClient, boardId]);

  const fail = useCallback((err: unknown, fallback: string) => notify(apiErrorMessage(err, fallback), { error: true }), [notify]);

  // the board's address without "name=1" (only the task just made from a photo asks for its name)
  const boardSearch = useMemo(() => {
    const next = new URLSearchParams(search);
    next.delete('name');
    return next.toString();
  }, [search]);

  const lastDrag = useRef(0); // the click that ends a drag does not open the task
  const openCard = useCallback(
    (id: number) => {
      if (Date.now() - lastDrag.current < 300) return;
      navigate({ pathname: `/kanban/b/${boardId}/c/${id}`, search: boardSearch });
    },
    [navigate, boardId, boardSearch],
  );

  /** Moves a task; the board shows it at once, before the server answers. */
  const shift = useCallback(
    async (id: number, columnId: number, position: number): Promise<Card | null> => {
      queryClient.setQueryData<BoardDetail>(kanbanKeys.board(boardId), (old) => (old ? { ...old, cards: applyMove(old.cards, id, columnId, position, doneColumns) } : old));
      try {
        return await moveCard(id, columnId, position);
      } catch (err) {
        fail(err, t('Could not move the task'));
        return null;
      } finally {
        refresh();
      }
    },
    [queryClient, boardId, doneColumns, refresh, fail],
  );

  /** ... and says where it went, with Undo. */
  const move = useCallback(
    (id: number, columnId: number, position: number) => {
      const card = queryClient.getQueryData<BoardDetail>(kanbanKeys.board(boardId))?.cards.find((c) => c.id === id);
      if (!card) return;
      const before = { column: card.column_id, position: card.position };
      const target = columns.find((c) => c.id === columnId);
      void shift(id, columnId, position).then((res) => {
        if (!res || before.column === columnId) return;
        const next = res.next;
        if (next && card.repeat) {
          // K3: a repeating task came back; Undo also takes the new one away again
          const repeat = card.repeat;
          notify(t('Moved “{title}” to {column}. It repeats: the next one is due {date}.', { title: card.title, column: target?.name ?? '', date: dayTitle(next.due_date) }), {
            undo: () => void undoRepeat(id, repeat, next.id).then(() => shift(id, before.column, before.position)),
          });
          return;
        }
        notify(t('Moved “{title}” to {column}', { title: card.title, column: target?.name ?? '' }), { undo: () => void shift(id, before.column, before.position) });
      });
    },
    [queryClient, boardId, columns, shift, notify],
  );

  const moveTo = useCallback(
    (card: CardSummary, columnId: number) => {
      const top = (detail?.cards ?? []).filter((c) => c.column_id === columnId && c.id !== card.id).sort(byPosition)[0];
      move(card.id, columnId, positionBetween(undefined, top?.position));
    },
    [detail?.cards, move],
  );

  // ------------------------------------------------ phones: which stage is in view (K2)
  const onScrollColumns = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const kids = [...el.querySelectorAll<HTMLElement>('[data-testid="column"]')];
    setStage(stageInView(el.scrollLeft, el.clientWidth, kids.map((k) => ({ left: k.offsetLeft - el.offsetLeft, width: k.offsetWidth }))));
  }, []);
  const showStage = useCallback((index: number) => {
    const el = scroller.current?.querySelectorAll<HTMLElement>('[data-testid="column"]')[index];
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
    setStage(index);
  }, []);
  // ------------------------------------------------ drag and drop
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const onDragStart = ({ active, activatorEvent }: DragStartEvent) => {
    if (isTouch(activatorEvent)) navigator.vibrate?.(15); // a short buzz on Android: the task is picked up
    const id = idOf(active.id);
    const from = findColumn(active.id, visible);
    if (from === null) return;
    setDrag({ id, from, items: Object.fromEntries(Object.entries(visible).map(([k, v]) => [k, [...v]])) });
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDrag((d) => {
      if (!d) return d;
      const fromCol = findColumn(active.id, d.items);
      const toCol = findColumn(over.id, d.items);
      if (fromCol === null || toCol === null || fromCol === toCol) return d;
      const id = idOf(active.id);
      const target = d.items[toCol];
      const overIndex = String(over.id).startsWith('col') ? target.length : target.indexOf(idOf(over.id));
      const below = over.rect && active.rect.current.translated ? active.rect.current.translated.top > over.rect.top + over.rect.height / 2 : false;
      const index = overIndex < 0 ? target.length : overIndex + (below && !String(over.id).startsWith('col') ? 1 : 0);
      const next = { ...d.items, [fromCol]: d.items[fromCol].filter((x) => x !== id), [toCol]: [...target.slice(0, index), id, ...target.slice(index)] };
      return { ...d, items: next };
    });
  };

  const onDragEnd = ({ active, over, delta, activatorEvent }: DragEndEvent) => {
    const d = drag;
    setDrag(null);
    lastDrag.current = Date.now();
    if (!d || !detail) return;
    const id = idOf(active.id);
    // phones: held and let go without moving -> big "Move to" buttons
    if (isTouch(activatorEvent) && Math.hypot(delta.x, delta.y) < 12) {
      setSheet(id);
      return;
    }
    // phones: dropped on a stage tab -> to the top of that stage
    const toTab = over ? tabColumn(over.id) : null;
    if (toTab !== null) {
      const card = cardsById.get(id);
      if (card && card.column_id !== toTab) moveTo(card, toTab);
      showStage(columns.findIndex((c) => c.id === toTab));
      return;
    }
    if (!over) return;
    const col = findColumn(active.id, d.items);
    if (col === null) return;
    let list = d.items[col];
    if (!String(over.id).startsWith('col')) {
      const from = list.indexOf(id);
      const to = list.indexOf(idOf(over.id));
      if (from >= 0 && to >= 0 && from !== to) list = arrayMove(list, from, to);
    }
    const index = list.indexOf(id);
    if (!cardsById.get(id) || index < 0) return;
    if (col === d.from && visible[d.from].indexOf(id) === index) return; // dropped where it was
    const before = list[index - 1] !== undefined ? cardsById.get(list[index - 1])?.position : undefined;
    const after = list[index + 1] !== undefined ? cardsById.get(list[index + 1])?.position : undefined;
    move(id, col, positionBetween(before, after));
  };

  // ------------------------------------------------ phones (K2)
  const photoTask = useCallback(
    async (column: Column, file: File) => {
      try {
        const card = await createCard(boardId, { column_id: column.id, title: photoTaskTitle(new Date(), t('Photo')) });
        await attachFile(card.id, file);
        refresh();
        navigate({ pathname: `/kanban/b/${boardId}/c/${card.id}`, search: boardSearch ? `${boardSearch}&name=1` : 'name=1' });
      } catch (err) {
        fail(err, t('Could not add the photo'));
        refresh();
      }
    },
    [boardId, refresh, navigate, fail, boardSearch],
  );

  // ------------------------------------------------ calendar (K3): a task's date, with Undo
  const saveDates = useCallback(
    async (id: number, dates: { due_date: string | null; start_date: string | null }): Promise<boolean> => {
      queryClient.setQueryData<BoardDetail>(kanbanKeys.board(boardId), (old) => (old ? { ...old, cards: old.cards.map((c) => (c.id === id ? { ...c, ...dates } : c)) } : old));
      try {
        await updateCard(id, dates);
        return true;
      } catch (err) {
        fail(err, t('Could not save the change'));
        return false;
      } finally {
        refresh();
      }
    },
    [queryClient, boardId, refresh, fail],
  );
  const setDate = useCallback(
    (card: CardSummary, date: string | null) => {
      const before = { due_date: card.due_date, start_date: card.start_date };
      // a start after the new due date would not make sense: it moves along; "no date" clears both
      const start = date === null ? null : card.start_date && card.start_date > date ? date : card.start_date;
      void saveDates(card.id, { due_date: date, start_date: start }).then((ok) => {
        if (!ok) return;
        notify(date ? t('“{title}” is now due {date}', { title: card.title, date: dayTitle(date) }) : t('“{title}” has no date now', { title: card.title }), {
          undo: () => void saveDates(card.id, before),
        });
      });
    },
    [saveDates, notify],
  );
  const setView = (next: 'board' | 'calendar') => {
    const params = new URLSearchParams(search);
    if (next === 'calendar') params.set('view', 'calendar');
    else params.delete('view');
    setSearch(params, { replace: true });
  };

  // ------------------------------------------------ stages and tasks
  const addCard = useCallback(
    async (column: Column, title: string) => {
      try {
        await createCard(boardId, { column_id: column.id, title });
        refresh();
        notify(t('Added “{title}” to {column}', { title, column: column.name }));
      } catch (err) {
        fail(err, t('Could not add the task'));
      }
    },
    [boardId, refresh, fail, notify],
  );
  const changeColumn = useCallback(
    (column: Column, body: Partial<Column>) => {
      queryClient.setQueryData<BoardDetail>(kanbanKeys.board(boardId), (old) => (old ? { ...old, columns: old.columns.map((c) => (c.id === column.id ? { ...c, ...body } : c)) } : old));
      updateColumn(column.id, body)
        .then(refresh)
        .catch((err: unknown) => {
          fail(err, t('Could not save the change'));
          refresh();
        });
    },
    [queryClient, boardId, refresh, fail],
  );
  const moveColumn = useCallback(
    (column: Column, by: -1 | 1) => {
      const i = columns.findIndex((c) => c.id === column.id);
      const others = columns.filter((c) => c.id !== column.id);
      const at = i + by;
      changeColumn(column, { position: positionBetween(others[at - 1]?.position, others[at]?.position) });
    },
    [columns, changeColumn],
  );
  const removeColumn = useCallback(
    (column: Column) => {
      if (!window.confirm(t('Delete the stage “{name}”? It has no tasks; this cannot be undone.', { name: column.name }))) return;
      deleteColumn(column.id)
        .then(() => {
          refresh();
          notify(t('Deleted the stage “{name}”', { name: column.name }));
        })
        .catch((err: unknown) => fail(err, t('Could not delete the stage')));
    },
    [refresh, fail, notify],
  );
  const addColumn = async (name: string) => {
    try {
      await createColumn(boardId, { name });
      refresh();
      setTimeout(() => scroller.current?.scrollTo({ left: scroller.current.scrollWidth, behavior: 'smooth' }), 150);
    } catch (err) {
      fail(err, t('Could not add the stage'));
    }
  };

  // ------------------------------------------------ render
  if (boardQuery.isPending) return <BoardSkeleton />;
  if (boardQuery.isError || !detail) {
    return (
      <Box p={6} maxW="640px" mx="auto">
        <EmptyState icon={<KanbanIcon boxSize={7} />} title={t('Could not open the board')} text={apiErrorMessage(boardQuery.error, '')} action={t('All boards')} onAction={() => navigate('/kanban')} />
      </Box>
    );
  }

  const board = detail.board;
  const hex = colorHex(board.color);
  const memberNames = detail.members.map((m) => m.name ?? (m.user !== null && m.user !== undefined ? personName(m.user, detail.people) : groupName(m.group)));
  const dragged = drag ? cardsById.get(drag.id) : undefined;
  const draggedColumn = dragged ? columns.find((c) => c.id === findColumn(cardKey(dragged.id), items)) : undefined;
  const totalCards = Object.values(totals).reduce((a, b) => a + b, 0);
  const doneColumn = columns.find((c) => c.is_done) ?? columns[columns.length - 1];

  return (
    <Flex direction="column" h="100%" fontSize="md" data-testid="board-page" data-board-id={board.id}>
      <Box bgGradient={`linear(to-b, ${withAlpha(hex, 0.16)}, transparent)`} borderTop="4px solid" borderTopColor={hex} flexShrink={0}>
        <Flex align="center" gap={{ base: 2, md: 3 }} px={{ base: 3, md: 5 }} pt={3} pb={1.5} wrap="wrap">
          <Tooltip label={t('All boards')} hasArrow>
            <IconButton aria-label={t('All boards')} variant="ghost" icon={<ArrowLeftIcon boxSize={5} />} onClick={() => navigate('/kanban')} display={{ base: 'inline-flex', md: 'none' }} />
          </Tooltip>
          <Box minW={0} flex={{ base: 1, md: 'none' }}>
            <Heading as="h1" fontSize={{ base: 'xl', md: '2xl' }} letterSpacing="-0.02em" noOfLines={{ base: 2, md: 1 }} data-testid="board-title">
              {board.name}
            </Heading>
          </Box>
          {!canEdit && (
            <Tooltip label={board.archived ? t('The board is hidden: bring it back to change it.') : t('You can look at this board; only its members change it.')} hasArrow>
              <Badge display="flex" alignItems="center" gap={1.5} borderRadius="full" px={2.5} py={1} bg="chipBg" color="bodyText" textTransform="none" fontSize="sm" data-testid="read-only">
                <EyeIcon boxSize={4} />
                {board.archived ? t('Hidden') : t('View only')}
              </Badge>
            </Tooltip>
          )}
          <Tooltip label={live === 'live' ? t('Changes by others show up here at once') : t('Reconnecting…')} hasArrow>
            <HStack spacing={1.5} fontSize="sm" color={live === 'live' ? '#16a34a' : 'orange.500'} fontWeight={600} data-testid="live-state" data-state={live}>
              <Box w="9px" h="9px" borderRadius="full" bg="currentColor" boxShadow={live === 'live' ? '0 0 0 3px rgba(34,197,94,0.2)' : undefined} />
              <Text as="span" display={{ base: 'none', md: 'inline' }}>
                {live === 'live' ? t('Up to date') : t('Reconnecting…')}
              </Text>
            </HStack>
          </Tooltip>
          <Flex flex={1} justify="flex-end" align="center" gap={2}>
            <Box display={{ base: 'none', md: 'block' }}>
              <ViewSwitch view={view} onChange={setView} />
            </Box>
            <Tooltip label={t('Who works on this board')} hasArrow>
              <Button variant="ghost" onClick={() => setDialog('members')} data-testid="members-button" leftIcon={memberNames.length ? <AvatarStack names={memberNames} max={3} size="sm" /> : <UsersIcon boxSize={5} />} px={2}>
                <Text as="span" display={{ base: 'none', lg: 'inline' }}>
                  {t('Members')}
                </Text>
              </Button>
            </Tooltip>
            <Menu isLazy placement="bottom-end">
              <Tooltip label={t('Labels, board settings, hidden tasks')} hasArrow>
                <MenuButton as={Button} variant="subtle" leftIcon={<MoreIcon boxSize={4} />} data-testid="board-more">
                  {t('More')}
                </MenuButton>
              </Tooltip>
              <MenuList zIndex={1600} fontSize="md" minW="240px">
                <MenuItem icon={<TagIcon boxSize={4} />} onClick={() => setDialog('labels')} data-testid="labels-button">
                  {t('Labels')}
                </MenuItem>
                <MenuItem icon={<ArchiveIcon boxSize={4} />} onClick={() => setDialog('hidden')} data-testid="archived-cards">
                  {t('Hidden tasks')}
                </MenuItem>
                <MenuItem icon={<SettingsIcon boxSize={4} />} onClick={() => setDialog('settings')} data-testid="board-settings">
                  {t('Board name, colour, hide')}
                </MenuItem>
              </MenuList>
            </Menu>
          </Flex>
        </Flex>
        {board.description && (
          <Text px={{ base: 3, md: 5 }} color="mutedText" noOfLines={1} mb={1}>
            {board.description}
          </Text>
        )}
        <Box display={{ base: 'block', md: 'none' }} px={3} pb={1}>
          <ViewSwitch view={view} onChange={setView} wide />
        </Box>
        <FilterBar filter={filter} setFilter={setFilter} board={detail} me={me} />
      </Box>

      {view === 'board' && canEdit && totalCards === 0 && columns.length > 0 && <FirstSteps firstColumn={columns[0].name} doneColumn={doneColumn.name} />}

      {view === 'calendar' && (
        <Box flex={1} minH={0} pt={2}>
          <CalendarView
            cards={columns.flatMap((c) => (visible[c.id] ?? []).map((id) => cardsById.get(id)).filter((x): x is CardSummary => Boolean(x)))}
            columns={columns}
            today={today}
            canEdit={canEdit}
            onOpen={openCard}
            onSetDate={setDate}
          />
        </Box>
      )}
      {view === 'board' && (
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => setDrag(null)}
      >
        <StageTabs columns={columns} counts={totals} active={stage} dragging={drag !== null} onPick={showStage} />
        <Flex
          ref={scroller}
          onScroll={onScrollColumns}
          flex={1}
          minH={0}
          gap={3}
          align="flex-start"
          overflowX="auto"
          overflowY="hidden"
          px={{ base: 6, sm: 5 }}
          pt={2}
          pb={4}
          sx={{ scrollSnapType: drag ? 'none' : { base: 'x mandatory', sm: 'none' }, scrollPaddingInline: '24px', WebkitOverflowScrolling: 'touch' }}
          data-testid="board-columns"
        >
          {columns.map((column, i) => (
            <ColumnView
              key={column.id}
              column={column}
              index={i}
              columns={columns}
              ids={items[column.id] ?? []}
              cardsById={cardsById}
              total={totals[column.id] ?? 0}
              board={detail}
              today={today}
              canEdit={canEdit}
              onOpen={openCard}
              onMove={moveTo}
              onAdd={addCard}
              onChangeColumn={changeColumn}
              onMoveColumn={moveColumn}
              onDeleteColumn={removeColumn}
              onPhotoTask={photoTask}
            />
          ))}
          {canEdit && <AddColumn onAdd={addColumn} />}
          {!columns.length && !canEdit && <Text color="mutedText">{t('This board has no stages yet.')}</Text>}
          <Box w="1px" flexShrink={0} />
        </Flex>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {dragged ? (
            <Box w={{ base: 'calc(100vw - 64px)', sm: '300px' }}>
              <CardFace card={dragged} labels={detail.labels} people={detail.people} today={today} done={Boolean(draggedColumn?.is_done)} accent={draggedColumn?.color ?? board.color ?? 'indigo'} dragging />
            </Box>
          ) : null}
        </DragOverlay>
      </DndContext>
      )}

      {cardId !== null && (
        <CardDrawer
          key={cardId}
          cardId={cardId}
          detail={detail}
          columns={columns}
          canEdit={canEdit}
          canManage={canManage}
          onClose={() => navigate({ pathname: `/kanban/b/${boardId}`, search: boardSearch })}
          onChanged={refresh}
          onMove={moveTo}
        />
      )}
      {sheet !== null && cardsById.get(sheet) && (
        <MoveSheet
          card={cardsById.get(sheet)!}
          columns={columns}
          onClose={() => setSheet(null)}
          onOpen={() => {
            setSheet(null);
            navigate({ pathname: `/kanban/b/${boardId}/c/${sheet}`, search: boardSearch });
          }}
          onMove={(columnId) => {
            const card = cardsById.get(sheet)!;
            setSheet(null);
            moveTo(card, columnId);
            showStage(columns.findIndex((c) => c.id === columnId));
          }}
        />
      )}
      {dialog === 'members' && <MembersDialog detail={detail} canManage={canManage && !board.archived} onClose={() => setDialog(null)} onSaved={refresh} />}
      {dialog === 'labels' && <LabelsDialog boardId={boardId} labels={detail.labels} canEdit={canEdit} onClose={() => setDialog(null)} onChanged={refresh} />}
      {dialog === 'hidden' && <HiddenTasks boardId={boardId} onOpen={openCard} onClose={() => setDialog(null)} />}
      {dialog === 'settings' && (
        <BoardSettingsDialog
          board={board}
          canManage={canManage}
          onClose={() => setDialog(null)}
          onSaved={refresh}
          onArchived={() => {
            void queryClient.invalidateQueries({ queryKey: ['kanban', 'boards'] });
            notify(t('The board “{name}” is hidden. You find it under Hidden boards.', { name: board.name }));
            navigate('/kanban');
          }}
        />
      )}
    </Flex>
  );
}
