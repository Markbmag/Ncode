import { Flex, Text } from '@chakra-ui/react';
import { t } from '../i18n/index.ts';
import { useOnline } from './useOnline';

/** A strip at the top while there is no connection: what is on screen stays, changes wait. */
export function OfflineBanner() {
  const online = useOnline();
  if (online) return null;
  return (
    <Flex role="status" align="center" justify="center" gap={2} px={4} py={2} bg="orange.500" color="white" fontSize="md" fontWeight={600} textAlign="center" flexShrink={0} data-testid="offline-banner">
      <Text>{t('No connection. You can look at what is on the screen; changes need the connection.')}</Text>
    </Flex>
  );
}
