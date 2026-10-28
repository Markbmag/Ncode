import { useState } from 'react';
import { Alert, AlertIcon, Badge, Box, Button, Flex, Skeleton, Text, VStack } from '@chakra-ui/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink } from 'react-router-dom';
import { apiErrorMessage, http } from '../api';
import { CheckIcon, RefreshIcon } from '../icons';
import { Panel } from './Panel';
import { groupByKind, kindTitle, problemText } from './brokenContent';
import type { BrokenReport } from './brokenContent';
import { locale, t, tn } from '../i18n/index.ts';

const KEY = ['admin', 'broken-content'];

/** Admin → Broken content: saved questions, dashboards, subscriptions and files that point at something gone. */
export function BrokenContentPanel() {
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const report = useQuery({
    queryKey: KEY,
    queryFn: async () => (await http.get<BrokenReport>('/api/admin/broken-content', { timeout: 0 })).data,
    staleTime: Infinity,
  });
  const checkAgain = async () => {
    setChecking(true);
    setError(null);
    try {
      const fresh = (await http.get<BrokenReport>('/api/admin/broken-content', { params: { refresh: true }, timeout: 0 })).data;
      queryClient.setQueryData(KEY, fresh);
    } catch (e) {
      setError(apiErrorMessage(e, t('Please try again')));
    } finally {
      setChecking(false);
    }
  };

  const data = report.data;
  const groups = data ? groupByKind(data.items) : [];
  return (
    <Panel
      title={t('Broken content')}
      subtitle={t('Saved questions, dashboards, subscriptions and uploaded files that point at tables, columns, questions, files or databases that no longer exist. Fix them before people open them.')}
      actions={
        <Button size="sm" leftIcon={<RefreshIcon boxSize={4} />} onClick={() => void checkAgain()} isLoading={checking}
          loadingText={t('Checking…')} data-testid="broken-check-again">
          {t('Check again')}
        </Button>
      }
    >
      {(report.isPending || checking) && !data && <Skeleton h="80px" borderRadius="xl" />}
      {report.isError && !data && (
        <Alert status="error" borderRadius="xl" mb={3}>
          <AlertIcon />
          <Box flex={1}>{apiErrorMessage(report.error, t('Could not check the content'))}</Box>
          <Button size="xs" onClick={() => void report.refetch()}>{t('Try again')}</Button>
        </Alert>
      )}
      {error && (
        <Alert status="error" borderRadius="xl" mb={3}>
          <AlertIcon />
          {error}
        </Alert>
      )}
      {data && (
        <VStack align="stretch" spacing={4} data-testid="broken-content">
          <Text fontSize="xs" color="mutedText">
            {t('Checked {when}', { when: new Date(data.checked_at * 1000).toLocaleString(locale()) })} ·{' '}
            {tn(data.counts.questions, '{n} question', '{n} questions')} · {tn(data.counts.dashboards, '{n} dashboard', '{n} dashboards')} ·{' '}
            {tn(data.counts.subscriptions, '{n} subscription', '{n} subscriptions')} · {tn(data.counts.datasets, '{n} uploaded file', '{n} uploaded files')}
          </Text>

          {data.unchecked.map((u) => (
            <Alert key={u.connection} status="warning" borderRadius="xl" fontSize="sm" data-testid="broken-unchecked">
              <AlertIcon />
              <Box>
                <Text fontWeight={600}>
                  {t("Couldn't check {db}", { db: u.label })} ({tn(u.questions, '{n} question', '{n} questions')})
                </Text>
                <Text>{u.reason}</Text>
              </Box>
            </Alert>
          ))}

          {data.items.length === 0 && (
            <Flex align="center" gap={3} px={3} py={3} borderRadius="xl" bg="chipBg" data-testid="broken-empty">
              <CheckIcon boxSize={5} color="green.400" />
              <Text fontSize="sm">
                {data.unchecked.length > 0
                  ? t('Everything that could be checked points at existing tables and columns.')
                  : t('Everything points at existing tables and columns.')}
              </Text>
            </Flex>
          )}

          {groups.map(([kind, items]) => (
            <Box key={kind}>
              <Text fontSize="xs" fontWeight={700} letterSpacing="0.08em" color="faintText" mb={2} textTransform="uppercase">
                {kindTitle(kind)} · {items.length}
              </Text>
              <VStack align="stretch" spacing={2}>
                {items.map((item) => (
                  <Flex key={`${item.kind}-${item.id}`} align={{ base: 'stretch', md: 'center' }} direction={{ base: 'column', md: 'row' }}
                    gap={3} px={3} py={2} borderRadius="xl" bg="chipBg" data-testid="broken-item">
                    <Box flex={1} minW={0}>
                      <Text fontSize="sm" fontWeight={600} noOfLines={1}>
                        {item.name}
                        {item.connection && (
                          <Badge ml={2} fontSize="0.6rem">
                            {item.connection}
                          </Badge>
                        )}
                      </Text>
                      <Text fontSize="sm" color="orange.400">
                        {problemText(item)}
                      </Text>
                      <Text fontSize="xs" color="mutedText" noOfLines={1}>
                        {[item.owner && t('Owner: {name}', { name: item.owner }), item.collection?.name && t('In {name}', { name: item.collection.name })]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    </Box>
                    <Button as={RouterLink} to={item.link} size="sm" variant="subtle" flexShrink={0}>
                      {t('Open')}
                    </Button>
                  </Flex>
                ))}
              </VStack>
            </Box>
          ))}
        </VStack>
      )}
    </Panel>
  );
}
