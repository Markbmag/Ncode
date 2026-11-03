import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Flex, HStack, Input, Popover, PopoverAnchor, PopoverBody, PopoverContent, Portal, Spinner, Text } from '@chakra-ui/react';
import { useQuery } from '@tanstack/react-query';
import { http } from '../../api';
import type { ColumnType } from '../../api';
import { CheckIcon } from '../../icons';
import {
  labelsOf, listText, optionText, pickInList, recentValues, rememberValues, sameValue, searchTerm, typedValues,
} from '../../query/valuePicker';
import type { Scalar, ValueList, ValueOption, ValueSource } from '../../query/valuePicker';
import { t } from '../../i18n/index.ts';

export interface ValuePickerProps {
  connection: string;
  table: string;
  column: string;
  /** one value, or with `multiple` a list of values */
  value: unknown;
  /** a text (one value, as typed) or the value picked; with `multiple` a list (numbers stay numbers in a number column) */
  onChange: (value: unknown) => void;
  multiple?: boolean;
  type?: ColumnType;
  size?: 'xs' | 'sm' | 'md';
  w?: string;
  maxW?: string;
  placeholder?: string;
  'aria-label'?: string;
  testId?: string;
}

const LIST_STALE_MS = 60_000;

const valueListKey = (s: ValueSource, q: string) => ['values', s.connection, s.table, s.column, q] as const;

async function fetchValues(s: ValueSource, q: string): Promise<ValueList> {
  const res = await http.get<ValueList>(`/api/connections/${encodeURIComponent(s.connection)}/values`, {
    params: { table: s.table, column: s.column, ...(q ? { q } : {}) },
  });
  return res.data;
}

function useDebounced<T>(value: T, ms: number): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setCurrent(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return current;
}

const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : value === undefined || value === null || value === '' ? [] : [value]);

interface Item {
  value: Scalar;
  label?: string | null;
  count?: number;
  section: 'recent' | 'list' | 'typed';
}

/**
 * A box to type a value into, with the column's values to pick from (M12): the most frequent first,
 * with the related table's name for ids ("3 · Paint line"), a search inside long lists, several
 * values for "is one of" and the values picked lately in this column. Typing stays possible -
 * the list is a help, not a limit (it holds the 200 most frequent values).
 */
