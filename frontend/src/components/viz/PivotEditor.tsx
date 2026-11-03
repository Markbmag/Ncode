import { useState } from 'react';
import type { DragEvent, ReactNode } from 'react';
import { Box, Checkbox, Flex, IconButton, Menu, MenuButton, MenuDivider, MenuItem, MenuList, Select, Text, Tooltip } from '@chakra-ui/react';
import type { ResultColumn } from '../../api';
import { MoreIcon, PlusIcon } from '../../icons';
import { columnDescription, columnTitle } from '../../viz/labels';
import { PIVOT_AGGS, PIVOT_AREAS, freeFields, placeField, setAgg } from '../../viz/pivot';
import type { PivotArea, PivotDrag } from '../../viz/pivot';
import type { AggregateFn, PivotSpec } from '../../viz/types';
import { t as tr } from '../../i18n/index.ts';

const MIME = 'application/x-ncode-pivot';

const AREA_LABEL: Record<PivotArea, string> = { rows: tr('Rows'), columns: tr('Columns'), values: tr('Values') };
const AREA_HINT: Record<PivotArea, string> = {
  rows: tr('One row for each value, going down'),
  columns: tr('One column for each value, going across'),
  values: tr('The numbers in the cells: summed, counted or averaged'),
};

interface Props {
  spec: PivotSpec;
  columns: ResultColumn[];
  onChange: (spec: PivotSpec) => void;
}

/**
 * The pivot table's layout like Excel's field list (M12): the result's columns, and the Rows,
 * Columns and Values areas. Drag a column between them, or click it to choose where it goes.
 */
