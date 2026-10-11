import { useState } from 'react';
import {
  Badge, Box, Button, Flex, HStack, IconButton, Link, Skeleton, Switch, Text, Tooltip, VStack, useToast,
} from '@chakra-ui/react';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage } from '../api';
import { subscriptions, useSubscriptions } from '../automation/api';
import { StatusBadge } from '../automation/SubscriptionsDrawer';
import { describeAlert, describeSchedule, recipientCount, timeAgo } from '../automation/logic';
import type { Subscription } from '../automation/types';
import { PageHeader } from '../components/PageHeader';
import { BellIcon, LayoutIcon, ChartIcon, MailIcon, SendIcon, TrashIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';

/** /subscriptions: everything that is sent on a schedule - yours, the ones you receive, and (admins) everyone's. */
export default function SubscriptionsPage() {
  const ws = useWorkspace();
  const [everyone, setEveryone] = useState(false);
  const list = useSubscriptions({ all: everyone || undefined });
  const subs = list.data ?? [];
  const mine = subs.filter((s) => s.can_manage);
  const receiving = subs.filter((s) => !s.can_manage);
  return (
    <VStack align="stretch" spacing={6}>
      <PageHeader
        title="Subscriptions and alerts"
        subtitle="Dashboards and questions sent by email or to a chat on a schedule, and alerts that only send when something happens. Set them up from a dashboard or question (the bell button)."
        actions={
          ws.isAdmin ? (
            <HStack>
              <Text fontSize="sm">Everyone's</Text>
              <Switch isChecked={everyone} onChange={(e) => setEveryone(e.target.checked)} data-testid="all-subscriptions" />
            </HStack>
          ) : undefined
        }
      />
      {list.isPending && <Skeleton h="120px" borderRadius="xl" />}
      {!list.isPending && subs.length === 0 && (
        <Flex direction="column" align="center" gap={3} py={14} border="1px dashed" borderColor="lineColor" borderRadius="2xl" color="mutedText" textAlign="center">
          <BellIcon boxSize={8} />
          <Text fontSize="sm" maxW="460px">
            Nothing is sent yet. Open a dashboard or a saved question and use the bell button to send it every morning, every Monday or when a number crosses a line.
          </Text>
          <Button as={RouterLink} to="/dashboards" size="sm" variant="brand">
            Dashboards
          </Button>
        </Flex>
      )}
      {mine.length > 0 && <Group title={everyone ? 'All subscriptions' : 'Yours'} subs={mine} />}
      {receiving.length > 0 && <Group title="Sent to you by others" subs={receiving} />}
    </VStack>
  );
}

function Group({ title, subs }: { title: string; subs: Subscription[] }) {
  return (
    <Box>
      <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.06em" mb={2}>
        {title} ({subs.length})
      </Text>
      <VStack align="stretch" spacing={2}>
        {subs.map((s) => (
          <Item key={s.id} sub={s} />
        ))}
      </VStack>
    </Box>
  );
}

function Item({ sub }: { sub: Subscription }) {
  const toast = useToast();
  const act = async (what: string, fn: () => Promise<unknown>, done?: string) => {
    try {
      await fn();
      if (done) toast({ status: 'success', title: done, duration: 2000 });
    } catch (e) {
      toast({ status: 'error', title: what, description: apiErrorMessage(e, 'Please try again') });
    }
  };
  const path = `/${sub.target_type === 'dashboard' ? 'dashboards' : 'questions'}/${sub.target_id}?subscriptions=1`;
  return (
    <Flex
      align={{ base: 'flex-start', md: 'center' }}
      direction={{ base: 'column', md: 'row' }}
      gap={3}
      p={3}
      bg="panelBg"
      border="1px solid"
      borderColor="lineColor"
      borderRadius="xl"
      opacity={sub.enabled ? 1 : 0.6}
      data-testid="subscription-item"
    >
      <HStack spacing={3} flex={1} minW={0} align="flex-start">
        {sub.alert ? <BellIcon boxSize={5} color="orange.400" mt={0.5} /> : <MailIcon boxSize={5} color="brand.400" mt={0.5} />}
        <Box minW={0}>
          <HStack spacing={2}>
            <Link as={RouterLink} to={path} fontWeight={600} fontSize="sm" noOfLines={1}>
              {sub.name || sub.target_name || `${sub.target_type} ${sub.target_id}`}
            </Link>
            <StatusBadge status={sub.running ? 'running' : sub.last_status} />
            {!sub.enabled && <Badge fontSize="2xs">paused</Badge>}
          </HStack>
          <HStack spacing={1} fontSize="xs" color="mutedText" wrap="wrap">
            {sub.target_type === 'dashboard' ? <LayoutIcon boxSize={3} /> : <ChartIcon boxSize={3} />}
            <Text>{sub.target_name ?? 'not shared with you'}</Text>
            <Text>·</Text>
            <Text>{sub.alert ? `${describeAlert(sub.alert)}, checked ${describeSchedule(sub.schedule).toLowerCase()}` : describeSchedule(sub.schedule)}</Text>
            <Text>·</Text>
            <Text>
              {recipientCount(sub.recipients)} recipient{recipientCount(sub.recipients) === 1 ? '' : 's'}
            </Text>
            {sub.owner && (
              <>
                <Text>·</Text>
                <Text>by {sub.owner}</Text>
              </>
            )}
          </HStack>
          {sub.last_error && (
            <Text fontSize="xs" color="red.400" noOfLines={1}>
              {sub.last_error}
            </Text>
          )}
        </Box>
      </HStack>
      <Text fontSize="xs" color="faintText" whiteSpace="nowrap">
        last {timeAgo(sub.last_run_at)}
        {sub.enabled && sub.next_run_at ? ` · next ${timeAgo(sub.next_run_at)}` : ''}
      </Text>
      {sub.can_manage ? (
        <HStack spacing={1}>
          <Tooltip label={sub.enabled ? 'Pause' : 'Switch on'} hasArrow>
            <Box>
              <Switch size="sm" isChecked={sub.enabled} onChange={(e) => void act('Could not change it', () => subscriptions.setEnabled(sub.id, e.target.checked))} aria-label="On or paused" />
            </Box>
          </Tooltip>
          <Tooltip label="Send now" hasArrow>
            <IconButton aria-label="Send now" size="sm" variant="ghost" icon={<SendIcon boxSize={4} />} onClick={() => void act('Could not send', () => subscriptions.sendNow(sub.id), 'Sending now')} />
          </Tooltip>
          <Tooltip label="Delete" hasArrow>
            <IconButton aria-label="Delete" size="sm" variant="ghost" colorScheme="red" icon={<TrashIcon boxSize={4} />} onClick={() => void act('Could not delete', () => subscriptions.remove(sub.id))} />
          </Tooltip>
        </HStack>
      ) : (
        <Button size="xs" variant="ghost" onClick={() => void act('Could not unsubscribe', () => subscriptions.unsubscribe(sub.id), 'You will not get this any more')}>
          Unsubscribe me
        </Button>
      )}
    </Flex>
  );
}
