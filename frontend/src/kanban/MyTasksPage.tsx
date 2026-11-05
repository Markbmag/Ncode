/** My tasks (K3): everything assigned to me on every board, in the order I work through it. A task
 * opens right here; "Move to…" and "Done" work without opening the board. */
import { useCallback, useMemo } from 'react';
import { Box, Button, Flex, Heading, HStack, Skeleton, Text, VStack } from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { CheckIcon, DownloadIcon } from '../icons';
import { t } from '../i18n/index.ts';
import { downloadExcel, kanbanKeys, moveCardToTop, undoRepeat, useBoard, useMyTasks } from './api';
import { printSheet } from './print';
import { PrintSheet } from './PrintSheet';
import { CardDrawer } from './CardDrawer';
import { CardFace } from './CardFace';
import { PrinterIcon, UserIcon } from './icons';
import { colorHex, dayTitle, myGroups, myGroupTitle, printRow, todayIso } from './logic';
import { EmptyState } from './parts';
import type { CardSummary, MyTasks } from './types';
import { useNotify } from './useNotify';
import { isQueued, sendOrQueue } from './offline/queue';

type Board = MyTasks['boards'][number];

/** The task opened from the list, with its board around it (labels, people, stages). */
function OpenTask({ cardId, boardId, onClose, onMove }: { cardId: number; boardId: number; onClose: () => void; onMove: (card: CardSummary, columnId: number) => void }) {
  const board = useBoard(boardId);
  const queryClient = useQueryClient();
  if (!board.data) return null;
  const detail = board.data;
  const columns = [...detail.columns].sort((a, b) => a.position - b.position);
  return (
    <CardDrawer
      cardId={cardId}
      detail={detail}
      columns={columns}
      canEdit={Boolean(detail.board.can_edit) && !detail.board.archived}
      canManage={Boolean(detail.board.can_manage)}
      onClose={onClose}
      onChanged={() => {
        void queryClient.invalidateQueries({ queryKey: kanbanKeys.my });
        void queryClient.invalidateQueries({ queryKey: kanbanKeys.board(boardId) });
      }}
      onMove={onMove}
    />
  );
}

