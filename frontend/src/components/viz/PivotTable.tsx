import { useMemo } from 'react';
import { Box, Table as CTable, Tbody, Td, Text, Th, Thead, Tr } from '@chakra-ui/react';
import type { Table } from '../../viz/data';
import { formatCell, formatNumber } from '../../viz/format';
import { withColumnFormats } from '../../viz/options';
import { effectivePivot, pivotGrid } from '../../viz/pivot';
import type { GridCell } from '../../viz/pivot';
import type { VizSpec } from '../../viz/types';
import { t } from '../../i18n/index.ts';

const MAX_COLS = 60;
const MAX_ROWS = 500;

/**
 * Rows × columns with sums (or other totals) and totals, computed in the browser, laid out like
 * Excel (src/viz/pivot.ts; the Excel export writes the same grid). Without a layout of its own it
 * starts from the default one: choosing "Pivot table" shows something at once.
 */
export function PivotTable({ table, viz }: { table: Table; viz: VizSpec }) {
  const spec = useMemo(() => effectivePivot(viz, table.columns), [viz, table.columns]);
  const formats = useMemo(() => withColumnFormats(viz, table).format ?? {}, [viz, table]);
  const grid = useMemo(() => pivotGrid(table, spec, { maxRows: MAX_ROWS, maxCols: MAX_COLS }), [table, spec]);
  if (spec.values.length === 0) {
    return (
      <Text p={4} fontSize="sm" color="mutedText">
        {t('Choose rows, columns and values in the chart settings.')}
      </Text>
    );
  }
  if (table.rows.length === 0) {
    return (
      <Text p={4} fontSize="sm" color="mutedText">
        {t('No rows to put into the pivot table.')}
      </Text>
    );
  }
  const typeOf = (name: string) => table.columns.find((c) => c.name === name)?.type ?? 'string';
  const text = (cell: GridCell): string => {
    if (cell.kind === 'title') return cell.text;
    if (cell.kind === 'key') return formatCell(cell.raw, typeOf(cell.field), cell.field, formats[cell.field]);
    if (cell.kind === 'number') {
      const v = spec.values[cell.v];
      return cell.value === null ? '' : formatNumber(cell.value, v.agg === 'count' ? {} : (formats[v.column] ?? {}));
    }
    return '';
  };
  const lastBody = grid.body.length - 1;

  return (
    <Box h="100%" overflow="auto" data-testid="pivot">
      <CTable size="sm" sx={{ fontVariantNumeric: 'tabular-nums' }}>
        <Thead position="sticky" top={0} bg="chipBg" zIndex={1}>
          {grid.header.map((row, r) => (
            <Tr key={r}>
              {row.map((cell, c) => (
                <Th
                  key={c}
                  colSpan={'span' in cell ? cell.span : undefined}
                  isNumeric={c >= grid.left && cell.kind !== 'title'}
                  textAlign={c >= grid.left && cell.kind === 'title' && r > 0 ? 'right' : undefined}
                  textTransform="none"
                  color={cell.kind === 'key' ? 'bodyText' : undefined}
                  whiteSpace="nowrap"
                >
                  {text(cell)}
                </Th>
              ))}
            </Tr>
          ))}
        </Thead>
        <Tbody>
          {grid.body.map((row, r) => {
            const totals = grid.totalRow && r === lastBody;
            return (
              <Tr key={r} data-testid={totals ? 'pivot-total-row' : undefined}>
                {row.map((cell, c) => (
                  <Td
                    key={c}
                    isNumeric={cell.kind === 'number'}
                    fontWeight={totals || c < grid.left ? (totals ? 700 : 600) : cell.kind === 'number' && cell.total ? 600 : undefined}
                    whiteSpace="nowrap"
                  >
                    {text(cell)}
                  </Td>
                ))}
              </Tr>
            );
          })}
        </Tbody>
      </CTable>
      {(grid.cols > MAX_COLS || grid.rows > MAX_ROWS) && (
        <Text p={2} fontSize="xs" color="faintText">
          {t('Showing {rows} of {rowTotal} rows and {cols} of {colTotal} columns.', {
            rows: Math.min(grid.rows, MAX_ROWS), rowTotal: grid.rows, cols: Math.min(grid.cols, MAX_COLS), colTotal: grid.cols,
          })}
        </Text>
      )}
    </Box>
  );
}
