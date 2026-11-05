/** Kanban's offline helper (K4), mounted once in the Kanban shell: brings back the boards last seen,
 * keeps them up to date on the phone, and sends waiting changes as soon as there is a connection. */
import { useEffect } from 'react';
import { Flex, Spinner, Text } from '@chakra-ui/react';
import { useQueryClient } from '@tanstack/react-query';
import { t, tn } from '../../i18n/index.ts';
import { useOnline } from '../../pwa/useOnline';
import { useNotify } from '../useNotify';
import { flush, hydrate, persist, reload } from './index';
import { useWaiting } from './useWaiting';

export function OfflineSync({ user }: { user: string }) {
  const client = useQueryClient();
  const notify = useNotify();
  useEffect(() => {
    let stop = () => {};
    let alive = true;
    const send = async () => {
      if (!navigator.onLine) return;
      const { sent, failed } = await flush();
      if (!alive) return;
      if (sent || failed.length) void client.invalidateQueries({ queryKey: ['kanban'] });
      if (sent) notify(tn(sent, 'Sent {n} change made without a connection', 'Sent {n} changes made without a connection'));
      if (failed.length) notify(t('Could not send: {what}', { what: failed.join('; ') }), { error: true });
    };
    void hydrate(client, user).then(() => {
      if (!alive) return;
      stop = persist(client);
      void reload().then(send);
    });
    const timer = setInterval(() => void send(), 30_000);
    window.addEventListener('online', send);
    return () => {
      alive = false;
      stop();
      clearInterval(timer);
      window.removeEventListener('online', send);
    };
  }, [client, user, notify]);
  return null;
}

/** The strip at the top: no connection (and how many changes wait), or the waiting ones being sent. */
export function KanbanOfflineBanner() {
  const online = useOnline();
  const waiting = useWaiting();
  if (online && !waiting.length) return null;
  return (
    <Flex role="status" align="center" justify="center" gap={2} px={4} py={2} bg={online ? 'brand.500' : 'orange.500'} color="white" fontSize="md" fontWeight={600} textAlign="center" flexShrink={0} data-testid="offline-banner" data-waiting={waiting.length}>
      {online && <Spinner size="sm" />}
      <Text>
        {online
          ? tn(waiting.length, 'Sending {n} change made without a connection…', 'Sending {n} changes made without a connection…')
          : waiting.length
            ? tn(waiting.length, 'No connection. {n} change is kept on this device and sent when the connection is back.', 'No connection. {n} changes are kept on this device and sent when the connection is back.')
            : t('No connection. Ticks, moves, comments and photos are kept and sent when the connection is back.')}
      </Text>
    </Flex>
  );
}
