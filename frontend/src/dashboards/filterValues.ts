// Changing dashboard filter values from the filter bar (M10). The bar hands out updates of the
// *current* values instead of a whole new set built from what it rendered: two quick changes (the
// start and the end of a date range) otherwise overwrite each other and the range loses its start.
import { shownValue, valuesFromSearch, valuesToSearch } from './logic.ts';
import type { FilterValue, FilterValues } from './logic.ts';
import type { DashFilter } from './types.ts';

export type FilterUpdate = (current: FilterValues) => FilterValues;

/** Set one filter's value. */
export const setFilterValue = (id: string, value: FilterValue): FilterUpdate => (current) => ({ ...current, [id]: value });

/** Set the start (0) or end (1) of a date range, keeping the other end as it is now (or its default). */
export const setRangeEnd = (f: DashFilter, index: 0 | 1, text: string): FilterUpdate => (current) => {
  const shown = shownValue(f, current);
  const pair = Array.isArray(shown) ? [shown[0] ?? '', shown[1] ?? ''] : ['', ''];
  pair[index] = text;
  return { ...current, [f.id]: pair };
};

/** Apply an update (or a whole set of values) to the filter values kept in a URL query. */
export function applyToSearch(update: FilterValues | FilterUpdate, search: URLSearchParams): URLSearchParams {
  const next = typeof update === 'function' ? update(valuesFromSearch(search)) : update;
  return valuesToSearch(next, search);
}
