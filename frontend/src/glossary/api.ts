/** Glossary API (backend/app/glossary.py): read by everyone signed in, changed by admins. */
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import { termsFor } from './logic.ts';
import type { GlossaryTarget, GlossaryTerm, TermBody } from './logic.ts';

export const glossaryKeys = {
  all: ['glossary'] as const,
  list: (params: { q?: string; archived?: boolean }) => ['glossary', params] as const,
};

export function useGlossary(params: { q?: string; archived?: boolean } = {}, enabled = true) {
  return useQuery({
    queryKey: glossaryKeys.list(params),
    enabled,
    staleTime: 5 * 60_000, // small, and changed rarely
    queryFn: async () => (await http.get<{ terms: GlossaryTerm[] }>('/api/glossary', { params })).data.terms,
  });
}

async function after<T>(promise: Promise<{ data: T }>): Promise<T> {
  const { data } = await promise;
  await queryClient.invalidateQueries({ queryKey: glossaryKeys.all });
  return data;
}

export const glossary = {
  create: (body: TermBody) => after(http.post<GlossaryTerm>('/api/glossary', body)),
  update: (id: number, body: TermBody) => after(http.put<GlossaryTerm>(`/api/glossary/${id}`, body)),
  archive: (id: number, archived: boolean) => after(http.patch<GlossaryTerm>(`/api/glossary/${id}`, { archived })),
  remove: (id: number) => after(http.delete(`/api/glossary/${id}`)),
};

/** The terms that explain a metric or a column (all terms are loaded once and cached). */
export function useGlossaryFor(target: GlossaryTarget): GlossaryTerm[] {
  const terms = useGlossary();
  const metric = 'metric' in target ? target.metric : null;
  const [connection, table, column] = 'metric' in target ? ['', '', ''] : [target.connection, target.table, target.column];
  return useMemo(
    () => termsFor(terms.data, metric !== null ? { metric } : { connection, table, column }),
    [terms.data, metric, connection, table, column],
  );
}
