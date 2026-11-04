/** Small building blocks of the Kanban pages: avatars, chips, progress bar, colour picker, empty state. */
import type { ReactNode } from 'react';
import {
  Avatar, Box, Button, Flex, HStack, Link, SimpleGrid, Text, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { CheckIcon, PlusIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { avatarColor, colorHex, dueState, dueText, PALETTE, PRIORITY_COLOR, priorityLabel, shortDate, withAlpha } from './logic';
import { ClockIcon, FlagIcon } from './icons';
import type { Label, Priority } from './types';

export function PersonAvatar({ name, size = 'xs' }: { name: string; size?: '2xs' | 'xs' | 'sm' | 'md' }) {
  return <Avatar size={size} name={name} bg={avatarColor(name)} color="white" fontWeight={700} />;
}

/** Overlapping avatars, "+3" when there are more than `max`. */
export function AvatarStack({ names, max = 3, size = 'xs' }: { names: string[]; max?: number; size?: '2xs' | 'xs' | 'sm' }) {
  if (!names.length) return null;
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <Tooltip label={names.join(', ')} hasArrow openDelay={300}>
      <HStack spacing={0} data-testid="avatar-stack">
        {shown.map((n, i) => (
          <Box key={n} ml={i ? '-6px' : 0} borderRadius="full" border="2px solid" borderColor="cardBg" lineHeight={0}>
            <PersonAvatar name={n} size={size} />
          </Box>
        ))}
        {rest > 0 && (
          <Flex ml="-6px" h={size === 'sm' ? '32px' : '24px'} minW={size === 'sm' ? '32px' : '24px'} px={1} align="center" justify="center" borderRadius="full" bg="chipBg" border="2px solid" borderColor="cardBg" fontSize="2xs" fontWeight={700} color="mutedText">
            +{rest}
          </Flex>
        )}
      </HStack>
    </Tooltip>
  );
}

export function PriorityChip({ priority }: { priority: Priority }) {
  const color = PRIORITY_COLOR[priority];
  return (
    <HStack spacing={1} px={2} py={0.5} borderRadius="md" bg={withAlpha(color, 0.14)} color={color} fontSize="sm" fontWeight={700} data-testid="priority-chip" title={t('Priority: {priority}', { priority: priorityLabel(priority) })}>
      <FlagIcon boxSize={3.5} />
      <Text as="span">{priorityLabel(priority)}</Text>
    </HStack>
  );
}

const DUE_COLORS = {
  overdue: '#dc2626',
  today: '#d97706',
  soon: '#d97706',
  later: '',
  done: '#16a34a',
};

export function DueChip({ due, today, done }: { due: string; today: string; done: boolean }) {
  const state = dueState(due, today, done) ?? 'later';
  const color = DUE_COLORS[state];
  return (
    <Tooltip label={t('Due date: {date}', { date: shortDate(due, today) })} hasArrow openDelay={300}>
      <HStack
        spacing={1}
        px={2}
        py={0.5}
        borderRadius="md"
        fontSize="sm"
        fontWeight={700}
        bg={color ? withAlpha(color, state === 'overdue' ? 1 : 0.14) : 'chipBg'}
        color={state === 'overdue' ? 'white' : color || 'mutedText'}
        data-testid="due-chip"
        data-state={state}
      >
        <ClockIcon boxSize={3.5} />
        <Text as="span">{dueText(due, today, done)}</Text>
      </HStack>
    </Tooltip>
  );
}

export function LabelChip({ label, small = false }: { label: Label; small?: boolean }) {
  const hex = colorHex(label.color);
  return (
    <Box
      as="span"
      display="inline-flex"
      alignItems="center"
      gap={1}
      px={small ? 2 : 2.5}
      py={small ? 0 : 0.5}
      borderRadius="full"
      bg={withAlpha(hex, 0.16)}
      color={hex}
      fontSize={small ? 'xs' : 'sm'}
      fontWeight={700}
      lineHeight="1.6"
      whiteSpace="nowrap"
      maxW="180px"
      overflow="hidden"
      textOverflow="ellipsis"
    >
      <Box as="span" w="6px" h="6px" borderRadius="full" bg={hex} flexShrink={0} />
      {label.name}
    </Box>
  );
}

export function ProgressBar({ value, color = '#6366f1', h = '6px' }: { value: number; color?: string; h?: string }) {
  const done = value >= 100;
  return (
    <Box h={h} borderRadius="full" bg="chipBg" overflow="hidden" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100}>
      <Box h="100%" w={`${Math.max(0, Math.min(100, value))}%`} borderRadius="full" bg={done ? '#22c55e' : color} transition="width 0.35s ease" />
    </Box>
  );
}

export function ColorPicker({ value, onChange }: { value: string | null; onChange: (name: string) => void }) {
  return (
    <SimpleGrid columns={6} spacing={2} role="radiogroup" aria-label={t('Colour')}>
      {PALETTE.map((p) => (
        <Box
          key={p.name}
          as="button"
          type="button"
          role="radio"
          aria-checked={value === p.name}
          aria-label={p.name}
          title={p.name}
          w="30px"
          h="30px"
          borderRadius="lg"
          bg={p.hex}
          display="flex"
          alignItems="center"
          justifyContent="center"
          color="white"
          boxShadow={value === p.name ? `0 0 0 2px var(--chakra-colors-panelBg), 0 0 0 4px ${p.hex}` : undefined}
          onClick={() => onChange(p.name)}
          _hover={{ transform: 'scale(1.08)' }}
          transition="transform 0.12s"
        >
          {value === p.name && <CheckIcon boxSize={4} />}
        </Box>
      ))}
    </SimpleGrid>
  );
}

/** An empty place with one thing to do. */
export function EmptyState({ icon, title, text, action, onAction, testId }: { icon: ReactNode; title: string; text?: string; action?: string; onAction?: () => void; testId?: string }) {
  return (
    <VStack spacing={3} py={12} px={6} textAlign="center" border="1px dashed" borderColor="lineColor" borderRadius="2xl" bg="panelBg" data-testid={testId}>
      <Flex w="56px" h="56px" align="center" justify="center" borderRadius="2xl" bg="rgba(99,102,241,0.12)" color="brand.400">
        {icon}
      </Flex>
      <Text fontWeight={700} fontSize="xl">
        {title}
      </Text>
      {text && (
        <Text color="mutedText" fontSize="md" maxW="460px">
          {text}
        </Text>
      )}
      {action && onAction && (
        <Button onClick={onAction} mt={1} size="lg" leftIcon={<PlusIcon boxSize={5} />}>
          {action}
        </Button>
      )}
    </VStack>
  );
}

/** Text exactly as it was typed: line breaks kept, web addresses clickable, no formatting codes. */
export function PlainText({ text }: { text: string }) {
  const parts = text.split(/(https?:\/\/[^\s<>"']+)/g);
  return (
    <Text as="div" whiteSpace="pre-wrap" overflowWrap="anywhere">
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <Link key={i} href={part} isExternal color="brand.500" _dark={{ color: 'brand.200' }} textDecoration="underline">
            {part}
          </Link>
        ) : (
          part
        ),
      )}
    </Text>
  );
}
