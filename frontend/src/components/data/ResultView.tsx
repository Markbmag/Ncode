import { useMemo, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  Alert, AlertDescription, AlertIcon, Box, Button, ButtonGroup, Drawer, DrawerBody, DrawerCloseButton, DrawerContent,
  DrawerHeader, DrawerOverlay, Flex, HStack, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuItemOption, MenuList, MenuOptionGroup,
  Select, Spinner, Text, Tooltip, useColorMode, useDisclosure, useToast,
} from '@chakra-ui/react';
import { apiErrorMessageAsync, http } from '../../api';
import { ChartIcon, ChevronDownIcon, DownloadIcon, MoreIcon, RefreshIcon, SettingsIcon, TableIcon } from '../../icons';
import { buildCsvFromArrays, downloadText, saveBlob, safeFilename } from '../../lib/csv';
import type { CsvDelimiter } from '../../lib/csv';
import type { RunState } from '../../query/useQueryRun';
import { seriesData } from '../../viz/data';
import { chartTheme } from '../../viz/palette';
import { effectiveViz, shownMode, startingChart } from '../../viz/state';
import type { VizState } from '../../viz/state';
import { CHART_TYPES } from '../../viz/types';
import type { ChartType, VizSpec } from '../../viz/types';
import type { EChartHandle } from '../viz/EChart';
import { Visualization } from '../viz/Visualization';
import { VizSettings } from '../viz/VizSettings';
import { ResultsTable } from './ResultsTable';
import { resultNotes } from './notes';
import { ResultProfileDrawer } from '../../analysis/ResultProfileDrawer';
import { locale, t, tn } from '../../i18n/index.ts';

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
  caption?: string | null;               // "what am I looking at", under the result (M11)
  rowLimit?: number | null;              // the question's own row limit: rows cut by it need no note
  onRefresh?: () => void;                // run again without the saved result
}

const ECHARTS_TYPES: ChartType[] = ['bar', 'line', 'area', 'combo', 'pie', 'scatter', 'histogram', 'heatmap', 'funnel', 'gauge'];

