import { Button, ButtonGroup, Flex, IconButton, VStack } from '@chakra-ui/react';
import { PlusIcon, XIcon } from '../../icons';
import type { OrderBy } from '../../query/types';
import { ColumnSelect } from './ColumnSelect';
import type { PickOption } from './ColumnSelect';

interface SortEditorProps {
  order: OrderBy[];
  options: PickOption[];
  onChange: (order: OrderBy[]) => void;
}

export function SortEditor({ order, options, onChange }: SortEditorProps) {
  const set = (i: number, o: OrderBy | null) => onChange(o === null ? order.filter((_, k) => k !== i) : order.map((x, k) => (k === i ? o : x)));
  return (
    <VStack align="stretch" spacing={2}>
      {order.map((o, i) => (
        <Flex key={i} gap={2} align="center" data-testid="sort-row">
          <ColumnSelect options={options} value={o.ref || undefined} onChange={(ref) => set(i, { ...o, ref })} maxW="240px" aria-label="Sort by" />
          <ButtonGroup size="xs" isAttached>
            <Button variant={o.dir === 'asc' ? 'brand' : 'subtle'} onClick={() => set(i, { ...o, dir: 'asc' })}>
              Ascending
            </Button>
            <Button variant={o.dir === 'desc' ? 'brand' : 'subtle'} onClick={() => set(i, { ...o, dir: 'desc' })}>
              Descending
            </Button>
          </ButtonGroup>
          <IconButton aria-label="Remove sort" size="xs" variant="ghost" icon={<XIcon boxSize={3} />} onClick={() => set(i, null)} />
        </Flex>
      ))}
      <Button size="xs" variant="subtle" leftIcon={<PlusIcon boxSize={3} />} alignSelf="flex-start" onClick={() => onChange([...order, { ref: '', dir: 'asc' }])} isDisabled={options.length === 0}>
        Sort
      </Button>
    </VStack>
  );
}
