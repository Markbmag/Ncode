/** The parts of the home page (pages/HomePage.tsx): first steps, "Start here", item lists, everything Ncode can do. */
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertIcon, Badge, Box, Button, Flex, HStack, Link, Progress, Select, SimpleGrid, Text, VStack, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { InlineHint } from '../components/InlineHint';
import { ChartIcon, CheckIcon, CodeIcon, FolderIcon, LayoutIcon, MergeIcon, StarIcon } from '../icons';
import { useCollections } from '../library/api';
import { audienceOf } from '../library/shareLogic';
import { VerifiedBadge } from '../library/VerifiedBadge';
import { localDateText } from '../viz/format';
import { navTestId, visibleGroups } from '../shell/nav';
import { t } from '../i18n/index.ts';
import { homeApi } from './api';
import type { HomeItem, StartHere } from './api';
import { setChecklistHidden } from './checklist';
import { STEPS, progress, stepInfo } from './steps';
import type { ChecklistState } from './steps';

function ago(ts: number): string {
  const s = Date.now() / 1000 - ts;
  if (s < 60) return t('just now');
  if (s < 3600) return t('{n} min ago', { n: Math.floor(s / 60) });
  if (s < 86400) return t('{n} h ago', { n: Math.floor(s / 3600) });
  if (s < 86400 * 30) return t('{n} d ago', { n: Math.floor(s / 86400) });
  return localDateText(ts * 1000);
}

const itemPath = (item: HomeItem) => `/${item.type === 'dashboard' ? 'dashboards' : 'questions'}/${item.id}`;

function ItemIcon({ item }: { item: HomeItem }) {
  if (item.type === 'dashboard') return <LayoutIcon boxSize={4} color="green.400" flexShrink={0} />;
  if (item.kind === 'sql') return <CodeIcon boxSize={4} color="cyan.400" flexShrink={0} />;
  if (item.kind === 'federated') return <MergeIcon boxSize={4} color="orange.300" flexShrink={0} />;
  return <ChartIcon boxSize={4} color="brand.400" flexShrink={0} />;
}

export function Panel({ title, subtitle, actions, children, testId }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <Box bg="panelBg" border="1px solid" borderColor="lineColor" borderRadius="xl" overflow="hidden" data-testid={testId}>
      <Flex align="center" gap={2} wrap="wrap" px={4} py={2.5} borderBottom="1px solid" borderColor="lineColor">
        <Box flex={1} minW={0}>
          <Box fontSize="sm" fontWeight={700}>
            {title}
          </Box>
          {subtitle && (
            <Box fontSize="xs" color="mutedText">
              {subtitle}
            </Box>
          )}
        </Box>
        {actions}
      </Flex>
      {children}
    </Box>
  );
}

/** Recently viewed / your dashboards: one line per item. */
export function ItemList({ items, empty }: { items: HomeItem[]; empty: ReactNode }) {
  if (!items.length) return <>{empty}</>;
  return (
    <Box>
      {items.map((item) => (
        <Flex
          key={`${item.type}-${item.id}`}
          as={RouterLink}
          to={itemPath(item)}
          align="center"
          gap={3}
          px={4}
          py={2.5}
          borderBottom="1px solid"
          borderColor="lineColor"
          _last={{ borderBottom: 'none' }}
          _hover={{ bg: 'panelHover' }}
          data-testid="home-item"
        >
          <ItemIcon item={item} />
          <Box flex={1} minW={0}>
            <HStack spacing={2} minW={0}>
              <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                {item.name}
              </Text>
              <VerifiedBadge verified={item.verified} size="xs" />
            </HStack>
            <Text fontSize="xs" color="mutedText" noOfLines={1}>
              {item.collection && (item.collection.mine ? t('My collection') : item.collection.name)}
              {item.viewed_at ? ` · ${t('opened {when}', { when: ago(item.viewed_at) })}` : ''}
            </Text>
          </Box>
          {item.favorite && <StarIcon boxSize={3.5} color="yellow.400" fill="currentColor" flexShrink={0} />}
        </Flex>
      ))}
    </Box>
  );
}

// ---------------------------------------------------------------- first steps