/** Status line (rows, time, cached, cut off), errors, export and the results grid. */
export function ResultView({ state, onCancel, smartDates, onSmartDates, filename, empty, height = '100%', viz, onVizChange, caption, rowLimit, onRefresh }: ResultViewProps) {
  const { result } = state;
  const running = state.phase === 'running';
  const toast = useToast();
  const settings = useDisclosure();
  const profile = useDisclosure();
  const chartRef = useRef<EChartHandle | null>(null);
  const { colorMode } = useColorMode();

  const effective = useMemo(() => (viz && result ? effectiveViz(viz, result) : null), [viz, result]);
  const mode = viz ? shownMode(viz, effective) : 'table';
  const showChart = mode === 'chart' && !!effective;
  // the automatic choice found nothing to draw: the Chart button explains instead of showing a table as "Chart"
  const autoTable = !!effective && effective.auto && effective.spec.type === 'table';
  const starting = useMemo(() => (autoTable && result ? startingChart(result) : null), [autoTable, result]);
  const nothingToChart = autoTable && !starting;
  // asking for a chart when the automatic choice is a table starts from bars the person can change
  const showAsChart = () => viz && onVizChange?.(autoTable && starting ? { mode: 'chart', spec: starting } : { ...viz, mode: 'chart' });
  const spec = effective?.spec;
  const seriesNames = useMemo(() => {
    if (!result || !spec) return [];
    return spec.breakout ? seriesData(result, spec).series.map((s) => s.name) : (spec.series ?? []).map((s) => s.y);
  }, [result, spec]);

  const setSpec = (next: VizSpec) => onVizChange?.({ mode: 'chart', spec: next });
  const notes = result && !running ? resultNotes(result.stats, { rowLimit, stopped: state.status === 'cancelled' }) : [];
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
      toast({ title: t('Excel export failed'), description: await apiErrorMessageAsync(error, t('Run the query again and retry')), status: 'error' });
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
      {/* one line at 1440 px in English and Russian (M11): the rarer tools sit in the "…" menu */}
      <Flex align="center" gap={2} px={3} py={2} borderBottom="1px solid" borderColor="lineColor" wrap={{ base: 'wrap', md: 'nowrap' }} minH="44px" data-testid="result-toolbar">
        {viz && onVizChange && (
          <ButtonGroup size="xs" isAttached>
            <Button variant={mode === 'table' ? 'brand' : 'subtle'} leftIcon={<TableIcon boxSize={3.5} />} onClick={() => onVizChange({ ...viz, mode: 'table' })} data-testid="view-table">
              {t('Table')}
            </Button>
            <Tooltip label={nothingToChart ? t('Nothing to draw: the result has no numbers. Summarise it first, for example a count per month') : undefined} hasArrow shouldWrapChildren={nothingToChart}>
              <Button variant={mode === 'chart' ? 'brand' : 'subtle'} leftIcon={<ChartIcon boxSize={3.5} />} onClick={showAsChart} isDisabled={nothingToChart} data-testid="view-chart">
                {t('Chart')}
              </Button>
            </Tooltip>
          </ButtonGroup>
        )}
        {showChart && spec && (
          <HStack spacing={1} flexShrink={0}>
            <Tooltip
              label={effective?.auto ? (effective.stale ? t('The question changed, so the chart was chosen again automatically') : t('Chosen from the shape of the result; change anything to keep your own')) : undefined}
              hasArrow
              openDelay={300}
            >
              <Select size="xs" w="120px" value={spec.type} onChange={(e) => setSpec({ ...spec, type: e.target.value as ChartType })} aria-label={t('Chart type')} data-testid="chart-type">
                {CHART_TYPES.map((c) => (
                  <option key={c.type} value={c.type}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </Tooltip>
            <Tooltip label={t('Colours, labels, axes, legend, goal line, number format')} hasArrow openDelay={400}>
              <Button size="xs" variant="subtle" leftIcon={<SettingsIcon boxSize={3.5} />} onClick={settings.onOpen} data-testid="chart-settings">
                {t('Customize')}
              </Button>
            </Tooltip>
            {!effective?.auto && (
              <Tooltip label={t('Back to the automatic chart')} hasArrow>
                <IconButton size="xs" variant="ghost" aria-label={t('Back to the automatic chart')} icon={<RefreshIcon boxSize={3.5} />} onClick={() => onVizChange?.({ mode: 'chart', spec: null })} data-testid="chart-reset" />
              </Tooltip>
            )}
          </HStack>
        )}
        {running ? (
          <HStack spacing={2}>
            <Spinner size="sm" color="brand.300" />
            <Text fontSize="sm" color="mutedText">
              {t('Running…')}
            </Text>
            <Button size="xs" variant="subtle" colorScheme="red" onClick={onCancel} data-testid="cancel-query">
              {t('Stop')}
            </Button>
          </HStack>
        ) : result ? (
          <Tooltip label={t('Took {ms} ms', { ms: result.stats.duration_ms.toLocaleString(locale()) })} hasArrow openDelay={300}>
            <Text fontSize="sm" color="mutedText" whiteSpace="nowrap" data-testid="result-stats">
              <Text as="span" fontWeight={700} color="bodyText">
                {result.stats.row_count.toLocaleString(locale())}
              </Text>{' '}
              {tn(result.stats.row_count, 'row', 'rows')}
            </Text>
          </Tooltip>
        ) : (
          <Text fontSize="sm" color="faintText">
            {state.status === 'cancelled' ? t('Stopped.') : t('No result yet')}
          </Text>
        )}
        <Box flex={1} />
        <HStack spacing={1.5} flexShrink={0}>
          <Menu>
            <MenuButton
              as={Button}
              size="xs"
              variant="subtle"
              leftIcon={<DownloadIcon boxSize={3.5} />}
              rightIcon={<ChevronDownIcon boxSize={3.5} />}
              isDisabled={!result || result.rows.length === 0}
            >
              {t('Download')}
            </MenuButton>
            <MenuList fontSize="sm">
              <MenuItem onClick={() => exportCsv(';')}>{t('CSV for Excel (semicolon)')}</MenuItem>
              <MenuItem onClick={() => exportCsv(',')}>{t('CSV standard (comma)')}</MenuItem>
              <MenuItem onClick={() => void exportXlsx()} isDisabled={!state.taskId} data-testid="export-xlsx">
                {t('Excel workbook (.xlsx)')}
              </MenuItem>
              {showChart && spec && ECHARTS_TYPES.includes(spec.type) && (
                <>
                  <MenuDivider />
                  <MenuItem onClick={() => exportImage('png')} data-testid="export-png">{t('Chart as PNG')}</MenuItem>
                  <MenuItem onClick={() => exportImage('svg')} data-testid="export-svg">{t('Chart as SVG')}</MenuItem>
                </>
              )}
            </MenuList>
          </Menu>
          <Menu closeOnSelect={false} placement="bottom-end">
            <Tooltip label={t('More options')} hasArrow>
              <MenuButton as={IconButton} size="xs" variant="subtle" aria-label={t('More options')} icon={<MoreIcon boxSize={4} />} data-testid="result-more" />
            </Tooltip>
            <MenuList fontSize="sm" maxW="320px">
              <MenuItem onClick={profile.onOpen} isDisabled={!result || result.rows.length === 0 || !state.taskId || running} closeOnSelect data-testid="profile-result">
                <Box>
                  <Text>{t('Explore the columns')}</Text>
                  <Text fontSize="xs" color="mutedText">
                    {t('Statistics per column: empty values, distinct values, ranges, distributions')}
                  </Text>
                </Box>
              </MenuItem>
              <MenuDivider />
              <MenuOptionGroup type="checkbox" value={smartDates ? ['smart'] : []} onChange={(v) => onSmartDates((Array.isArray(v) ? v : [v]).includes('smart'))}>
                <MenuItemOption value="smart" id="smart-dates" data-testid="smart-dates">
                  <Text>{t('Readable dates')}</Text>
                  <Text fontSize="xs" color="mutedText">
                    {t('Show dates stored as text (31.01.2026) or unix time as dates')}
                  </Text>
                </MenuItemOption>
              </MenuOptionGroup>
            </MenuList>
          </Menu>
        </HStack>
      </Flex>

      {notes.length > 0 && (
        <Flex px={3} py={1} gap={3} wrap="wrap" borderBottom="1px solid" borderColor="lineColor" fontSize="xs" color="mutedText" data-testid="result-notes">
          {notes.map((n) => (
            <HStack key={n.kind} spacing={1.5}>
              <Tooltip label={n.hint} hasArrow openDelay={200}>
                <Text color={n.kind === 'cut' ? 'orange.300' : undefined} data-testid={`result-note-${n.kind}`}>
                  {n.text}
                </Text>
              </Tooltip>
              {n.kind === 'saved' && onRefresh && !running && (
                <Button size="xs" variant="link" fontSize="xs" onClick={onRefresh} data-testid="result-refresh">
                  {t('Read the data again')}
                </Button>
              )}
            </HStack>
          ))}
        </Flex>
      )}

      {state.error && (state.status === 'error' || state.status === 'failed') && (
        <Alert status="error" variant="left-accent" fontSize="sm" data-testid="query-error">
          <AlertIcon />
          <AlertDescription whiteSpace="pre-wrap">
            {state.error}
            {state.errorDetails && state.errorDetails !== state.error && (
              <Box as="details" mt={1} fontSize="xs" color="gray.500" data-testid="query-error-details">
                <Box as="summary" cursor="pointer">{t('Details from the database')}</Box>
                <Box as="pre" whiteSpace="pre-wrap" fontFamily="mono" mt={1}>{state.errorDetails}</Box>
              </Box>
            )}
          </AlertDescription>
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
              {t('No rows match.')}
            </Flex>
          )
        ) : (
          !running && !state.error && (empty ?? null)
        )}
      </Box>
      {caption && (
        <Text px={3} py={1.5} borderTop="1px solid" borderColor="lineColor" fontSize="xs" color="mutedText" noOfLines={2} title={caption} data-testid="result-caption">
          {caption}
        </Text>
      )}
      {result && spec && onVizChange && (
        <Drawer isOpen={settings.isOpen} onClose={settings.onClose} placement="right" size="sm">
          <DrawerOverlay bg="blackAlpha.300" />
          <DrawerContent>
            <DrawerCloseButton />
            <DrawerHeader fontSize="md">{t('Chart settings')}</DrawerHeader>
            <DrawerBody pb={8}>
              <VizSettings spec={spec} columns={result.columns} onChange={setSpec} seriesNames={seriesNames} />
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      )}
      <ResultProfileDrawer taskId={state.taskId} isOpen={profile.isOpen} onClose={profile.onClose} />
    </Flex>
  );
}
