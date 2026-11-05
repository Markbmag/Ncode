import { useState } from 'react';
import {
  Badge, Box, Button, Flex, Heading, HStack, SimpleGrid, Skeleton, Tab, TabList, Tabs, Text, useToast, VStack,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { ArchiveIcon, LockIcon, PlusIcon, RefreshIcon, TrashIcon, UsersIcon } from '../icons';
import { t, tn } from '../i18n/index.ts';
import { useWorkspace } from '../workspace/useWorkspace';
import { deleteBoard, kanbanKeys, updateBoard, useBoards, useMyTasks } from './api';
import { CreateBoardDialog } from './dialogs';
import { KanbanIcon, UserIcon } from './icons';
import { boardProgress, colorHex, personName, timeAgo, todayIso, withAlpha } from './logic';
import { EmptyState, ProgressBar } from './parts';
import type { BoardSummary } from './types';

function BoardTile({ board }: { board: BoardSummary }) {
  const hex = colorHex(board.color);
  const progress = boardProgress(board);
  return (
    <Box
      as={RouterLink}
      to={`/kanban/b/${board.id}`}
      display="block"
      position="relative"
      bg="panelBg"
      borderRadius="2xl"
      border="1px solid"
      borderColor="lineColor"
      overflow="hidden"
      boxShadow="card"
      transition="transform 0.15s ease, box-shadow 0.15s ease"
      _hover={{ transform: 'translateY(-3px)', boxShadow: 'cardHover', textDecoration: 'none' }}
      data-testid="board-tile"
    >
      <Box h="56px" bgGradient={`linear(135deg, ${hex}, ${withAlpha(hex, 0.55)})`} position="relative">
        <Box position="absolute" inset={0} opacity={0.25} bgImage="radial-gradient(circle at 85% 20%, rgba(255,255,255,0.9) 0, transparent 40%)" />
        {board.private && (
          <Badge position="absolute" top={3} left={3} bg="rgba(0,0,0,0.28)" color="white" borderRadius="full" px={2} textTransform="none" fontWeight={700} display="flex" alignItems="center" gap={1} data-testid="board-tile-private">
            <LockIcon boxSize={3} />
            {t('Members only')}
          </Badge>
        )}
        {board.role && (
          <Badge position="absolute" top={3} right={3} bg="rgba(255,255,255,0.22)" color="white" borderRadius="full" px={2} textTransform="none" fontWeight={700}>
            {board.role === 'owner' ? t('You own it') : t('You are a member')}
          </Badge>
        )}
      </Box>
      <Box p={4} pt={3}>
        <Text fontWeight={700} fontSize="18px" noOfLines={1}>
          {board.name}
        </Text>
        <Text color="mutedText" noOfLines={2} minH="3em" mt={0.5}>
          {board.description || t('No description')}
        </Text>
        <Box mt={3}>
          <Text fontWeight={600} mb={1.5} fontSize="sm" data-testid="board-counts">
            {tn(board.cards_open + board.cards_done, '{n} task', '{n} tasks')} · {tn(board.cards_open, '{n} still to do', '{n} still to do')} · {tn(board.cards_done, '{n} done', '{n} done')}
          </Text>
          <ProgressBar value={progress.percent} color={hex} h="8px" />
        </Box>
        <Flex mt={3} justify="space-between" align="center" fontSize="sm" color="mutedText" gap={2}>
          <HStack spacing={1.5} minW={0}>
            <UsersIcon boxSize={4} flexShrink={0} />
            <Text as="span" noOfLines={1}>
              {(() => {
                // names in words: "carol, alice and 2 others"
                const names = board.member_names?.length ? board.member_names : [personName(board.owner)];
                const shown = names.slice(0, 2).join(', ');
                const rest = Math.max(board.members_count, names.length) - Math.min(names.length, 2);
                return rest > 0 ? tn(rest, '{owner} and {n} other', '{owner} and {n} others', { owner: shown }) : shown;
              })()}
            </Text>
          </HStack>
          <Tooltip label={t('Last change')} hasArrow openDelay={300}>
            <Text as="span" flexShrink={0}>
              {timeAgo(board.updated_at)}
            </Text>
          </Tooltip>
        </Flex>
      </Box>
    </Box>
  );
}

function ArchivedRow({ board }: { board: BoardSummary }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { isAdmin } = useWorkspace();
  const [busy, setBusy] = useState(false);
  const canManage = board.can_manage ?? (isAdmin || board.role === 'owner');
  const run = async (what: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await what();
      await queryClient.invalidateQueries({ queryKey: ['kanban', 'boards'] });
    } catch (err) {
      toast({ status: 'error', title: apiErrorMessage(err, t('Could not save the change')) });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flex align="center" gap={3} p={3} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" data-testid="archived-board">
      <Box w="10px" alignSelf="stretch" borderRadius="full" bg={colorHex(board.color)} />
      <Box flex={1} minW={0}>
        <Text fontWeight={600} noOfLines={1}>
          {board.name}
        </Text>
        <Text fontSize="xs" color="mutedText">
          {t('Hidden {when}', { when: timeAgo(board.updated_at) })}
        </Text>
      </Box>
      {canManage && (
        <>
          <Button variant="subtle" leftIcon={<RefreshIcon boxSize={4} />} isLoading={busy} onClick={() => void run(() => updateBoard(board.id, { archived: false }))}>
            {t('Bring back')}
          </Button>
          <Button
            variant="ghost"
            colorScheme="red"
            leftIcon={<TrashIcon boxSize={4} />}
            isDisabled={busy}
            onClick={() => {
              if (window.confirm(t('Delete the board “{name}” for good, with all its tasks, photos and files? This cannot be undone.', { name: board.name }))) void run(() => deleteBoard(board.id));
            }}
          >
            {t('Delete for good')}
          </Button>
        </>
      )}
    </Flex>
  );
}

/** "My tasks · 3 late" (K3): the way to everything assigned to me. */
function MyTasksButton() {
  const my = useMyTasks();
  const today = todayIso();
  const open = (my.data?.cards ?? []).filter((c) => c.completed_at === null);
  const late = open.filter((c) => c.due_date !== null && c.due_date < today).length;
  return (
    <Button as={RouterLink} to="/kanban/my" size="lg" h="52px" px={6} fontSize="lg" variant="subtle" leftIcon={<UserIcon boxSize={5} />} data-testid="my-tasks-button">
      {t('My tasks')}
      {open.length > 0 && (
        <Text as="span" ml={2} px={2} borderRadius="full" fontSize="sm" fontWeight={800} bg={late ? 'red.500' : 'chipBg'} color={late ? 'white' : 'bodyText'} data-testid="my-tasks-count">
          {late ? tn(late, '{n} late', '{n} late') : open.length}
        </Text>
      )}
    </Button>
  );
}

export default function BoardsPage() {
  const [params] = useSearchParams();
  const q = (params.get('q') ?? '').trim().toLocaleLowerCase();
  const [tab, setTab] = useState(0);
  const archived = tab === 1;
  const boards = useBoards(archived);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const shown = (boards.data ?? []).filter((b) => !q || `${b.name} ${b.description ?? ''}`.toLocaleLowerCase().includes(q));
  const { isAdmin } = useWorkspace();
  const writable = (b: BoardSummary) => Boolean(b.can_edit ?? (isAdmin || b.role));
  const mine = shown.filter((b) => b.role);
  const others = shown.filter((b) => !b.role);

  const grid = (list: BoardSummary[]) => (
    <SimpleGrid columns={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing={4}>
      {list.map((b) => (
        <BoardTile key={b.id} board={b} />
      ))}
    </SimpleGrid>
  );

  return (
    <Box h="100%" overflowY="auto">
      <Box maxW="1280px" mx="auto" px={{ base: 4, md: 8 }} py={{ base: 5, md: 8 }}>
        <Flex align={{ base: 'stretch', md: 'center' }} justify="space-between" gap={4} direction={{ base: 'column', md: 'row' }} mb={6} p={{ base: 4, md: 6 }} bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="2xl" boxShadow="card">
          <Box>
            <Heading as="h1" fontSize={{ base: '2xl', md: '3xl' }} letterSpacing="-0.02em">
              {t('Boards')}
            </Heading>
            <Text color="mutedText" fontSize="md" mt={1} maxW="640px">
              {t('A board is a shared to-do list for a team: each task moves from To do to In progress to Done. Everyone can look at every board; its members change it.')}
            </Text>
          </Box>
          <Flex gap={3} direction={{ base: 'column', sm: 'row' }} flexShrink={0}>
            <MyTasksButton />
            <Button size="lg" h="52px" px={7} fontSize="lg" leftIcon={<PlusIcon boxSize={5} />} onClick={() => setCreating(true)} data-testid="new-board">
              {t('New board')}
            </Button>
          </Flex>
        </Flex>

        <Tabs index={tab} onChange={setTab} variant="soft-rounded" colorScheme="brand" size="md" mb={5}>
          <TabList gap={1}>
            <Tab>{t('Boards in use')}</Tab>
            <Tab data-testid="archived-tab">
              <HStack spacing={1.5}>
                <ArchiveIcon boxSize={4} />
                <Text as="span">{t('Hidden boards')}</Text>
              </HStack>
            </Tab>
          </TabList>
        </Tabs>

        {boards.isPending && boards.fetchStatus === 'paused' ? (
          <EmptyState icon={<KanbanIcon boxSize={7} />} title={t('No connection')} text={t('The boards were not opened on this device before, so they are not kept here. They show once the connection is back.')} testId="boards-offline" />
        ) : boards.isPending ? (
          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3, xl: 4 }} spacing={4}>
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} h="210px" borderRadius="2xl" />
            ))}
          </SimpleGrid>
        ) : boards.isError && !boards.data ? (
          <EmptyState icon={<KanbanIcon boxSize={7} />} title={t('Could not load the boards')} text={apiErrorMessage(boards.error, '')} action={t('Try again')} onAction={() => void boards.refetch()} />
        ) : archived ? (
          shown.length ? (
            <VStack align="stretch" spacing={2}>
              {shown.map((b) => (
                <ArchivedRow key={b.id} board={b} />
              ))}
            </VStack>
          ) : (
            <EmptyState icon={<ArchiveIcon boxSize={7} />} title={t('No hidden boards')} text={t('A board you hide waits here; you can bring it back at any time.')} />
          )
        ) : !boards.data?.length ? (
          <EmptyState
            icon={<KanbanIcon boxSize={7} />}
            title={t('No boards yet')}
            text={t('A board holds the team’s tasks in stages: To do, In progress, Done.')}
            action={t('Create the first board')}
            onAction={() => setCreating(true)}
            testId="boards-empty"
          />
        ) : !shown.length ? (
          <Text color="mutedText">{t('No board matches “{q}”.', { q: params.get('q') ?? '' })}</Text>
        ) : (
          <VStack align="stretch" spacing={8}>
            {mine.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight={700} color="mutedText" textTransform="uppercase" letterSpacing="0.06em" mb={3}>
                  {t('Your boards')}
                </Text>
                {grid(mine)}
              </Box>
            )}
            {others.length > 0 && (
              <Box>
                <Text fontSize="sm" fontWeight={700} color="mutedText" textTransform="uppercase" letterSpacing="0.06em" mb={3}>
                  {others.some(writable) ? t('Other boards') : t('Other boards (you can look, members change them)')}
                </Text>
                {grid(others)}
              </Box>
            )}
          </VStack>
        )}
      </Box>
      {creating && (
        <CreateBoardDialog
          onClose={() => setCreating(false)}
          onCreated={(b) => {
            void queryClient.invalidateQueries({ queryKey: kanbanKeys.boards(false) });
            navigate(`/kanban/b/${b.id}`);
          }}
        />
      )}
    </Box>
  );
}
