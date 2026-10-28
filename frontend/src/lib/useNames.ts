/**
 * Loads the data model names of a connection's tables (and, when asked, its schema for the
 * column names) so tableLabel / columnLabel from src/lib/names.ts find them; the component
 * re-renders when they arrive. Kept apart from names.ts, which the node tests import (the
 * HTTP client does not load outside the browser build).
 *
 *   const names = useNames(connection);
 *   names.table('orders')            -> "Заказы"
 *   names.column('orders', 'total')  -> "Сумма"    (useNames(connection, { columns: true }))
 */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { useSchema } from '../query/useSchema';
import { queryKeys } from './queryClient';
import { columnDescription, columnLabel, tableDescription, tableLabel, type NameMeta } from './names';

export function useTableNames(connection: string) {
  return useQuery({
    queryKey: queryKeys.tableNames(connection),
    queryFn: async () =>
      (await http.get<{ tables: Record<string, NameMeta> }>(`/api/semantic/${encodeURIComponent(connection)}/tables`)).data.tables,
    enabled: connection !== '',
    staleTime: 5 * 60_000,
  });
}

export interface Names {
  table: (table: string) => string;
  tableDescription: (table: string) => string | null;
  column: (table: string, column: string) => string;
  columnDescription: (table: string, column: string) => string | null;
}

/** Friendly names for one connection. `columns: true` also loads its schema (column names). */
export function useNames(connection: string, { columns = false }: { columns?: boolean } = {}): Names {
  useTableNames(connection); // subscribing is the point: the component re-renders when names arrive
  useSchema(columns ? connection : '');
  return {
    table: (table) => tableLabel(connection, table),
    tableDescription: (table) => tableDescription(connection, table),
    column: (table, column) => columnLabel(connection, table, column),
    columnDescription: (table, column) => columnDescription(connection, table, column),
  };
}
