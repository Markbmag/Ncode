/** Ncode - Kanban on a phone (K2): the stage tabs over the board and the "Move to" sheet. */
import { Box, Button, Drawer, DrawerBody, DrawerContent, DrawerHeader, DrawerOverlay, Flex, Text, VStack } from '@chakra-ui/react';
import { useDroppable } from '@dnd-kit/core';
import { CheckIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { colorHex, tabKey, withAlpha } from './logic';
import type { CardSummary, Column } from './types';


function StageTab({ column, count, active, dragging, onPick }: { column: Column; count: number; active: boolean; dragging: boolean; onPick: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: tabKey(column.id), data: { type: 'tab' } });
  const accent = colorHex(column.color, column.is_done ? '#22c55e' : '#94a3b8');
  return (
    <Box
      ref={setNodeRef}
      as="button"
      type="button"
      onClick={onPick}
      flexShrink={0}
      minH="44px"
      px={3.5}
      borderRadius="xl"
      border="2px solid"
      borderColor={isOver ? accent : dragging ? withAlpha(accent, 0.6) : active ? withAlpha(accent, 0.9) : 'transparent'}
      borderStyle={dragging && !isOver ? 'dashed' : 'solid'}
      bg={isOver ? withAlpha(accent, 0.35) : active ? withAlpha(accent, 0.18) : 'chipBg'}
      fontWeight={active ? 700 : 600}
      fontSize="md"
      transition="background 0.15s, border-color 0.15s"
      aria-current={active ? 'true' : undefined}
      data-testid="stage-tab"
      data-column-name={column.name}
      data-active={active ? 'true' : 'false'}
    >
      <Flex align="center" gap={2}>
        {column.is_done ? <CheckIcon boxSize={4} color="#16a34a" /> : <Box w="8px" h="8px" borderRadius="full" bg={accent} />}
        <Text as="span" noOfLines={1} maxW="160px">
          {column.name}
        </Text>
        <Text as="span" color="mutedText" fontWeight={700}>
          {count}
        </Text>
      </Flex>
    </Box>
  );
}

/** One tab per stage on a phone: tap to go there; while a task is held, drop it on a tab to move it. */
export function StageTabs({ columns, counts, active, dragging, onPick }: { columns: Column[]; counts: Record<number, number>; active: number; dragging: boolean; onPick: (index: number) => void }) {
  if (columns.length < 2) return null;
  return (
    <Box display={{ base: 'block', sm: 'none' }} px={3} pt={1} flexShrink={0} data-testid="stage-tabs">
      <Flex gap={2} overflowX="auto" pb={1} sx={{ scrollbarWidth: 'none' }}>
        {columns.map((c, i) => (
          <StageTab key={c.id} column={c} count={counts[c.id] ?? 0} active={i === active} dragging={dragging} onPick={() => onPick(i)} />
        ))}
      </Flex>
      <Text fontSize="sm" color="mutedText" px={1} minH="20px" data-testid="stage-tabs-hint">
        {dragging ? t('Drop the task on a stage above to move it there') : t('Swipe sideways or tap a stage. Press and hold a task to move it.')}
      </Text>
    </Box>
  );
}

/** Press and hold a task, let go: big buttons for where it goes next. */
export function MoveSheet({ card, columns, onMove, onOpen, onClose }: { card: CardSummary; columns: Column[]; onMove: (columnId: number) => void; onOpen: () => void; onClose: () => void }) {
  return (
    <Drawer isOpen placement="bottom" onClose={onClose}>
      <DrawerOverlay bg="rgba(8,12,24,0.45)" />
      <DrawerContent borderTopRadius="2xl" pb="max(16px, env(safe-area-inset-bottom))" data-testid="move-sheet">
        <DrawerHeader pb={1}>
          <Text fontSize="sm" color="mutedText" fontWeight={600}>
            {t('Move to…')}
          </Text>
          <Text fontSize="lg" fontWeight={700} noOfLines={2}>
            {card.title}
          </Text>
        </DrawerHeader>
        <DrawerBody>
          <VStack align="stretch" spacing={2}>
            {columns.map((c) => {
              const here = c.id === card.column_id;
              const accent = colorHex(c.color, c.is_done ? '#22c55e' : '#94a3b8');
              return (
                <Button
                  key={c.id}
                  h="56px"
                  justifyContent="flex-start"
                  variant="subtle"
                  fontSize="lg"
                  isDisabled={here}
                  leftIcon={c.is_done ? <CheckIcon boxSize={5} color="#16a34a" /> : <Box w="12px" h="12px" borderRadius="full" bg={accent} />}
                  onClick={() => onMove(c.id)}
                  data-testid="move-sheet-stage"
                  data-column-name={c.name}
                >
                  {here ? t('{stage} (here now)', { stage: c.name }) : c.name}
                </Button>
              );
            })}
            <Button h="52px" variant="outline" fontSize="md" onClick={onOpen} data-testid="move-sheet-open">
              {t('Open the task')}
            </Button>
            <Button h="48px" variant="ghost" fontSize="md" onClick={onClose}>
              {t('Cancel')}
            </Button>
          </VStack>
        </DrawerBody>
      </DrawerContent>
    </Drawer>
  );
}
