/** A board's tasks on a timeline (K4): one row per task with a bar from its start to its due date, six
 * weeks at a time. Drag a bar to move both dates, or its ends to change one; a tap opens the task. */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Box, Button, Flex, IconButton, Text, useBreakpointValue } from '@chakra-ui/react';
import { ChevronLeftIcon, ChevronRightIcon } from '../icons';
import { locale, t, tn } from '../i18n/index.ts';
import { barOf, colorHex, isCardDone, movedDates, timelineDays, withAlpha } from './logic';
import type { CardSummary, Column } from './types';

interface Props {
  cards: CardSummary[];
  columns: Column[];
  today: string;
  canEdit: boolean;
  onOpen: (id: number) => void;
  onSetDates: (card: CardSummary, dates: { start_date: string | null; due_date: string | null }) => void;
}

type Part = 'bar' | 'start' | 'end';
const ROW_H = 40;
const asDate = (iso: string) => new Date(`${iso}T12:00:00`);
const fmt = (iso: string, opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), opts).format(asDate(iso)).replace('.', '');

export function TimelineView({ cards, columns, today, canEdit, onOpen, onSetDates }: Props) {
  const phone = useBreakpointValue({ base: true, md: false }, { ssr: false }) ?? false;
  const DAY_W = phone ? 30 : 34;
  const LABEL_W = phone ? 132 : 240;
  const [offset, setOffset] = useState(0);
  const days = useMemo(() => timelineDays(today, offset), [today, offset]);
  const doneColumns = useMemo(() => new Set(columns.filter((c) => c.is_done).map((c) => c.id)), [columns]);
  const drag = useRef<{ id: number; part: Part; x: number; moved: boolean } | null>(null);
  const [shift, setShift] = useState<{ id: number; part: Part; days: number } | null>(null);

  const groups = columns.map((col) => ({
    col,
    rows: cards
      .filter((c) => c.column_id === col.id)
      .map((c) => ({ card: c, bar: barOf(c, days) }))
      .filter((r): r is { card: CardSummary; bar: NonNullable<ReturnType<typeof barOf>> } => r.bar !== null)
      .sort((a, b) => a.bar.from - b.bar.from || a.bar.to - b.bar.to || a.card.id - b.card.id),
  })).filter((g) => g.rows.length);
  const shown = groups.reduce((n, g) => n + g.rows.length, 0);
  const undated = cards.filter((c) => !c.start_date && !c.due_date).length;
  const outside = cards.length - shown - undated;
  const todayIndex = days.indexOf(today);
  // open with today near the left edge (the week before stays one swipe away)
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scroller.current) scroller.current.scrollLeft = todayIndex >= 0 ? Math.max(0, (todayIndex - 2) * DAY_W) : 0;
  }, [todayIndex, DAY_W]);

  const down = (e: ReactPointerEvent, card: CardSummary, part: Part) => {
    if (!canEdit) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { id: card.id, part, x: e.clientX, moved: false };
  };
  const move = (e: ReactPointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    setShift({ id: d.id, part: d.part, days: Math.round(dx / DAY_W) });
  };
  const up = (card: CardSummary) => {
    const d = drag.current;
    drag.current = null;
    const by = shift?.id === card.id ? shift.days : 0;
    setShift(null);
    if (!d || !d.moved) {
      onOpen(card.id);
      return;
    }
    if (by) onSetDates(card, movedDates(card, by, d.part));
  };

  const weeks = Array.from({ length: days.length / 7 }, (_, i) => days[i * 7]);
  const range = `${fmt(days[0], { day: 'numeric', month: 'short' })} – ${fmt(days[days.length - 1], { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <Flex direction="column" h="100%" px={{ base: 3, md: 5 }} pb={4} data-testid="timeline">
      <Flex align="center" gap={2} mb={3} wrap="wrap">
        <IconButton aria-label={t('Earlier')} icon={<ChevronLeftIcon boxSize={5} />} variant="subtle" onClick={() => setOffset((o) => o - 2)} data-testid="timeline-prev" />
        <Text fontSize="lg" fontWeight={750} minW="200px" textAlign="center" data-testid="timeline-range">
          {range}
        </Text>
        <IconButton aria-label={t('Later')} icon={<ChevronRightIcon boxSize={5} />} variant="subtle" onClick={() => setOffset((o) => o + 2)} data-testid="timeline-next" />
        {offset !== 0 && (
          <Button variant="ghost" onClick={() => setOffset(0)} data-testid="timeline-today">
            {t('Today')}
          </Button>
        )}
        <Text fontSize="sm" color="mutedText" ml={{ base: 0, md: 'auto' }}>
          {canEdit ? t('Drag a bar to move the dates; drag its ends to change the start or the due date.') : ''}
        </Text>
      </Flex>

      <Box ref={scroller} flex={1} minH={0} overflow="auto" border="1px solid" borderColor="lineColor" borderRadius="xl" bg="columnBg" data-testid="timeline-scroll">
        <Box position="relative" w={`${LABEL_W + days.length * DAY_W}px`} minH="100%">
          {/* header: weeks and days */}
          <Flex position="sticky" top={0} zIndex={3} bg="panelBg" borderBottom="1px solid" borderColor="lineColor">
            <Box w={`${LABEL_W}px`} flexShrink={0} position="sticky" left={0} zIndex={4} bg="panelBg" borderRight="1px solid" borderColor="lineColor" px={3} py={2}>
              <Text fontSize="sm" fontWeight={700} color="mutedText">
                {t('Task')}
              </Text>
            </Box>
            <Box>
              <Flex>
                {weeks.map((w) => (
                  <Text key={w} w={`${7 * DAY_W}px`} fontSize="xs" fontWeight={700} color="mutedText" px={1.5} pt={1} borderLeft="1px solid" borderColor="lineColor" noOfLines={1}>
                    {fmt(w, { day: 'numeric', month: 'short' })}
                  </Text>
                ))}
              </Flex>
              <Flex>
                {days.map((d, i) => {
                  const weekend = i % 7 >= 5;
                  return (
                    <Text key={d} w={`${DAY_W}px`} textAlign="center" fontSize="xs" py={1} color={d === today ? 'white' : weekend ? 'faintText' : 'mutedText'} bg={d === today ? 'brand.500' : undefined} borderRadius={d === today ? 'md' : undefined} fontWeight={d === today ? 800 : 500}>
                      {Number(d.slice(8))}
                    </Text>
                  );
                })}
              </Flex>
            </Box>
          </Flex>

          {/* weekends and today, behind the bars */}
          <Box position="absolute" top={0} bottom={0} left={`${LABEL_W}px`} pointerEvents="none" zIndex={0}>
            {days.map((d, i) => (i % 7 >= 5 ? <Box key={d} position="absolute" top={0} bottom={0} left={`${i * DAY_W}px`} w={`${DAY_W}px`} bg="rgba(127,127,127,0.07)" /> : null))}
            {todayIndex >= 0 && <Box position="absolute" top={0} bottom={0} left={`${todayIndex * DAY_W + DAY_W / 2}px`} w="2px" bg="brand.400" opacity={0.7} data-testid="timeline-now" />}
          </Box>

          {groups.map(({ col, rows }) => {
            const accent = colorHex(col.color, col.is_done ? '#22c55e' : '#94a3b8');
            return (
              <Box key={col.id} position="relative" zIndex={1}>
                <Flex h="30px" align="center" position="sticky" left={0} w={`${LABEL_W}px`} px={3} gap={2} bg="columnBg">
                  <Box w="9px" h="9px" borderRadius="full" bg={accent} />
                  <Text fontSize="sm" fontWeight={700} noOfLines={1}>
                    {col.name} <Text as="span" color="mutedText">{rows.length}</Text>
                  </Text>
                </Flex>
                {rows.map(({ card, bar }) => {
                  const done = isCardDone(card, doneColumns);
                  const late = !done && card.due_date !== null && card.due_date < today;
                  const s = shift?.id === card.id ? shift : null;
                  const from = bar.from + (s && (s.part === 'bar' || s.part === 'start') ? s.days : 0);
                  const to = bar.to + (s && (s.part === 'bar' || s.part === 'end') ? s.days : 0);
                  const left = Math.min(from, to);
                  const width = (Math.max(from, to) - left + 1) * DAY_W - 4;
                  const color = late ? '#ef4444' : done ? '#94a3b8' : accent;
                  return (
                    <Flex key={card.id} h={`${ROW_H}px`} align="center" borderTop="1px solid" borderColor="lineColor" data-testid="timeline-row" data-title={card.title}>
                      <Box
                        as="button"
                        type="button"
                        onClick={() => onOpen(card.id)}
                        w={`${LABEL_W}px`}
                        flexShrink={0}
                        h="100%"
                        position="sticky"
                        left={0}
                        zIndex={2}
                        bg="columnBg"
                        borderRight="1px solid"
                        borderColor="lineColor"
                        px={3}
                        textAlign="left"
                        _hover={{ bg: 'panelHover' }}
                      >
                        <Text fontSize="sm" fontWeight={600} noOfLines={1} color={done ? 'mutedText' : 'bodyText'} textDecoration={done ? 'line-through' : undefined}>
                          {card.title}
                        </Text>
                      </Box>
                      <Box position="relative" h="100%" flex={1}>
                        <Flex
                          position="absolute"
                          top="7px"
                          h={`${ROW_H - 14}px`}
                          left={`${left * DAY_W + 2}px`}
                          w={`${width}px`}
                          align="center"
                          bg={withAlpha(color, done ? 0.35 : 0.85)}
                          borderRadius="md"
                          borderLeftRadius={bar.cutStart ? 0 : 'md'}
                          borderRightRadius={bar.cutEnd ? 0 : 'md'}
                          color="white"
                          fontSize="xs"
                          fontWeight={700}
                          px={2}
                          cursor={canEdit ? 'grab' : 'pointer'}
                          boxShadow={s ? 'lg' : undefined}
                          sx={{ touchAction: canEdit ? 'none' : 'auto', userSelect: 'none' }}
                          onPointerDown={(e) => down(e, card, 'bar')}
                          onPointerMove={move}
                          onPointerUp={() => up(card)}
                          onKeyDown={(e) => e.key === 'Enter' && onOpen(card.id)}
                          tabIndex={0}
                          role="button"
                          aria-label={t('Open the task {title}', { title: card.title })}
                          data-testid="timeline-bar"
                          data-from={from}
                          data-to={to}
                        >
                          {canEdit && !bar.cutStart && (
                            <Box position="absolute" left={0} top={0} bottom={0} w="10px" cursor="ew-resize" onPointerDown={(e) => down(e, card, 'start')} onPointerMove={(e) => { e.stopPropagation(); move(e); }} onPointerUp={(e) => { e.stopPropagation(); up(card); }} data-testid="timeline-start" />
                          )}
                          <Text noOfLines={1} pointerEvents="none">
                            {width > 70 ? card.title : ''}
                          </Text>
                          {canEdit && !bar.cutEnd && (
                            <Box position="absolute" right={0} top={0} bottom={0} w="10px" cursor="ew-resize" onPointerDown={(e) => down(e, card, 'end')} onPointerMove={(e) => { e.stopPropagation(); move(e); }} onPointerUp={(e) => { e.stopPropagation(); up(card); }} data-testid="timeline-end" />
                          )}
                        </Flex>
                      </Box>
                    </Flex>
                  );
                })}
              </Box>
            );
          })}
          {!shown && (
            <Text p={6} color="mutedText" position="sticky" left={0}>
              {t('No task has a date in these weeks.')}
            </Text>
          )}
        </Box>
      </Box>
      {(outside > 0 || undated > 0) && (
        <Text fontSize="sm" color="mutedText" mt={2} data-testid="timeline-hidden">
          {[outside > 0 ? tn(outside, '{n} task has dates in other weeks', '{n} tasks have dates in other weeks') : '', undated > 0 ? tn(undated, '{n} task has no date', '{n} tasks have no date') : '']
            .filter(Boolean)
            .join(' · ')}
        </Text>
      )}
    </Flex>
  );
}