export function FirstSteps({ state, dashboardTo, demo }: { state: ChecklistState; dashboardTo: string | null; demo: string | null }) {
  const toast = useToast();
  const [hiding, setHiding] = useState(false);
  const p = progress(state);
  if (!p.visible) return null;
  const hide = async () => {
    setHiding(true);
    try {
      await setChecklistHidden(true);
    } catch (e) {
      toast({ status: 'error', title: t('Could not change it'), description: apiErrorMessage(e, t('Please try again')), duration: 4000 });
      setHiding(false);
    }
  };
  return (
    <Box bg="panelBg" border="1px solid" borderColor="rgba(99,102,241,0.35)" borderRadius="2xl" p={{ base: 4, md: 5 }} data-testid="first-steps">
      <Flex align="flex-start" gap={3} mb={2}>
        <Flex align="center" columnGap={3} rowGap={1} wrap="wrap" flex={1} minW={0}>
          <Text fontWeight={700}>{t('Your first steps in Ncode')}</Text>
          <Badge bg="chipBg" color="mutedText" borderRadius="full" px={2} textTransform="none">
            {t('{done} of {total} done', { done: p.doneCount, total: p.total })}
          </Badge>
        </Flex>
        <Button size="xs" variant="ghost" flexShrink={0} onClick={() => void hide()} isLoading={hiding} data-testid="first-steps-hide">
          {t('Hide')}
        </Button>
      </Flex>
      <Progress value={(p.doneCount / p.total) * 100} size="xs" borderRadius="full" colorScheme="brand" mb={3} />
      {demo && (
        <Text fontSize="xs" color="mutedText" mb={3}>
          {t('Practise on “{name}”: sample factory data, so nothing you do can break anything.', { name: demo })}
        </Text>
      )}
      <VStack align="stretch" spacing={1}>
        {STEPS.map((id, index) => {
          const info = stepInfo(id);
          const done = state.done.includes(id);
          const next = p.next === id;
          const to = (id === 'open_dashboard' || id === 'change_filter') && dashboardTo ? dashboardTo : info.to;
          return (
            <Flex key={id} align={{ base: 'flex-start', sm: 'center' }} direction={{ base: 'column', sm: 'row' }} gap={{ base: 1, sm: 3 }} py={1.5} data-testid={`step-${id}`} data-done={done || undefined}>
              <HStack spacing={3} flex={1} minW={0} align="flex-start">
                <Flex
                  w="22px"
                  h="22px"
                  borderRadius="full"
                  align="center"
                  justify="center"
                  flexShrink={0}
                  fontSize="xs"
                  fontWeight={700}
                  bg={done ? 'green.500' : next ? 'brand.500' : 'chipBg'}
                  color={done || next ? 'white' : 'faintText'}
                  aria-label={done ? t('done') : undefined}
                >
                  {done ? <CheckIcon boxSize={3} /> : index + 1}
                </Flex>
                <Box minW={0}>
                  <Text fontSize="sm" fontWeight={next ? 700 : 500} color={done ? 'mutedText' : 'bodyText'} textDecoration={done ? 'line-through' : undefined}>
                    {info.label}
                  </Text>
                  {next && (
                    <Text fontSize="xs" color="mutedText">
                      {info.hint}
                    </Text>
                  )}
                </Box>
              </HStack>
              {next && (
                <Button as={RouterLink} to={to} size="xs" variant="brand" ml={{ base: '34px', sm: 0 }} data-testid="first-steps-go">
                  {info.action}
                </Button>
              )}
            </Flex>
          );
        })}
      </VStack>
    </Box>
  );
}

// ---------------------------------------------------------------- start here

