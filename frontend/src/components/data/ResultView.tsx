import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Badge, Box, Button, ButtonGroup, Drawer, DrawerBody, DrawerCloseButton, DrawerContent,
  DrawerHeader, DrawerOverlay, Flex, HStack, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Select, Spinner, Switch, Text,
  Tooltip, useColorMode, useDisclosure, useToast,
} from '@chakra-ui/react';
import { apiErrorMessageAsync, http } from '../../api';
import { ChartIcon, ChevronDownIcon, DownloadIcon, SettingsIcon, TableIcon } from '../../icons';
import { buildCsvFromArrays, downloadText, saveBlob, safeFilename } from '../../lib/csv';
import type { CsvDelimiter } from '../../lib/csv';
import type { RunState } from '../../query/useQueryRun';
import { seriesData } from '../../viz/data';
import { chartTheme } from '../../viz/palette';
import { effectiveViz } from '../../viz/state';
import type { VizState } from '../../viz/state';
import { CHART_TYPES } from '../../viz/types';
import type { ChartType, VizSpec } from '../../viz/types';
import type { EChartHandle } from '../viz/EChart';
import { Visualization } from '../viz/Visualization';
import { VizSettings } from '../viz/VizSettings';
import { ResultsTable } from './ResultsTable';

interface ResultViewProps {
  state: RunState;
  onCancel: () => void;
  smartDates: boolean;
  onSmartDates: (value: boolean) => void;
  filename: string;
  empty?: ReactNode; // shown before the first run
  height?: string | number;
  viz?: VizState;                        // omit to show only the table
  onVizChange?: (viz: VizState) => void;
}

const ECHARTS_TYPES: ChartType[] = ['bar', 'line', 'area', 'combo', 'pie', 'scatter', 'histogram', 'heatmap', 'funnel', 'gauge'];