export function ValuePicker(props: ValuePickerProps) {
  const { connection, table, column, value, onChange, multiple = false, type, size = 'sm', testId } = props;
  const source = useMemo<ValueSource>(() => ({ connection, table, column, type }), [connection, table, column, type]);
  const external = multiple ? listText(asList(value)) : String(value ?? '');
  const [text, setText] = useState(external);
  const [shownExternal, setShownExternal] = useState(external);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState(false);
  const [active, setActive] = useState(-1);
  const changed = useRef(false);

  // a new value from outside (another filter row, the URL, a reset): show it - unless it is what was just typed
  if (external !== shownExternal) {
    setShownExternal(external);
    if ((multiple ? listText(typedValues(text, type)) : text) !== external) setText(external);
  }

  const chosen = multiple ? typedValues(text, type) : text.trim() ? [text.trim()] : [];
  const term = useDebounced(searchTerm(text, multiple, typed), 250);
  const base = useQuery({
    queryKey: valueListKey(source, ''),
    queryFn: () => fetchValues(source, ''),
    enabled: !!connection && (open || chosen.length > 0),
    staleTime: LIST_STALE_MS,
    retry: false,
  });
  const searched = useQuery({
    queryKey: valueListKey(source, term),
    queryFn: () => fetchValues(source, term),
    enabled: !!connection && open && term !== '' && !!base.data?.truncated,
    staleTime: LIST_STALE_MS,
    retry: false,
  });

  // a short list is searched here; a cut-off one asks the server (it searches the names too)
  const options: ValueOption[] = useMemo(() => {
    if (!base.data) return [];
    if (!term) return base.data.values;
    if (base.data.truncated) return searched.data?.values ?? [];
    const needle = term.toLowerCase();
    return base.data.values.filter((o) => optionText(o).toLowerCase().includes(needle));
  }, [base.data, searched.data, term]);

  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (!term) {
      for (const v of recentValues(source).slice(0, 5)) {
        const known = base.data?.values.find((o) => sameValue(o.value, v));
        out.push({ value: v, label: known?.label, count: known?.count, section: 'recent' });
      }
    }
    for (const o of options) out.push({ ...o, section: 'list' });
    if (term && !options.some((o) => sameValue(o.value, term) || (o.label ?? '').toLowerCase() === term.toLowerCase())) {
      out.push({ value: type === 'number' && !Number.isNaN(Number(term)) ? Number(term) : term, section: 'typed' });
    }
    return out;
    // recent values are read again whenever the list opens
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, term, source, base.data, open, type]);

  const emitText = (next: string) => {
    setText(next);
    changed.current = true;
    onChange(multiple ? typedValues(next, type) : next);
  };

  const pick = (item: Item) => {
    changed.current = false;
    rememberValues(source, [item.value]);
    if (multiple) {
      const values = pickInList(text, item.value, typed, type);
      setText(values.length ? `${listText(values)}, ` : '');
      onChange(values);
      setTyped(false);
      setActive(-1);
      return;
    }
    setText(String(item.value));
    onChange(item.value);
    setTyped(false);
    setOpen(false);
  };

  const close = () => {
    setOpen(false);
    setActive(-1);
    if (multiple) setText(listText(typedValues(text, type))); // no trailing comma left behind
    if (changed.current) rememberValues(source, chosen);
    changed.current = false;
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(items.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(-1, i - 1));
    } else if (e.key === 'Enter' && open && active >= 0 && items[active]) {
      e.preventDefault();
      pick(items[active]);
    } else if (e.key === 'Escape' && open) {
      e.stopPropagation();
      close();
    }
  };

  const names = labelsOf(chosen, base.data?.values);
  const loading = base.isFetching || searched.isFetching;
  const showList = open && (items.length > 0 || loading || !!base.data);
  const inList = (v: Scalar) => multiple && chosen.some((c) => sameValue(c, v));

  const row = (item: Item, i: number) => (
    <Flex
      key={`${item.section}:${String(item.value)}`}
      align="center"
      gap={2}
      px={2}
      py={1}
      borderRadius="md"
      cursor="pointer"
      bg={i === active ? 'panelHover' : undefined}
      _hover={{ bg: 'panelHover' }}
      onMouseDown={(e) => e.preventDefault()} // keep the focus in the box
      onClick={() => pick(item)}
      onMouseEnter={() => setActive(i)}
      role="option"
      aria-selected={inList(item.value) || (!multiple && sameValue(item.value, text.trim()))}
      data-testid="value-option"
    >
      {multiple && <CheckIcon boxSize={3} color="brand.400" visibility={inList(item.value) ? 'visible' : 'hidden'} />}
      <Text fontSize="sm" flex={1} noOfLines={1} title={optionText(item)}>
        {item.section === 'typed' ? t('Use “{value}”', { value: String(item.value) }) : optionText(item)}
      </Text>
      {item.count !== undefined && (
        <Text fontSize="xs" color="faintText" flexShrink={0}>
          {item.count.toLocaleString()}
        </Text>
      )}
    </Flex>
  );

  const recent = items.filter((i) => i.section === 'recent');
  return (
    <HStack spacing={2} minW={0} maxW={props.maxW}>
      <Popover isOpen={showList} autoFocus={false} returnFocusOnClose={false} closeOnBlur={false} placement="bottom-start" isLazy gutter={4}>
        <PopoverAnchor>
          <Input
            size={size}
            w={props.w ?? (multiple ? '260px' : '200px')}
            maxW={props.maxW}
            value={text}
            placeholder={props.placeholder ?? (multiple ? 'a, b, c' : t('value'))}
            aria-label={props['aria-label'] ?? (multiple ? t('Values, separated by commas') : t('Value'))}
            onChange={(e) => {
              setTyped(true);
              setOpen(true);
              setActive(-1);
              emitText(e.target.value);
            }}
            onFocus={() => {
              setTyped(false);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onBlur={close}
            onKeyDown={onKeyDown}
            autoComplete="off"
            role="combobox"
            aria-expanded={showList}
            data-testid={testId}
          />
        </PopoverAnchor>
        <Portal>
          <PopoverContent w="300px" maxH="320px" overflowY="auto" onMouseDown={(e) => e.preventDefault()} data-testid="value-picker-list" role="listbox">
            <PopoverBody p={1}>
              {recent.length > 0 && (
                <Text fontSize="2xs" fontWeight={700} color="faintText" textTransform="uppercase" letterSpacing="0.06em" px={2} pt={1}>
                  {t('Recent')}
                </Text>
              )}
              {items.map((item, i) => (
                <Box key={`${item.section}:${String(item.value)}:${i}`}>
                  {item.section === 'list' && i === recent.length && recent.length > 0 && <Box borderTop="1px solid" borderColor="lineColor" my={1} />}
                  {row(item, i)}
                </Box>
              ))}
              {loading && items.length === 0 && (
                <HStack px={2} py={2} color="mutedText" fontSize="sm">
                  <Spinner size="xs" />
                  <Text>{t('Loading values…')}</Text>
                </HStack>
              )}
              {!loading && base.data && items.length === 0 && (
                <Text fontSize="sm" color="faintText" px={2} py={2}>
                  {t('No values found')}
                </Text>
              )}
              {base.data?.truncated && !term && (
                <Text fontSize="xs" color="faintText" px={2} pt={1} pb={0.5}>
                  {t('The {n} most frequent values; type to find others', { n: base.data.values.length })}
                </Text>
              )}
            </PopoverBody>
          </PopoverContent>
        </Portal>
      </Popover>
      {names.length > 0 && (
        <Text fontSize="xs" color="mutedText" noOfLines={1} maxW="220px" title={names.join(', ')} data-testid="value-labels">
          {names.join(', ')}
        </Text>
      )}
    </HStack>
  );
}
