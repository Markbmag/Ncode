import {
  Box, Button, Flex, Input, Text,
} from '@chakra-ui/react';
import { Tooltip } from '../components/Tooltip';
import { XIcon } from '../icons';
import { ValuePicker } from '../components/query/ValuePicker';
import { useSchema } from '../query/useSchema';
import { valueSourceOf } from '../query/valuePicker';
import type { QuerySpec } from '../query/types';
import { pickerColumn, shownValue } from './logic';
import type { FilterValues } from './logic';
import { setFilterValue, setRangeEnd } from './filterValues';
import type { FilterUpdate } from './filterValues';
import type { DashCard, DashFilter } from './types';
import { t } from '../i18n/index.ts';

interface Props {
  filters: DashFilter[];
  values: FilterValues;
  // an update of the current values (two quick changes must not overwrite each other), or {} to reset
  onChange: (update: FilterUpdate | FilterValues) => void;
  /** the dashboard's cards: a list or text filter offers the values of the first card's column it is connected to (M12) */
  cards?: DashCard[];
  /** M15: one filter under the other, full width and larger (the phone's filter sheet) */
  stacked?: boolean;
}

/** The dashboard's filters; changing one re-runs the cards it is mapped to. Values live in the URL. */
export function FilterBar({ filters, values, onChange, cards, stacked = false }: Props) {
  if (filters.length === 0) return null;
  const changed = filters.some((f) => values[f.id] !== undefined);
  const size = stacked ? 'md' : 'sm';
  const width = (w: string) => (stacked ? '100%' : w);
  return (
    <Flex
      gap={4}
      wrap="wrap"
      direction={stacked ? 'column' : 'row'}
      align={stacked ? 'stretch' : 'flex-end'}
      bg={stacked ? undefined : 'panelBg'}
      border={stacked ? undefined : '1px solid'}
      borderColor="lineColor"
      borderRadius="xl"
      px={stacked ? 0 : 4}
      py={stacked ? 0 : 3}
      data-testid="filter-bar"
    >
      {filters.map((f) => {
        const shown = shownValue(f, values);
        const picker = cards ? pickerColumn(f, cards) : null;
        return (
          <Box key={f.id}>
            <Text fontSize={stacked ? 'sm' : '2xs'} fontWeight={700} color="faintText" textTransform={stacked ? undefined : 'uppercase'} letterSpacing={stacked ? undefined : '0.06em'} mb={1}>
              {f.label}
              {f.required && ' *'}
            </Text>
            {f.type === 'date_range' ? (
              <Flex gap={stacked ? 2 : 1} direction={stacked ? 'column' : 'row'}>
                {[0, 1].map((i) => {
                  const pair = Array.isArray(shown) ? shown : ['', ''];
                  return (
                    <Input
                      key={i}
                      size={size}
                      type="date"
                      w={stacked ? undefined : '150px'}
                      minW={0}
                      value={pair[i] ?? ''}
                      onChange={(e) => onChange(setRangeEnd(f, i as 0 | 1, e.target.value))}
                      aria-label={i === 0 ? t('{label} from', { label: f.label }) : t('{label} to', { label: f.label })}
                      data-testid={`filter-${f.id}-${i === 0 ? 'from' : 'to'}`}
                    />
                  );
                })}
              </Flex>
            ) : picker ? (
              <PickedFilter filter={f} shown={shown} picker={picker} onChange={onChange} stacked={stacked} />
            ) : (
              <Input
                size={size}
                w={width(f.type === 'category' ? '220px' : '170px')}
                type={f.type === 'date' ? 'date' : f.type === 'number' ? 'number' : 'text'}
                placeholder={f.type === 'category' ? 'a, b, c' : t('any')}
                value={Array.isArray(shown) ? shown.join(', ') : shown}
                onChange={(e) => onChange(setFilterValue(f.id, e.target.value))}
                aria-label={f.label}
                data-testid={`filter-${f.id}`}
              />
            )}
          </Box>
        );
      })}
      {changed && (
        <Tooltip label={t('Back to the default values')} hasArrow>
          <Button size={size} variant="ghost" alignSelf={stacked ? 'flex-start' : undefined} leftIcon={<XIcon boxSize={3} />} onClick={() => onChange({})}>
            {t('Reset')}
          </Button>
        </Tooltip>
      )}
    </Flex>
  );
}

/** A list or text filter with the values of the column it narrows (the first card connected to it). */
function PickedFilter({ filter, shown, picker, onChange, stacked = false }: {
  stacked?: boolean;
  filter: DashFilter;
  shown: string | string[];
  picker: NonNullable<ReturnType<typeof pickerColumn>>;
  onChange: (update: FilterUpdate) => void;
}) {
  const schema = useSchema(picker.connection);
  const spec = picker.spec as unknown as QuerySpec;
  const source = schema.data ? valueSourceOf(spec, { tables: schema.data.tables, relationships: schema.data.relationships }, picker.ref) : null;
  const multiple = filter.type === 'category';
  const w = stacked ? '100%' : multiple ? '220px' : '170px';
  if (!source)
    return (
      <Input
        size={stacked ? 'md' : 'sm'}
        w={w}
        placeholder={multiple ? 'a, b, c' : t('any')}
        value={Array.isArray(shown) ? shown.join(', ') : shown}
        onChange={(e) => onChange(setFilterValue(filter.id, e.target.value))}
        aria-label={filter.label}
        data-testid={`filter-${filter.id}`}
      />
    );
  return (
    <ValuePicker
      connection={source.connection}
      table={source.table}
      column={source.column}
      value={multiple ? (Array.isArray(shown) ? shown : shown ? [shown] : []) : Array.isArray(shown) ? shown.join(', ') : shown}
      onChange={(v) => onChange(setFilterValue(filter.id, Array.isArray(v) ? v.map(String) : String(v ?? '')))}
      multiple={multiple}
      w={w}
      size={stacked ? 'md' : 'sm'}
      placeholder={multiple ? 'a, b, c' : t('any')}
      aria-label={filter.label}
      testId={`filter-${filter.id}`}
    />
  );
}
