import type { ReactNode } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, Flex, HStack, Menu, MenuButton, MenuItem, MenuList, Spinner,
  Switch, Text, Tooltip,
} from '@chakra-ui/react';
import { ChevronDownIcon, DownloadIcon } from '../../icons';
import { buildCsvFromArrays, downloadText, safeFilename } from '../../lib/csv';
import type { CsvDelimiter } from '../../lib/csv';
import type { RunState } from '../../query/useQueryRun';
import { ResultsTable } from './ResultsTable';

interface ResultViewProps {
  state: RunState;
  onCancel: () => void;
  smartDates: boolean;
  onSmartDates: (value: boolean) => void;
  filename: string;
  empty?: ReactNode; // shown before the first run
  height?: string | number;
}

/** Status line (rows, time, cached, cut off), errors, export and the results grid. */
export function ResultView({ state, onCancel, smartDates, onSmartDates, filename, empty, height = '100%' }: ResultViewProps) {
  const { result } = state;
  const running = state.phase === 'running';

  const exportCsv = (delimiter: CsvDelimiter) => {
    if (!result) return;
    downloadText(`${safeFilename(filename)}.csv`, buildCsvFromArrays(result.columns.map((c) => c.name), result.rows, delimiter));
  };

  return (
    <Flex direction="column" h={height} minH={0}>
      <Flex align="center" gap={3} px={3} py={2} borderBottom="1px solid" borderColor="lineColor" wrap="wrap" minH="44px">
        {running ? (
          <HStack spacing={2}>
            <Spinner size="sm" color="brand.300" />
            <Text fontSize="sm" color="mutedText">
              Running…
            </Text>
            <Button size="xs" variant="subtle" colorScheme="red" onClick={onCancel} data-testid="cancel-query">
              Stop
            </Button>
          </HStack>
        ) : result ? (
          <HStack spacing={2} fontSize="sm" color="mutedText" data-testid="result-stats">
            <Text>
              <Text as="span" fontWeight={700} color="bodyText">
                {result.stats.row_count.toLocaleString()}
              </Text>{' '}
              row{result.stats.row_count === 1 ? '' : 's'}
            </Text>
            <Text>· {result.stats.duration_ms.toLocaleString()} ms</Text>
            {result.stats.cached && (
              <Tooltip label="Same question within the last minute: the saved result was reused" hasArrow>
                <Badge bg="chipBg" color="mutedText">
                  cached
                </Badge>
              </Tooltip>
            )}
            {result.stats.truncated && (
              <Tooltip label="There are more rows. Raise the row limit or add filters." hasArrow>
                <Badge colorScheme="orange">first {result.stats.row_count.toLocaleString()} rows</Badge>
              </Tooltip>
            )}
            {state.status === 'cancelled' && <Badge colorScheme="gray">stopped — showing the previous result</Badge>}
          </HStack>
        ) : (
          <Text fontSize="sm" color="faintText">
            {state.status === 'cancelled' ? 'Stopped.' : 'No result yet'}
          </Text>
        )}
        <Box flex={1} />
        <HStack spacing={2}>
          <Tooltip label="Show dates stored as text (31.01.2026) or unix time as dates" hasArrow>
            <HStack spacing={1.5}>
              <Switch size="sm" isChecked={smartDates} onChange={(e) => onSmartDates(e.target.checked)} id="smart-dates" />
              <Text as="label" htmlFor="smart-dates" fontSize="xs" color="mutedText">
                Smart dates
              </Text>
            </HStack>
          </Tooltip>
          <Menu>
            <MenuButton
              as={Button}
              size="xs"
              variant="subtle"
              leftIcon={<DownloadIcon boxSize={3.5} />}
              rightIcon={<ChevronDownIcon boxSize={3.5} />}
              isDisabled={!result || result.rows.length === 0}
            >
              CSV
            </MenuButton>
            <MenuList fontSize="sm">
              <MenuItem onClick={() => exportCsv(';')}>For Excel (semicolon)</MenuItem>
              <MenuItem onClick={() => exportCsv(',')}>Standard (comma)</MenuItem>
            </MenuList>
          </Menu>
        </HStack>
      </Flex>

      {state.error && (state.status === 'error' || state.status === 'failed') && (
        <Alert status="error" variant="left-accent" fontSize="sm" data-testid="query-error">
          <AlertIcon />
          <AlertDescription whiteSpace="pre-wrap">{state.error}</AlertDescription>
        </Alert>
      )}

      <Box flex={1} minH={0} opacity={running && result ? 0.55 : 1} transition="opacity 0.2s">
        {result ? (
          result.rows.length > 0 ? (
            <ResultsTable columns={result.columns} rows={result.rows} smartDates={smartDates} />
          ) : (
            <Flex h="100%" align="center" justify="center" color="mutedText" fontSize="sm" p={6}>
              No rows match.
            </Flex>
          )
        ) : (
          !running && !state.error && (empty ?? null)
        )}
      </Box>
    </Flex>
  );
}
