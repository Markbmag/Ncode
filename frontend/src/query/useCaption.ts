/**
 * Readable result names and the one-line caption of a saved question shown elsewhere (a dashboard
 * card, M11). Reads only the small data-model lists of its database (table names, column metadata,
 * metrics), never the whole schema, so a dashboard stays light.
 */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { metricDescription, metricName, tableLabel } from '../lib/names';
import type { NameMeta } from '../lib/names';
import { useTableNames } from '../lib/useNames';
import { useMetrics } from '../semantic/api';
import { captionOf } from './caption';
import { namerFromModel, outputLabels } from './outputs';
import type { ColumnName } from './outputs';
import type { QuerySpec } from './types';

type Fields = Record<string, Record<string, NameMeta>>;

/** Column metadata of a connection (GET /api/semantic/{c}/fields): only the columns an admin described. */
function useFieldNames(connection: string) {
  return useQuery({
    queryKey: ['semantic-fields', connection],
    queryFn: async () => (await http.get<{ fields: Fields }>(`/api/semantic/${encodeURIComponent(connection)}/fields`)).data.fields,
    enabled: connection !== '',
    staleTime: 5 * 60_000,
  });
}

interface QuestionLike {
  kind?: string | null;
  connection?: string | null;
  spec?: unknown;
  description?: string | null;
}

/** `enabled` false (public links, embeds): no data-model requests, the plain names are used. */
export function useQuestionCaption(q: QuestionLike | null | undefined, enabled = true): { caption: string | null; labels: Map<string, ColumnName> | null } {
  const spec = q?.kind === 'builder' && q.spec && typeof q.spec === 'object' && (q.spec as QuerySpec).source?.table ? (q.spec as QuerySpec) : null;
  const connection = enabled && spec ? (q?.connection ?? '') : '';
  const usesMetrics = !!spec?.aggregations?.some((a) => a.fn === 'metric');
  const tables = useTableNames(connection);
  const fields = useFieldNames(connection);
  const metrics = useMetrics(usesMetrics ? connection : '');
  return useMemo(() => {
    if (!q) return { caption: null, labels: null };
    if (!spec) return { caption: captionOf(q), labels: null };
    const namer = namerFromModel(spec, (table, column) => fields.data?.[table]?.[column], {
      table: (name) => (connection ? tableLabel(connection, name) : name),
      metric: (id) => {
        const m = metrics.data?.find((x) => x.id === id);
        return m ? { label: metricName(m), description: metricDescription(m), slug: m.slug } : undefined;
      },
    });
    return { caption: captionOf(q, namer), labels: outputLabels(spec, namer) };
    // tables.data: tableLabel reads it from the cache
  }, [q, spec, connection, fields.data, metrics.data, tables.data]); // eslint-disable-line react-hooks/exhaustive-deps
}
