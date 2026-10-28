import type { ReactNode } from 'react';
import { Alert, AlertDescription, AlertIcon, AlertTitle, Box, Button, Flex, HStack } from '@chakra-ui/react';
import { apiErrorMessage, apiErrorRetryable } from '../api';
import { RefreshIcon } from '../icons';
import { useWorkspace } from '../workspace/useWorkspace';
import { NoConnectionsState } from './EmptyStates';
import { t } from '../i18n/index.ts';

interface LoadErrorProps {
  error: unknown;
  title?: string;     // what could not be loaded; default: the page's content
  onRetry: () => void;
  compact?: boolean;  // inside a panel or a list instead of filling the page
  actions?: ReactNode; // more ways on, e.g. a link back to the list
}

/**
 * What a page (or one of its panels) shows when its main request failed: what went wrong and
 * "Try again", instead of a blank area, an endless spinner or an empty state that is not true (M10).
 */
export function LoadError({ error, title, onRetry, compact = false, actions }: LoadErrorProps) {
  // "not found" or "no access" answers the same again: no "Try again" then, only the other ways on
  const retry = apiErrorRetryable(error);
  return (
    <Alert status="error" borderRadius="xl" alignItems="flex-start" py={compact ? 2 : 4} data-testid="load-error">
      <AlertIcon />
      <Flex flex={1} minW={0} gap={3} align={compact ? 'center' : 'flex-start'} direction={compact ? 'row' : 'column'} wrap="wrap">
        <Box flex={1} minW="180px">
          <AlertTitle fontSize="sm">{title ?? t('This page could not be loaded')}</AlertTitle>
          <AlertDescription fontSize="sm" display="block">
            {apiErrorMessage(error, t('The server did not answer. Check your connection and try again.'))}
          </AlertDescription>
        </Box>
        {(retry || actions) && (
          <HStack spacing={2} flexShrink={0}>
            {retry && (
              <Button size="sm" variant="subtle" leftIcon={<RefreshIcon boxSize={3.5} />} onClick={onRetry} data-testid="load-error-retry">
                {t('Try again')}
              </Button>
            )}
            {actions}
          </HStack>
        )}
      </Flex>
    </Alert>
  );
}

/** "Connect your first database" - or, when the list of databases could not be loaded, that error. */
export function NoConnections() {
  const ws = useWorkspace();
  if (ws.connectionsError) return <LoadError error={ws.connectionsError} title={t('Could not load your databases')} onRetry={ws.reloadConnections} />;
  return <NoConnectionsState isAdmin={ws.isAdmin} onAdd={ws.openAddConnection} />;
}
