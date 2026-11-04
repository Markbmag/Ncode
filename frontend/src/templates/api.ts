import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { lang } from '../i18n/index.ts';
import type { Created, Mapping, Suggestion, TemplateInfo, TemplatePlan } from './types';

export function useTemplates() {
  return useQuery({
    queryKey: ['templates', lang()],
    queryFn: async () => (await http.get<{ templates: TemplateInfo[] }>('/api/templates', { params: { language: lang() } })).data.templates,
    staleTime: 60 * 60 * 1000,
  });
}

export const templates = {
  suggest: async (id: string, connection: string, mapping: Record<string, string | number | null>) =>
    (await http.post<Suggestion>(`/api/templates/${id}/suggest`, { connection, mapping, language: lang() })).data,
  preview: async (id: string, connection: string, mapping: Mapping, card?: string) =>
    (await http.post<TemplatePlan>(`/api/templates/${id}/preview`, { connection, mapping, language: lang(), card, wait_ms: 3000 })).data,
  create: async (id: string, body: { connection: string; mapping: Mapping; collection_id: number | null; name: string }) =>
    (await http.post<Created>(`/api/templates/${id}/create`, { ...body, language: lang() })).data,
};