export default function MyTasksPage() {
  const my = useMyTasks();
  const [search, setSearch] = useSearchParams();
  const queryClient = useQueryClient();
  const notify = useNotify();
  const today = todayIso();
  const boards = useMemo(() => new Map((my.data?.boards ?? []).map((b) => [b.id, b])), [my.data?.boards]);
  const doneColumns = useMemo(() => new Set((my.data?.boards ?? []).flatMap((b) => b.columns.filter((c) => c.is_done).map((c) => c.id))), [my.data?.boards]);
  const isDone = useCallback((c: CardSummary) => doneColumns.has(c.column_id) || c.completed_at !== null, [doneColumns]);
  const groups = useMemo(() => myGroups(my.data?.cards ?? [], today, isDone), [my.data?.cards, today, isDone]);
  const openId = Number(search.get('task')) || null;
  const opened = openId ? my.data?.cards.find((c) => c.id === openId) : undefined;

  const refresh = useCallback(
    (boardId: number) => {
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.my });
      void queryClient.invalidateQueries({ queryKey: kanbanKeys.board(boardId) });
      void queryClient.invalidateQueries({ queryKey: ['kanban', 'boards'] });
    },
    [queryClient],
  );
  const move = useCallback(
    async (card: CardSummary, columnId: number) => {
      const board = boards.get((card as CardSummary & { board_id: number }).board_id);
      const target = board?.columns.find((c) => c.id === columnId);
      const before = card.column_id;
      // the list follows at once, also without a connection (K4)
      queryClient.setQueryData<MyTasks>(kanbanKeys.my, (old) => (old ? { ...old, cards: old.cards.map((c) => (c.id === card.id ? { ...c, column_id: columnId, completed_at: target?.is_done ? Date.now() / 1000 : null } : c)) } : old));
      try {
        const res = await sendOrQueue({ kind: 'move', cardId: card.id, columnId, position: null, label: t('move “{title}”', { title: card.title }) }, () => moveCardToTop(card.id, columnId));
        if (isQueued(res)) {
          notify(t('Moved “{title}” to {column}. It is sent when the connection is back.', { title: card.title, column: target?.name ?? '' }), {
            undo: () => void sendOrQueue({ kind: 'move', cardId: card.id, columnId: before, position: null, label: t('move “{title}”', { title: card.title }) }, () => moveCardToTop(card.id, before)).then(() => board && refresh(board.id)),
          });
          return;
        }
        const next = res.next;
        if (next && card.repeat) {
          const repeat = card.repeat;
          notify(t('Moved “{title}” to {column}. It repeats: the next one is due {date}.', { title: card.title, column: target?.name ?? '', date: dayTitle(next.due_date) }), {
            undo: () => void undoRepeat(card.id, repeat, next.id).then(() => moveCardToTop(card.id, before)).then(() => board && refresh(board.id)),
          });
          return;
        }
        notify(t('Moved “{title}” to {column}', { title: card.title, column: target?.name ?? '' }), {
          undo: () => void moveCardToTop(card.id, before).then(() => board && refresh(board.id)),
        });
      } catch (err) {
        notify(apiErrorMessage(err, t('Could not move the task')), { error: true });
      } finally {
        if (board) refresh(board.id);
      }
    },
    [boards, notify, refresh, queryClient],
  );
  const open = (id: number | null) => {
    const next = new URLSearchParams(search);
    if (id) next.set('task', String(id));
    else next.delete('task');
    setSearch(next, { replace: !id });
  };

  return (
    <Box maxW="860px" mx="auto" px={{ base: 3, md: 6 }} py={{ base: 4, md: 8 }} h="100%" overflowY="auto" data-testid="my-tasks">
      <HStack spacing={3} mb={1}>
        <Flex w="40px" h="40px" borderRadius="xl" bg="rgba(99,102,241,0.14)" color="brand.400" align="center" justify="center">
          <UserIcon boxSize={5} />
        </Flex>
        <Heading as="h1" fontSize={{ base: '2xl', md: '3xl' }} letterSpacing="-0.02em" flex={1}>
          {t('My tasks')}
        </Heading>
        {groups.length > 0 && (
          <HStack spacing={2}>
            <Button variant="subtle" leftIcon={<PrinterIcon boxSize={4} />} onClick={printSheet} data-testid="my-print">
              <Text as="span" display={{ base: 'none', sm: 'inline' }}>{t('Print')}</Text>
            </Button>
            <Button
              variant="subtle"
              leftIcon={<DownloadIcon boxSize={4} />}
              onClick={() => void downloadExcel('/my', `${t('My tasks')}.xlsx`).catch((err: unknown) => notify(apiErrorMessage(err, t('Could not download the file')), { error: true }))}
              data-testid="my-excel"
            >
              <Text as="span" display={{ base: 'none', sm: 'inline' }}>Excel</Text>
            </Button>
          </HStack>
        )}
      </HStack>
      <Text color="mutedText" mb={6}>
        {t('Everything assigned to you, on all boards.')}
      </Text>

      {my.isPending ? (
        <VStack align="stretch" spacing={3}>
          {[0, 1, 2].map((i) => <Skeleton key={i} h="84px" borderRadius="xl" />)}
        </VStack>
      ) : my.isError && !my.data ? (
        <EmptyState icon={<UserIcon boxSize={7} />} title={t('Could not load your tasks')} text={apiErrorMessage(my.error, '')} action={t('Try again')} onAction={() => void my.refetch()} />
      ) : !groups.length ? (
        <EmptyState icon={<CheckIcon boxSize={7} />} title={t('Nothing assigned to you')} text={t('Tasks where you are chosen under “Who does it” show up here, from every board.')} testId="my-tasks-empty" />
      ) : (
        <VStack align="stretch" spacing={7}>
          {groups.map((group) => (
            <Box key={group.key} data-testid="my-group" data-group={group.key}>
              <HStack mb={2.5} spacing={2}>
                <Text fontWeight={750} fontSize="lg" color={group.key === 'late' ? 'red.500' : group.key === 'today' ? 'brand.500' : 'bodyText'}>
                  {myGroupTitle(group.key)}
                </Text>
                <Text color="mutedText" fontWeight={700}>
                  {group.cards.length}
                </Text>
              </HStack>
              <VStack align="stretch" spacing={2.5}>
                {group.cards.map((card) => {
                  const board = boards.get(card.board_id) as Board;
                  const column = board.columns.find((c) => c.id === card.column_id);
                  const done = isDone(card);
                  const firstDone = board.columns.find((c) => c.is_done);
                  return (
                    <Box key={card.id} data-testid="my-task" data-title={card.title}>
                      <Flex align="center" gap={2} mb={1} px={1} fontSize="sm" wrap="wrap">
                        <Box w="9px" h="9px" borderRadius="sm" bg={colorHex(board.color)} />
                        <Text as={RouterLink} to={`/kanban/b/${board.id}`} fontWeight={700} color="mutedText" _hover={{ color: 'bodyText', textDecoration: 'underline' }}>
                          {board.name}
                        </Text>
                        <Text color="faintText">·</Text>
                        <Text color="mutedText" data-testid="my-task-stage">
                          {column?.name}
                        </Text>
                        {board.can_edit && !done && firstDone && (
                          <Button size="sm" ml="auto" variant="subtle" leftIcon={<CheckIcon boxSize={4} />} onClick={() => void move(card, firstDone.id)} data-testid="my-task-done">
                            {t('Done')}
                          </Button>
                        )}
                      </Flex>
                      <Box role="button" tabIndex={0} onClick={() => open(card.id)} onKeyDown={(e) => e.key === 'Enter' && open(card.id)} cursor="pointer" aria-label={t('Open the task {title}', { title: card.title })}>
                        <CardFace
                          card={card}
                          labels={board.labels}
                          people={my.data?.people ?? []}
                          today={today}
                          done={done}
                          accent={column?.color ?? board.color ?? 'indigo'}
                          columns={board.can_edit ? board.columns : undefined}
                          onMove={board.can_edit ? (c, col) => void move(c, col) : undefined}
                        />
                      </Box>
                    </Box>
                  );
                })}
              </VStack>
            </Box>
          ))}
        </VStack>
      )}
      <PrintSheet
        title={t('My tasks')}
        extraTitle={t('Board')}
        groups={groups.map((g) => ({
          title: myGroupTitle(g.key),
          rows: g.cards.map((c) => printRow(c, my.data?.people ?? [], today, isDone(c), boards.get(c.board_id)?.name)),
        }))}
      />
      {opened && <OpenTask key={opened.id} cardId={opened.id} boardId={opened.board_id} onClose={() => open(null)} onMove={(c, col) => void move(c, col)} />}
    </Box>
  );
}