/** Status line (rows, time, cached, cut off), errors, export and the results grid. */
export function ResultView({ state, onCancel, smartDates, onSmartDates, filename, empty, height = '100%', viz, onVizChange }: ResultViewProps) {
  const { result } = state;
  const running = state.phase === 'running';
  const toast = useToast();
  const settings = useDisclosure();
  const chartRef = useRef<EChartHandle | null>(null);
  const { colorMode } = useColorMode();

  const effective = useMemo(() => (viz && result ? effectiveViz(viz, result) : null), [viz, result]);
  const showChart = !!viz && viz.mode === 'chart' && !!effective;
  const spec = effective?.spec;
  const seriesNames = useMemo(() => {
    if (!result || !spec) return [];
    return spec.breakout ? seriesData(result, spec).series.map((s) => s.name) : (spec.series ?? []).map((s) => s.y);
  }, [result, spec]);

  const setSpec = (next: VizSpec) => onVizChange?.({ mode: 'chart', spec: next });
  const name = safeFilename(filename);

  const exportCsv = (delimiter: CsvDelimiter) => {
    if (!result) return;
    downloadText(`${name}.csv`, buildCsvFromArrays(result.columns.map((c) => c.name), result.rows, delimiter));
  };

  const exportXlsx = async () => {
    if (!state.taskId) return;
    try {
      const res = await http.get<Blob>(`/api/query/tasks/${state.taskId}/export.xlsx`, { responseType: 'blob' });
      saveBlob(`${name}.xlsx`, res.data);
    } catch (error) {
      toast({ title: 'Excel export failed', description: await apiErrorMessageAsync(error, 'Run the query again and retry'), status: 'error' });
    }
  };

  const exportImage = (kind: 'png' | 'svg') => {
    const handle = chartRef.current;
    if (!handle) return;
    if (kind === 'png') {
      const url = handle.png(chartTheme(colorMode === 'dark' ? 'dark' : 'light').surface);
      if (url) {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${name}.png`;
        link.click();
      }
    } else {
      const svg = handle.svg();
      if (svg) saveBlob(`${name}.svg`, new Blob([svg], { type: 'image/svg+xml' }));
    }
  };

  return (
    <Flex direction="column" h={height} minH={0}>
      <Flex align="center" gap={3} px={3} py={2} borderBottom="1px solid" borderColor="lineColor" wrap="wrap" minH="44px">
        {viz && onVizChange && (
          <ButtonGroup size="xs" isAttached>
            <Button variant={viz.mode === 'table' ? 'brand' : 'subtle'} leftIcon={<TableIcon boxSize={3.5} />} onClick={() => onVizChange({ ...viz, mode: 'table' })} data-testid="view-table">
              Table
            </Button>
            <Button variant={viz.mode === 'chart' ? 'brand' : 'subtle'} leftIcon={<ChartIcon boxSize={3.5} />} onClick={() => onVizChange({ ...viz, mode: 'chart' })} data-testid="view-chart">
              Chart
            </Button>
          </ButtonGroup>
        )}
        {showChart && spec && (
          <HStack spacing={1.5}>
            <Select size="xs" w="130px" value={spec.type} onChange={(e) => setSpec({ ...spec, type: e.target.value as ChartType })} aria-label="Chart type" data-testid="chart-type">
              {CHART_TYPES.map((c) => (
                <option key={c.type} value={c.type}>
                  {c.label}
                </option>
              ))}
            </Select>
            <Button size="xs" variant="subtle" leftIcon={<SettingsIcon boxSize={3.5} />} onClick={settings.onOpen} data-testid="chart-settings">
              Settings
            </Button>
            {effective?.auto ? (
              <Tooltip label={effective.stale ? 'The question changed, so the chart was chosen again automatically' : 'Chosen from the shape of the result; change anything to keep your own'} hasArrow>
                <Badge bg="chipBg" color="mutedText">auto</Badge>
              </Tooltip>
            ) : (
              <Button size="xs" variant="ghost" onClick={() => onVizChange?.({ mode: 'chart', spec: null })}>
                Reset
              </Button>
            )}
          </HStack>
        )}
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
              Download
            </MenuButton>
            <MenuList fontSize="sm">
              <MenuItem onClick={() => exportCsv(';')}>CSV for Excel (semicolon)</MenuItem>
              <MenuItem onClick={() => exportCsv(',')}>CSV standard (comma)</MenuItem>
              <MenuItem onClick={() => void exportXlsx()} isDisabled={!state.taskId} data-testid="export-xlsx">
                Excel workbook (.xlsx)
              </MenuItem>
              {showChart && spec && ECHARTS_TYPES.includes(spec.type) && (
                <>
                  <MenuDivider />
                  <MenuItem onClick={() => exportImage('png')} data-testid="export-png">Chart as PNG</MenuItem>
                  <MenuItem onClick={() => exportImage('svg')} data-testid="export-svg">Chart as SVG</MenuItem>
                </>
              )}
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
            showChart && spec ? (
              <Visualization result={result} viz={spec} smartDates={smartDates} chartRef={chartRef} />
            ) : (
              <ResultsTable columns={result.columns} rows={result.rows} smartDates={smartDates} />
            )
          ) : (
            <Flex h="100%" align="center" justify="center" color="mutedText" fontSize="sm" p={6}>
              No rows match.
            </Flex>
          )
        ) : (
          !running && !state.error && (empty ?? null)
        )}
      </Box>
      {result && spec && onVizChange && (
        <Drawer isOpen={settings.isOpen} onClose={settings.onClose} placement="right" size="sm">
          <DrawerOverlay bg="blackAlpha.300" />
          <DrawerContent>
            <DrawerCloseButton />
            <DrawerHeader fontSize="md">Chart settings</DrawerHeader>
            <DrawerBody pb={8}>
              <VizSettings spec={spec} columns={result.columns} onChange={setSpec} seriesNames={seriesNames} />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
    </Flex>
  );
}
