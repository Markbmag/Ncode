/** A board's tasks on a calendar (K3): each task on its due date (else its start date). On a computer a
 * month grid where a task can be dragged to another day; on a phone a day-by-day list. */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, Button, Flex, Grid, HStack, IconButton, Modal, ModalBody, ModalCloseButton, ModalContent, ModalHeader, ModalOverlay, Text, useBreakpointValue, VStack } from '@chakra-ui/react';
import { DndContext, DragOverlay, MouseSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors } from '@dnd-kit/core';
import type { DragEndEvent, DragStartEvent } from '@dnd-kit/core';
import { CheckIcon, ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';
import { agenda, calendarDate, colorHex, dayTitle, isCardDone, monthGrid, monthTitle, PRIORITY_COLOR, shiftMonth, tasksByDate, weekdayNames, withAlpha } from './logic';
import type { CardSummary, Column } from './types';

const MAX_IN_CELL = 3;
interface Props {
  cards: CardSummary[];             // the board's tasks as filtered on the board
  columns: Column[];
  today: string;
  canEdit: boolean;
  onOpen: (id: number) => void;
  onSetDate: (card: CardSummary, date: string | null) => void;
}

function Chip({ card, column, today, done, onOpen, draggable, compact = true }: { card: CardSummary; column: Column | undefined; today: string; done: boolean; onOpen: () => void; draggable: boolean; compact?: boolean }) {
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({ id: `cal${card.id}`, disabled: !draggable });
  const late = !done && card.due_date !== null && card.due_date < today;
  const accent = colorHex(column?.color, column?.is_done ? '#22c55e' : '#94a3b8');
  return (
    <Box
      ref={setNodeRef}
      {...(draggable ? attributes : { role: 'button', tabIndex: 0 })}
      {...(draggable ? listeners : {})}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      opacity={isDragging ? 0.35 : 1}
      bg="cardBg"
      borderLeft="4px solid"
      borderLeftColor={late ? '#ef4444' : accent}
      borderRadius="md"
      px={2}
      py={compact ? 1 : 2}
      fontSize={compact ? 'sm' : 'md'}
      boxShadow="card"
      cursor="pointer"
      _hover={{ bg: 'cardHoverBg' }}
      sx={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', userSelect: 'none' }}
      data-testid="calendar-task"
      data-late={late ? 'true' : undefined}
      aria-label={t('Open the task {title}', { title: card.title })}
    >
      <HStack spacing={1.5} minW={0}>
        {done ? (
          <CheckIcon boxSize={3.5} color="#16a34a" flexShrink={0} />
        ) : (card.priority === 'urgent' || card.priority === 'high') ? (
          <Box w="7px" h="7px" borderRadius="full" bg={PRIORITY_COLOR[card.priority]} flexShrink={0} />
        ) : null}
        <Text noOfLines={2} color={late ? 'red.500' : done ? 'mutedText' : 'bodyText'} textDecoration={done ? 'line-through' : undefined} fontWeight={600}>
          {card.title}
        </Text>
      </HStack>
      {!compact && column && (
        <Text fontSize="sm" color="mutedText" mt={0.5}>
          {column.name}
          {late ? ` · ${t('late')}` : ''}
        </Text>
      )}
    </Box>
  );
}

function DayCell({ iso, inMonth, isToday, children, count, onMore }: { iso: string; inMonth: boolean; isToday: boolean; children: ReactNode; count: number; onMore: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `day${iso}` });
  return (
    <Flex
      ref={setNodeRef}
      direction="column"
      gap={1}
      p={1.5}
      minH="112px"
      bg={isOver ? 'dropBg' : inMonth ? 'columnBg' : 'transparent'}
      border="1px solid"
      borderColor={isToday ? 'brand.400' : 'lineColor'}
      borderRadius="lg"
      opacity={inMonth ? 1 : 0.55}
      data-testid="calendar-day"
      data-date={iso}
    >
      <Flex justify="space-between" align="center">
        <Text fontSize="sm" fontWeight={isToday ? 800 : 600} color={isToday ? 'white' : 'mutedText'} bg={isToday ? 'brand.500' : undefined} borderRadius="full" minW="24px" textAlign="center" px={isToday ? 1.5 : 0}>
          {Number(iso.slice(8))}
        </Text>
      </Flex>
      {children}
      {count > MAX_IN_CELL && (
        <Button size="xs" variant="ghost" onClick={onMore} data-testid="calendar-more">
          {tn(count - MAX_IN_CELL, '+{n} more', '+{n} more')}
        </Button>
      )}
    </Flex>
  );
}

function NoDate({ children, count }: { children: ReactNode; count: number }) {
  const { setNodeRef, isOver } = useDroppable({ id: 'nodate' });
  return (
    <Box ref={setNodeRef} bg={isOver ? 'dropBg' : 'columnBg'} borderRadius="xl" p={3} data-testid="calendar-no-date">
      <Text fontWeight={700} mb={1}>
        {t('No date')} <Text as="span" color="mutedText">{count}</Text>
      </Text>
      <Text fontSize="sm" color="mutedText" mb={2}>
        {t('Drag a task onto a day to give it a due date.')}
      </Text>
      <VStack align="stretch" spacing={1.5}>
        {children}
      </VStack>
    </Box>
  );
}

export function CalendarView({ cards, columns, today, canEdit, onOpen, onSetDate }: Props) {
  const phone = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false;
  const [shown, setShown] = useState(() => ({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 }));
  const [dayList, setDayList] = useState<string | null>(null);
  const [dragging, setDragging] = useState<CardSummary | null>(null);
  const byColumn = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns]);
  const doneColumns = useMemo(() => new Set(columns.filter((c) => c.is_done).map((c) => c.id)), [columns]);
  const isDone = (c: CardSummary) => isCardDone(c, doneColumns);
  const byDate = useMemo(() => tasksByDate(cards), [cards]);
  const undated = cards.filter((c) => !calendarDate(c) && !isCardDone(c, doneColumns));
  const weeks = monthGrid(shown.year, shown.month);
  const sensors = useSensors(useSensor(MouseSensor, { activationConstraint: { distance: 5 } }), useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 8 } }));
  const go = (by: number) => setShown((s) => shiftMonth(s.year, s.month, by));
  const thisMonth = shown.year === Number(today.slice(0, 4)) && shown.month === Number(today.slice(5, 7)) - 1;

  const onDragStart = ({ active }: DragStartEvent) => setDragging(cards.find((c) => `cal${c.id}` === active.id) ?? null);
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setDragging(null);
    const card = cards.find((c) => `cal${c.id}` === active.id);
    if (!card || !over) return;
    const target = over.id === 'nodate' ? null : String(over.id).replace(/^day/, '');
    if (target === calendarDate(card) || (target === null && !calendarDate(card))) return;
    onSetDate(card, target);
  };

  const header = (
    <Flex align="center" gap={2} mb={3} wrap="wrap">
      <IconButton aria-label={t('Previous month')} icon={<ChevronLeftIcon boxSize={5} />} variant="subtle" onClick={() => go(-1)} data-testid="calendar-prev" />
      <Text fontSize="xl" fontWeight={750} minW="190px" textAlign="center" data-testid="calendar-month">
        {monthTitle(shown.year, shown.month)}
      </Text>
      <IconButton aria-label={t('Next month')} icon={<ChevronRightIcon boxSize={5} />} variant="subtle" onClick={() => go(1)} data-testid="calendar-next" />
      {!thisMonth && (
        <Button variant="ghost" onClick={() => setShown({ year: Number(today.slice(0, 4)), month: Number(today.slice(5, 7)) - 1 })} data-testid="calendar-today">
          {t('Today')}
        </Button>
      )}
    </Flex>
  );

  if (phone) {
    const days = agenda(cards, shown.year, shown.month, today, isDone);
    return (
      <DndContext key="phone">
      <Box px={3} pb={6} overflowY="auto" h="100%" data-testid="calendar">
        {header}
        <VStack align="stretch" spacing={4}>
          {days.map((day) => (
            <Box key={day.date ?? 'late'} data-testid="agenda-day" data-date={day.date ?? 'late'}>
              <Text fontWeight={700} mb={1.5} color={day.date === null ? 'red.500' : day.date === today ? 'brand.500' : 'bodyText'}>
                {day.date === null ? t('Late') : day.date === today ? `${t('Today')} · ${dayTitle(day.date)}` : dayTitle(day.date)}
              </Text>
              <VStack align="stretch" spacing={2}>
                {day.cards.length ? (
                  day.cards.map((c) => <Chip key={c.id} card={c} column={byColumn.get(c.column_id)} today={today} done={isDone(c)} onOpen={() => onOpen(c.id)} draggable={false} compact={false} />)
                ) : (
                  <Text color="mutedText">{t('Nothing due.')}</Text>
                )}
              </VStack>
            </Box>
          ))}
          {!days.length && <Text color="mutedText">{t('No tasks with a date this month.')}</Text>}
          {undated.length > 0 && (
            <Box data-testid="calendar-no-date">
              <Text fontWeight={700} mb={1.5}>
                {t('No date')} <Text as="span" color="mutedText">{undated.length}</Text>
              </Text>
              <VStack align="stretch" spacing={2}>
                {undated.map((c) => <Chip key={c.id} card={c} column={byColumn.get(c.column_id)} today={today} done={false} onOpen={() => onOpen(c.id)} draggable={false} compact={false} />)}
              </VStack>
            </Box>
          )}
        </VStack>
      </Box>
      </DndContext>
    );
  }

  const listed = dayList ? byDate.get(dayList) ?? [] : [];
  return (
    <DndContext key="grid" sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setDragging(null)}>
      <Flex gap={4} px={5} pb={5} h="100%" overflow="auto" align="flex-start" data-testid="calendar">
        <Box flex={1} minW="640px">
          {header}
          <Grid templateColumns="repeat(7, minmax(0, 1fr))" gap={1.5} mb={1.5}>
            {weekdayNames().map((w) => (
              <Text key={w} fontSize="sm" fontWeight={700} color="mutedText" textAlign="center">
                {w}
              </Text>
            ))}
          </Grid>
          <Grid templateColumns="repeat(7, minmax(0, 1fr))" gap={1.5}>
            {weeks.flat().map((iso) => {
              const list = byDate.get(iso) ?? [];
              return (
                <DayCell key={iso} iso={iso} inMonth={Number(iso.slice(5, 7)) - 1 === shown.month} isToday={iso === today} count={list.length} onMore={() => setDayList(iso)}>
                  {list.slice(0, MAX_IN_CELL).map((c) => (
                    <Chip key={c.id} card={c} column={byColumn.get(c.column_id)} today={today} done={isDone(c)} onOpen={() => onOpen(c.id)} draggable={canEdit} />
                  ))}
                </DayCell>
              );
            })}
          </Grid>
          {canEdit && (
            <Text fontSize="sm" color="mutedText" mt={2}>
              {t('Drag a task to another day to change its due date.')}
            </Text>
          )}
        </Box>
        <Box w="260px" flexShrink={0} pt="52px">
          <NoDate count={undated.length}>
            {undated.map((c) => (
              <Chip key={c.id} card={c} column={byColumn.get(c.column_id)} today={today} done={false} onOpen={() => onOpen(c.id)} draggable={canEdit} />
            ))}
            {!undated.length && <Text fontSize="sm" color="mutedText">{t('Every open task has a date.')}</Text>}
          </NoDate>
        </Box>
      </Flex>
      <DragOverlay dropAnimation={{ duration: 150, easing: 'ease-out' }}>
        {dragging ? (
          <Box w="180px" bg="cardBg" borderRadius="md" px={2} py={1} boxShadow="xl" fontSize="sm" fontWeight={600} borderLeft="4px solid" borderLeftColor={withAlpha('#6366f1', 0.9)}>
            <Text noOfLines={1}>{dragging.title}</Text>
          </Box>
        ) : null}
      </DragOverlay>
      {dayList && (
        <Modal isOpen onClose={() => setDayList(null)} size="md">
          <ModalOverlay />
          <ModalContent mx={3}>
            <ModalHeader>{dayTitle(dayList)}</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={5}>
              <VStack align="stretch" spacing={2}>
                {listed.map((c) => (
                  <Chip key={c.id} card={c} column={byColumn.get(c.column_id)} today={today} done={isDone(c)} onOpen={() => { setDayList(null); onOpen(c.id); }} draggable={false} compact={false} />
                ))}
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </DndContext>
  );
}
