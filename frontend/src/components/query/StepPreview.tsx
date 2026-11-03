import { useEffect, useMemo } from 'react';
import { Alert, AlertIcon, Box, Flex, Spinner, Text } from '@chakra-ui/react';
import { http } from '../../api';
import { labelColumns } from '../../query/outputs';
import type { ColumnName } from '../../query/outputs';
import type { StepRequest } from '../../query/preview';
import { START_WAIT_MS, useQueryRun } from '../../query/useQueryRun';
import type { TaskSnapshot } from '../../query/useQueryRun';
import { ResultsTable } from '../data/ResultsTable';
import { t } from '../../i18n/index.ts';

interface Props {
  request: StepRequest | null;
  labels?: Map<string, ColumnName> | null;
  smartDates?: boolean;
}

/** The first rows after one builder step (M12), run like the question itself and refreshed while it changes. */
export function StepPreview({ request, labels, smartDates }: Props) {
  const { state, run } = useQueryRun();
  const json = request && request.problems.length === 0 ? JSON.stringify(request.spec) : '';
  useEffect(() => {
    if (!json) return;
    const timer = window.setTimeout(
      () => void run(async () => (await http.post<TaskSnapshot>('/api/query', { spec: JSON.parse(json), wait_ms: START_WAIT_MS })).data),
      300,
    );
    return () => window.clearTimeout(timer);
  }, [json, run]);
  const result = useMemo(() => (state.result && labels ? { ...state.result, columns: labelColumns(state.result.columns, labels) } : state.result), [state.result, labels]);

  let body: React.ReactNode;
  if (request && request.problems.length > 0)
    body = (
      <Text fontSize="xs" color="orange.400" p={2}>
        {request.problems.join(' · ')}
      </Text>
    );
  else if (state.error && (state.status === 'error' || state.status === 'failed'))
    body = (
      <Alert status="error" fontSize="xs" py={2} data-testid="step-preview-error">
        <AlertIcon boxSize={4} />
        {state.error}
      </Alert>
    );
  else if (!result)
    body = (
      <Flex align="center" gap={2} p={2} fontSize="xs" color="mutedText">
        <Spinner size="xs" /> {t('Loading the first rows…')}
      </Flex>
    );
  else if (result.rows.length === 0)
    body = (
      <Text fontSize="xs" color="mutedText" p={2}>
        {t('No rows match.')}
      </Text>
    );
  else
    body = (
      <Box opacity={state.phase === 'running' ? 0.55 : 1} transition="opacity 0.2s">
        {/* the header row and at most ten rows of 32 px */}
        <ResultsTable columns={result.columns} rows={result.rows} smartDates={smartDates} height={`${36 + Math.min(result.rows.length, 10) * 32 + 14}px`} />
      </Box>
    );

  return (
    <Box mt={2} border="1px solid" borderColor="lineColor" borderRadius="lg" overflow="hidden" bg="panelBg" data-testid="step-preview">
      <Text fontSize="2xs" color="faintText" px={2} pt={1.5} pb={1} textTransform="uppercase" letterSpacing="0.06em" fontWeight={700}>
        {t('First rows after this step')}
      </Text>
      {body}
    </Box>
  );
}