/** Admins: which collection newcomers see first. Personal collections cannot be chosen (only their owner sees them). */
function StartHerePicker({ current, onDone }: { current: number | null; onDone?: () => void }) {
  const toast = useToast();
  const { data } = useCollections();
  const [picked, setPicked] = useState<string>(current ? String(current) : '');
  const [busy, setBusy] = useState(false);
  const options = useMemo(() => {
    const all = data?.collections ?? [];
    return all.filter((c) => !c.archived && audienceOf(all, c.id) !== 'private').sort((a, b) => a.name.localeCompare(b.name));
  }, [data]);
  const save = async (value: number | null) => {
    setBusy(true);
    try {
      await homeApi.setStartHere(value);
      onDone?.();
    } catch (e) {
      toast({ status: 'error', title: t('Could not change it'), description: apiErrorMessage(e, t('Please try again')), duration: 5000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Flex gap={2} wrap="wrap" align="center">
      <Select size="sm" maxW="280px" value={picked} onChange={(e) => setPicked(e.target.value)} placeholder={t('Choose a collection…')} aria-label={t('Collection')} data-testid="start-here-pick">
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </Select>
      <Button size="sm" variant="brand" isDisabled={!picked || Number(picked) === current} isLoading={busy} onClick={() => void save(Number(picked))} data-testid="start-here-save">
        {t('Show on the home page')}
      </Button>
      {current !== null && (
        <Button size="sm" variant="ghost" isDisabled={busy} onClick={() => void save(null)}>
          {t('Show none')}
        </Button>
      )}
    </Flex>
  );
}

export function StartHereSection({ startHere, isAdmin }: { startHere: StartHere | null; isAdmin: boolean }) {
  const [changing, setChanging] = useState(false);
  if (!startHere) {
    if (!isAdmin) return null;
    return (
      <Panel title={t('Start here')} subtitle={t('Only admins see this until a collection is chosen.')} testId="start-here">
        <Box px={4} py={4}>
          <Text fontSize="sm" color="mutedText" mb={1}>
            {t('Choose the collection newcomers should open first: its dashboards and questions then show at the top of everyone’s home page.')}
          </Text>
          <Text fontSize="xs" color="faintText" mb={3}>
            {t('Example: {example}', { example: t('a “Start here” collection with the plant overview dashboard and the official scrap numbers.') })}
          </Text>
          <StartHerePicker current={null} />
        </Box>
      </Panel>
    );
  }
  return (
    <Panel
      title={
        <HStack spacing={2}>
          <Text as="span">{t('Start here')}</Text>
          <Text as="span" fontWeight={500} color="mutedText">
            · {startHere.name}
          </Text>
        </HStack>
      }
      subtitle={startHere.description || t('Picked by your administrators: the best place to begin.')}
      actions={
        isAdmin && (
          <Button size="xs" variant="ghost" onClick={() => setChanging((v) => !v)} data-testid="start-here-change">
            {changing ? t('Cancel') : t('Change')}
          </Button>
        )
      }
      testId="start-here"
    >
      {isAdmin && changing && (
        <Box px={4} pt={3}>
          <StartHerePicker current={startHere.id} onDone={() => setChanging(false)} />
        </Box>
      )}
      {isAdmin && !startHere.shared && (
        <Alert status="warning" fontSize="sm" mx={4} mt={3} borderRadius="md" w="auto">
          <AlertIcon />
          <Box flex={1}>
            {t('Only admins can see “{name}” now. Give everyone access to it so it shows on their home page.', { name: startHere.name })}{' '}
            <Link as={RouterLink} to={`/library/c/${startHere.id}`} fontWeight={600}>
              {t('Open the collection')}
            </Link>
          </Box>
        </Alert>
      )}
      {startHere.items.length === 0 ? (
        <InlineHint icon={<FolderIcon boxSize={4} />} action={<Button as={RouterLink} to={`/library/c/${startHere.id}`} size="sm" variant="subtle">{t('Open the collection')}</Button>}>
          {isAdmin
            ? t('Nothing in “{name}” yet. Save the dashboards and questions newcomers should open first into it.', { name: startHere.name })
            : t('Nothing in “{name}” yet.', { name: startHere.name })}
        </InlineHint>
      ) : (
        <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={3} p={4}>
          {startHere.items.map((item) => (
            <Box
              key={`${item.type}-${item.id}`}
              as={RouterLink}
              to={itemPath(item)}
              border="1px solid"
              borderColor="lineColor"
              borderRadius="lg"
              p={3}
              minW={0}
              _hover={{ borderColor: 'brand.400', bg: 'panelHover' }}
              data-testid="start-here-item"
            >
              <HStack spacing={2} mb={1} minW={0}>
                <ItemIcon item={item} />
                <Text fontSize="sm" fontWeight={700} noOfLines={1} flex={1}>
                  {item.name}
                </Text>
                <VerifiedBadge verified={item.verified} size="xs" />
              </HStack>
              <Text fontSize="xs" color="mutedText" noOfLines={2}>
                {item.description || (item.type === 'dashboard' ? t('Dashboard') : t('Question'))}
              </Text>
            </Box>
          ))}
        </SimpleGrid>
      )}
      {startHere.total > startHere.items.length && (
        <Box px={4} pb={3}>
          <Link as={RouterLink} to={`/library/c/${startHere.id}`} fontSize="sm">
            {t('All {n} in “{name}”', { n: startHere.total, name: startHere.name })}
          </Link>
        </Box>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------- everything Ncode can do

export function EverythingSection({ isAdmin, footer }: { isAdmin: boolean; footer?: ReactNode }) {
  const groups = visibleGroups(isAdmin).filter((g) => g.id !== 'home');
  return (
    <Box data-testid="everything">
      <Text fontSize="sm" fontWeight={700} mb={1}>
        {t('Everything Ncode can do')}
      </Text>
      <Text fontSize="xs" color="mutedText" mb={3}>
        {t('The same sections as the menu, with a line on what each one is for.')}
      </Text>
      <SimpleGrid columns={{ base: 1, md: 2, xl: 4 }} spacing={4}>
        {groups.map((group) => (
          <Box key={group.id} minW={0}>
            <Text fontSize="2xs" fontWeight={700} letterSpacing="0.08em" textTransform="uppercase" color="faintText" mb={1.5}>
              {group.label ?? t('Admin')}
            </Text>
            <VStack align="stretch" spacing={1}>
              {group.items.map((item) => (
                <Flex
                  key={item.to}
                  as={RouterLink}
                  to={item.to}
                  gap={2.5}
                  align="flex-start"
                  p={2}
                  borderRadius="lg"
                  _hover={{ bg: 'panelHover' }}
                  data-testid={`home-${navTestId(item.to)}`}
                >
                  <Box color="brand.300" pt={0.5}>
                    <item.icon boxSize={4} />
                  </Box>
                  <Box minW={0}>
                    <Text fontSize="sm" fontWeight={600}>
                      {item.label}
                    </Text>
                    <Text fontSize="xs" color="mutedText">
                      {item.hint}
                    </Text>
                  </Box>
                </Flex>
              ))}
            </VStack>
          </Box>
        ))}
      </SimpleGrid>
      {footer}
    </Box>
  );
}