export function PivotEditor({ spec, columns, onChange }: Props) {
  const [over, setOver] = useState<PivotArea | 'fields' | null>(null);
  const colOf = (name: string) => columns.find((c) => c.name === name);
  const move = (drag: PivotDrag, to: PivotArea | 'fields', at?: number) => onChange(placeField(spec, drag, to, at, columns));

  const zone = (to: PivotArea | 'fields', at?: number) => ({
    onDragOver: (e: DragEvent) => {
      if (!e.dataTransfer.types.includes(MIME)) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setOver(to);
    },
    onDragLeave: () => setOver((o) => (o === to ? null : o)),
    onDrop: (e: DragEvent) => {
      const raw = e.dataTransfer.getData(MIME);
      setOver(null);
      if (!raw) return;
      e.preventDefault();
      e.stopPropagation();
      move(JSON.parse(raw) as PivotDrag, to, at);
    },
  });

  const chip = (drag: PivotDrag, extra?: ReactNode) => {
    const col = colOf(drag.name);
    const title = columnTitle(col, drag.name);
    const area = drag.from;
    const list = area === 'rows' ? spec.rows : area === 'columns' ? spec.columns : area === 'values' ? spec.values : null;
    return (
      <Flex
        key={`${area}-${drag.index}-${drag.name}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(MIME, JSON.stringify(drag));
          e.dataTransfer.effectAllowed = 'move';
        }}
        {...(area !== 'fields' ? zone(area, drag.index) : {})}
        align="center"
        gap={1}
        pl={2}
        pr={0.5}
        py={0.5}
        bg="chipBg"
        border="1px solid"
        borderColor="lineColor"
        borderRadius="md"
        cursor="grab"
        maxW="100%"
        data-testid={`pivot-chip-${area}-${drag.name}`}
      >
        <Tooltip label={columnDescription(col) ?? undefined} hasArrow openDelay={400}>
          <Text fontSize="xs" noOfLines={1}>
            {title}
          </Text>
        </Tooltip>
        {extra}
        <Menu isLazy placement="bottom-end">
          <MenuButton as={IconButton} size="xs" variant="ghost" minW={5} h={5} icon={<MoreIcon boxSize={3} />} aria-label={tr('Where “{name}” goes', { name: title })} data-testid={`pivot-menu-${area}-${drag.name}`} />
          <MenuList fontSize="sm" zIndex={20}>
            {PIVOT_AREAS.filter((a) => a !== area || a === 'values').map((a) => (
              <MenuItem
                key={a}
                // in Values once more: e.g. the count next to the sum
                onClick={() => (a === area ? move({ name: drag.name, from: 'fields', index: 0 }, a) : move(drag, a))}
                data-testid={`pivot-move-${a}`}
              >
                {a === area ? tr('Add to {area} once more', { area: AREA_LABEL[a] }) : area === 'fields' ? tr('Add to {area}', { area: AREA_LABEL[a] }) : tr('Move to {area}', { area: AREA_LABEL[a] })}
              </MenuItem>
            ))}
            {list && list.length > 1 && (
              <>
                <MenuDivider />
                <MenuItem isDisabled={drag.index === 0} onClick={() => move(drag, area as PivotArea, drag.index - 1)}>
                  {area === 'columns' ? tr('Move left') : tr('Move up')}
                </MenuItem>
                <MenuItem isDisabled={drag.index === list.length - 1} onClick={() => move(drag, area as PivotArea, drag.index + 2)}>
                  {area === 'columns' ? tr('Move right') : tr('Move down')}
                </MenuItem>
              </>
            )}
            {area !== 'fields' && (
              <>
                <MenuDivider />
                <MenuItem onClick={() => move(drag, 'fields')} data-testid="pivot-remove">
                  {tr('Remove from the pivot')}
                </MenuItem>
              </>
            )}
          </MenuList>
        </Menu>
      </Flex>
    );
  };

  const add = (area: PivotArea) => {
    const taken = new Set(area === 'values' ? [] : area === 'rows' ? spec.rows : spec.columns);
    const options = columns.filter((c) => !taken.has(c.name));
    return (
      <Menu isLazy>
        <Tooltip label={tr('Add a column to {area}', { area: AREA_LABEL[area] })} hasArrow openDelay={300}>
          <MenuButton as={IconButton} size="xs" variant="ghost" icon={<PlusIcon boxSize={3} />} aria-label={tr('Add a column to {area}', { area: AREA_LABEL[area] })} data-testid={`pivot-add-${area}`} isDisabled={options.length === 0} />
        </Tooltip>
        <MenuList fontSize="sm" maxH="320px" overflowY="auto" zIndex={20}>
          {options.map((c) => (
            <MenuItem key={c.name} onClick={() => move(fromWhere(spec, c.name), area)}>
              {columnTitle(c)}
            </MenuItem>
          ))}
        </MenuList>
      </Menu>
    );
  };

  const box = (to: PivotArea | 'fields', children: ReactNode, empty: string) => (
    <Box
      {...zone(to)}
      minH="40px"
      p={1.5}
      border="1px dashed"
      borderColor={over === to ? 'brand.400' : 'lineColor'}
      bg={over === to ? 'chipBg' : undefined}
      borderRadius="md"
      data-testid={to === 'fields' ? 'pivot-fields' : `pivot-area-${to}`}
    >
      <Flex gap={1.5} wrap="wrap">
        {children}
        {!children || (Array.isArray(children) && children.length === 0) ? (
          <Text fontSize="xs" color="faintText" px={1} py={0.5}>
            {empty}
          </Text>
        ) : null}
      </Flex>
    </Box>
  );

  const free = freeFields(spec, columns);
  return (
    <Box data-testid="pivot-editor">
      <Text fontSize="xs" color="mutedText" mb={2}>
        {tr('Drag columns into Rows, Columns and Values, or use the … of a column to choose where it goes.')}
      </Text>
      <Text fontSize="xs" fontWeight={600} color="mutedText" mb={1}>
        {tr('Columns of the result')}
      </Text>
      {box('fields', free.map((c) => chip({ name: c.name, from: 'fields', index: 0 })), tr('All columns are in use.'))}
      {PIVOT_AREAS.map((area) => (
        <Box key={area} mt={3}>
          <Flex align="center" gap={1} mb={1}>
            <Text fontSize="sm" fontWeight={600}>
              {AREA_LABEL[area]}
            </Text>
            <Text fontSize="xs" color="faintText" flex={1} noOfLines={1}>
              {AREA_HINT[area]}
            </Text>
            {add(area)}
          </Flex>
          {area === 'values'
            ? box(
                area,
                spec.values.map((v, i) =>
                  chip(
                    { name: v.column, from: 'values', index: i },
                    <Select
                      size="xs"
                      w="auto"
                      variant="unstyled"
                      fontWeight={600}
                      value={v.agg}
                      onChange={(e) => onChange(setAgg(spec, i, e.target.value as AggregateFn))}
                      onMouseDown={(e) => e.stopPropagation()}
                      aria-label={tr('How to total {name}', { name: columnTitle(colOf(v.column), v.column) })}
                      data-testid={`pivot-agg-${i}`}
                    >
                      {PIVOT_AGGS.map((a) => (
                        <option key={a} value={a}>
                          {tr(a)}
                        </option>
                      ))}
                    </Select>,
                  ),
                ),
                tr('Drop a number here, e.g. a sum.'),
              )
            : box(area, (area === 'rows' ? spec.rows : spec.columns).map((name, i) => chip({ name, from: area, index: i })), tr('Drop a column here.'))}
        </Box>
      ))}
      <Checkbox mt={3} size="sm" isChecked={spec.totals !== false} onChange={(e) => onChange({ ...spec, totals: e.target.checked })} data-testid="pivot-totals">
        {tr('Totals')}
      </Checkbox>
    </Box>
  );
}

/** Where a column is now, as a drag from there (picking it from a "+" list moves it like dragging). */
function fromWhere(spec: PivotSpec, name: string): PivotDrag {
  const r = spec.rows.indexOf(name);
  if (r >= 0) return { name, from: 'rows', index: r };
  const c = spec.columns.indexOf(name);
  if (c >= 0) return { name, from: 'columns', index: c };
  return { name, from: 'fields', index: 0 };
}
