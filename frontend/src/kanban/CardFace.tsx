import { memo } from 'react';
import type { SyntheticEvent } from 'react';
import {
  Box, Button, Flex, HStack, Image, Menu, MenuButton, MenuItem, MenuList, Portal, Text,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { CheckIcon, ChevronDownIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';
import { useFileUrl } from './api';
import { CheckCircleIcon, ListChecksIcon, MessageIcon, PaperclipIcon, RepeatIcon } from './icons';
import { colorHex, personName, PRIORITY_COLOR, progressOf, progressText, repeatLabel } from './logic';
import { AvatarStack, DueChip, LabelChip, PriorityChip, ProgressBar } from './parts';
import type { CardSummary, Column, Label, Person } from './types';

export interface CardFaceProps {
  card: CardSummary;
  labels: Label[];
  people: Person[];
  today: string;
  done: boolean;
  accent: string;
  dragging?: boolean; // the copy under the pointer
  ghost?: boolean; // the place the card will land
  columns?: Column[]; // with onMove: the "Move to…" button
  onMove?: (card: CardSummary, columnId: number) => void;
}

function Cover({ url }: { url: string }) {
  const file = useFileUrl(url);
  if (!file.data) return <Box h="120px" bg="chipBg" />;
  return <Image src={file.data} alt="" h="120px" w="100%" objectFit="cover" draggable={false} />;
}

const keep = (e: SyntheticEvent) => e.stopPropagation(); // the button neither drags nor opens the task

/** "Move to…": the stages to choose from, for everyone who does not drag. */
function MoveTo({ card, columns, onMove }: { card: CardSummary; columns: Column[]; onMove: (card: CardSummary, columnId: number) => void }) {
  return (
    <Box onClick={keep} onMouseDown={keep} onTouchStart={keep} onKeyDown={keep} onPointerDown={keep}>
      <Menu isLazy placement="bottom-start">
        <Tooltip label={t('Move this task to another stage')} hasArrow openDelay={400}>
          <MenuButton as={Button} size="sm" variant="subtle" rightIcon={<ChevronDownIcon boxSize={4} />} fontWeight={600} data-testid="move-to">
            {t('Move to…')}
          </MenuButton>
        </Tooltip>
        <Portal>
          <MenuList zIndex={1600} minW="200px">
            {columns.map((c) => (
              <MenuItem key={c.id} onClick={() => onMove(card, c.id)} isDisabled={c.id === card.column_id} fontSize="md" data-testid="move-to-stage">
                <HStack spacing={2.5} w="100%">
                  <Box w="10px" h="10px" borderRadius="full" bg={colorHex(c.color, c.is_done ? '#22c55e' : '#94a3b8')} />
                  <Text as="span" flex={1}>
                    {c.name}
                  </Text>
                  {c.id === card.column_id && <CheckIcon boxSize={4} color="mutedText" />}
                </HStack>
              </MenuItem>
            ))}
          </MenuList>
        </Portal>
      </Menu>
    </Box>
  );
}

/** A task on the board: cover, labels, title, priority and due date in words, steps, counters, people, "Move to…". */
export const CardFace = memo(function CardFace({ card, labels, people, today, done, accent, dragging, ghost, columns, onMove }: CardFaceProps) {
  const cardLabels = labels.filter((l) => card.labels.includes(l.id));
  const progress = progressOf(card.checklist);
  const names = card.assignees.map((id) => personName(id, people));
  const urgent = card.priority === 'urgent' && !done;
  return (
    <Box
      bg="cardBg"
      borderRadius="xl"
      boxShadow={dragging ? 'cardDrag' : 'card'}
      border="1px solid"
      borderColor={urgent ? 'rgba(239,68,68,0.6)' : 'transparent'}
      overflow="hidden"
      opacity={ghost ? 0.35 : 1}
      transform={dragging ? 'rotate(2deg) scale(1.02)' : undefined}
      transition="box-shadow 0.15s ease, background 0.15s"
      _hover={dragging || ghost ? undefined : { boxShadow: 'cardHover', bg: 'cardHoverBg' }}
      cursor={dragging ? 'grabbing' : 'pointer'}
      position="relative"
      data-testid="card-face"
      data-card-id={card.id}
    >
      {card.cover && <Cover url={card.cover} />}
      <Box px={3.5} pt={3} pb={3}>
        {cardLabels.length > 0 && (
          <Flex gap={1} wrap="wrap" mb={2}>
            {cardLabels.map((l) => (
              <LabelChip key={l.id} label={l} />
            ))}
          </Flex>
        )}
        <HStack align="flex-start" spacing={2}>
          {done && (
            <Tooltip label={t('Done')} hasArrow>
              <Box color="#22c55e" mt="3px" flexShrink={0} lineHeight={0}>
                <CheckCircleIcon boxSize={5} />
              </Box>
            </Tooltip>
          )}
          <Text fontSize="17px" fontWeight={600} lineHeight="1.35" color={done ? 'mutedText' : 'bodyText'} sx={{ overflowWrap: 'anywhere' }} noOfLines={4}>
            {card.title}
          </Text>
        </HStack>

        {(card.priority !== 'normal' || card.due_date || card.repeat) && (
          <Flex gap={1.5} mt={2.5} wrap="wrap">
            {card.priority !== 'normal' && <PriorityChip priority={card.priority} />}
            {card.due_date && <DueChip due={card.due_date} today={today} done={done} />}
            {card.repeat && (
              <HStack spacing={1} px={2} py={0.5} borderRadius="md" bg="chipBg" fontSize="sm" fontWeight={600} color="mutedText" data-testid="repeat-chip">
                <RepeatIcon boxSize={3.5} />
                <Text as="span">{repeatLabel(card.repeat)}</Text>
              </HStack>
            )}
          </Flex>
        )}

        {progress.total > 0 && (
          <Box mt={3}>
            <HStack spacing={1.5} fontSize="sm" color={progress.percent === 100 ? '#16a34a' : 'mutedText'} fontWeight={600} mb={1.5}>
              <ListChecksIcon boxSize={4} />
              <Text as="span" data-testid="card-progress">
                {progressText(progress)}
              </Text>
            </HStack>
            <ProgressBar value={progress.percent} color={colorHex(accent)} h="6px" />
          </Box>
        )}

        {(card.comments > 0 || card.attachments > 0 || names.length > 0 || onMove) && (
          <Flex mt={3} align="center" justify="space-between" gap={2}>
            <HStack spacing={3} color="mutedText" fontSize="sm" fontWeight={600} minW={0}>
              {onMove && columns && <MoveTo card={card} columns={columns} onMove={onMove} />}
              {card.comments > 0 && (
                <Tooltip label={tn(card.comments, '{n} comment', '{n} comments')} hasArrow>
                  <HStack spacing={1}>
                    <MessageIcon boxSize={4} />
                    <Text as="span">{card.comments}</Text>
                  </HStack>
                </Tooltip>
              )}
              {card.attachments > 0 && (
                <Tooltip label={tn(card.attachments, '{n} photo or file', '{n} photos or files')} hasArrow>
                  <HStack spacing={1}>
                    <PaperclipIcon boxSize={4} />
                    <Text as="span">{card.attachments}</Text>
                  </HStack>
                </Tooltip>
              )}
            </HStack>
            <AvatarStack names={names} size="sm" />
          </Flex>
        )}
      </Box>
      {card.priority === 'high' && !done && <Box position="absolute" left={0} top={0} bottom={0} w="4px" bg={PRIORITY_COLOR.high} />}
    </Box>
  );
});
