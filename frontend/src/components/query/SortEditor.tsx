import { Button, ButtonGroup, Flex, IconButton, VStack } from '@chakra-ui/react';
import type { ColumnType } from '../../api';
import { PlusIcon, XIcon } from '../../icons';
import type { OrderBy } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';
import { t } from '../../i18n/index.ts';

interface SortEditorProps {
  order: OrderBy[];
  options: PickOption[];
  onChange: (order: OrderBy[]) => void;
}

type Kind = 'number' | 'date' | 'text';
const kindOf = (type: ColumnType | undefined): Kind =>
  type === 'number' ? 'number' : type === 'date' || type === 'datetime' || type === 'time' ? 'date' : 'text';

/** The two directions in plain words, the usual one first (M11): biggest / newest first, A → Z. */
function directions(kind: Kind): { dir: OrderBy['dir']; label: string; hint: string }[] {
  if (kind === 'number')
    return [
      { dir: 'desc', label: t('Biggest first'), hint: t('Descending') },
      { dir: 'asc', label: t('Smallest first'), hint: t('Ascending') },
    ];
  if (kind === 'date')
    return [
      { dir: 'desc', label: t('Newest first'), hint: t('Descending') },
      { dir: 'asc', label: t('Oldest first'), hint: t('Ascending') },
    ];
  return [
    { dir: 'asc', label: 'A → Z', hint: t('Ascending') },
    { dir: 'desc', label: 'Z → A', hint: t('Descending') },
  ];
}

export function SortEditor({ order, options, onChange }: SortEditorProps) {
  const set = (i: number, o: OrderBy | null) => onChange(o === null ? order.filter((_, k) => k !== i) : order.map((x, k) => (k === i ? o : x)));
  const typeOf = (ref: string) => options.find((o) => o.ref === ref)?.type;
  // a new row starts the usual way for its column: numbers and dates biggest / newest first
  const pick = (i: number, o: OrderBy, ref: string) => set(i, { ...o, ref, dir: o.ref ? o.dir : kindOf(typeOf(ref)) === 'text' ? 'asc' : 'desc' });
  return (
    <VStack align="stretch" spacing={2}>
      {order.map((o, i) => (
        <Flex key={i} gap={2} align="center" wrap="wrap" data-testid="sort-row">
          <ColumnSelect options={options} value={o.ref || undefined} onChange={(ref) => pick(i, o, ref)} maxW="240px" aria-label={t('Sort by')} />
          <ButtonGroup size="xs" isAttached>
            {directions(kindOf(typeOf(o.ref))).map((d) => (
              <Button key={d.dir} variant={o.dir === d.dir ? 'brand' : 'subtle'} onClick={() => set(i, { ...o, dir: d.dir })} title={d.hint} data-testid={`sort-${d.dir}`}>
                {d.label}
              </Button>
            ))}
          </ButtonGroup>
          <IconButton aria-label={t('Remove sort')} size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(i, null)} />
        </Flex>
      ))}
      <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange([...order, { ref: '', dir: 'asc' }])} isDisabled={options.length === 0}>
        {t('Sort')}
      </Button>
    </VStack>
  );
}
