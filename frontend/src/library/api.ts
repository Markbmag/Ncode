/** Library API (backend/app/content/routes.py): types, TanStack Query hooks and mutations. */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import type { QuerySpec } from '../query/types';
import type { VizState } from '../viz/state';
import type { ParameterDef } from './params';

export { flattenTree } from './tree.ts';
export type { TreeNode } from './tree.ts';

export type Access = 'view' | 'edit';
export type QuestionKind = 'builder' | 'sql' | 'federated';

export interface CollectionInfo {
  id: number;
  name: string;
  description: string | null;
  parent_id: number | null;
  personal: boolean;
  mine: boolean;
  archived: boolean;
  access: Access | null;
  can_manage: boolean;
  shared: boolean;
  updated_at: number;
}

export interface QuestionSummary {
  id: number;
  name: string;
  description: string | null;
  collection_id: number;
  collection: { id: number; name: string } | null;
  connection: string;
  kind: QuestionKind;
  owner: string | null;
  archived: boolean;
  favorite: boolean;
  access: Access | null;
  imported: boolean;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
}

export interface SqlQuestionSpec {
  sql: string;
  limit?: number | null;
}

export interface SavedQuestion extends QuestionSummary {
  path: { id: number; name: string }[];
  spec: QuerySpec | SqlQuestionSpec | Record<string, unknown>;
  viz: VizState | null;
  parameters: ParameterDef[];
}

export interface Grant {
  user: string | null;
  role: string | null;
  level: Access;
  inherited_from?: { id: number; name: string } | null;
}

export interface QuestionPayload {
  kind: 'builder' | 'sql';
  connection?: string;
  spec: QuerySpec | SqlQuestionSpec;
  viz: VizState | null;
  parameters: ParameterDef[];
}

export const libraryKeys = {
  all: ['library'] as const,
  collections: ['library', 'collections'] as const,
  collection: (id: number) => ['library', 'collection', id] as const,
  questions: (params: Record<string, unknown>) => ['library', 'questions', params] as const,
  question: (id: number) => ['library', 'question', id] as const,
  archive: ['library', 'archive'] as const,
  people: ['library', 'people'] as const,
  grants: (id: number) => ['library', 'grants', id] as const,
};

/** Anything in the library changed: refetch what is on screen. */
export const refreshLibrary = () => queryClient.invalidateQueries({ queryKey: libraryKeys.all });

export function useCollections() {
  return useQuery({
    queryKey: libraryKeys.collections,
    queryFn: async () => (await http.get<{ personal_id: number; collections: CollectionInfo[] }>('/api/collections')).data,
  });
}

export function useCollection(id: number | null) {
  return useQuery({
    queryKey: libraryKeys.collection(id ?? 0),
    enabled: id !== null,
    queryFn: async () =>
      (
        await http.get<{ collection: CollectionInfo; path: { id: number; name: string }[]; collections: CollectionInfo[]; questions: QuestionSummary[] }>(
          `/api/collections/${id}`,
        )
      ).data,
  });
}

export function useQuestions(params: { q?: string; favorites?: boolean; limit?: number }, enabled = true) {
  return useQuery({
    queryKey: libraryKeys.questions(params),
    enabled,
    queryFn: async () => (await http.get<{ questions: QuestionSummary[] }>('/api/questions', { params })).data.questions,
  });
}

export function useQuestion(id: number) {
  return useQuery({
    queryKey: libraryKeys.question(id),
    queryFn: async () => (await http.get<SavedQuestion>(`/api/questions/${id}`)).data,
  });
}

export function useArchive() {
  return useQuery({
    queryKey: libraryKeys.archive,
    queryFn: async () => (await http.get<{ collections: CollectionInfo[]; questions: QuestionSummary[] }>('/api/library/archive')).data,
  });
}

export function usePeople() {
  return useQuery({
    queryKey: libraryKeys.people,
    staleTime: 5 * 60_000,
    queryFn: async () => (await http.get<{ users: string[]; roles: string[] }>('/api/library/people')).data,
  });
}

// ---------------------------------------------------------------- mutations (callers show errors)

async function after<T>(promise: Promise<{ data: T }>): Promise<T> {
  const { data } = await promise;
  await refreshLibrary();
  return data;
}

export const library = {
  createCollection: (body: { name: string; description?: string | null; parent_id: number | null }) => after(http.post<CollectionInfo>('/api/collections', body)),
  updateCollection: (id: number, body: Partial<{ name: string; description: string | null; parent_id: number | null; archived: boolean }>) =>
    after(http.patch<CollectionInfo>(`/api/collections/${id}`, body)),
  deleteCollection: (id: number) => after(http.delete(`/api/collections/${id}`)),
  grants: async (id: number) => (await http.get<{ grants: Grant[] }>(`/api/collections/${id}/permissions`)).data.grants,
  setGrants: (id: number, grants: Grant[]) =>
    after(http.put<{ grants: Grant[] }>(`/api/collections/${id}/permissions`, { grants: grants.map(({ user, role, level }) => ({ user, role, level })) })),

  createQuestion: async (body: QuestionPayload & { name: string; description?: string | null; collection_id: number | null }) => {
    const q = await after(http.post<SavedQuestion>('/api/questions', body));
    queryClient.setQueryData(libraryKeys.question(q.id), q);
    return q;
  },
  updateQuestion: async (id: number, body: Partial<QuestionPayload & { name: string; description: string | null; collection_id: number; archived: boolean }>) => {
    const q = await after(http.patch<SavedQuestion>(`/api/questions/${id}`, body));
    queryClient.setQueryData(libraryKeys.question(q.id), q);
    return q;
  },
  deleteQuestion: (id: number) => after(http.delete(`/api/questions/${id}`)),
  duplicate: (id: number, body: { name?: string; collection_id?: number | null } = {}) => after(http.post<SavedQuestion>(`/api/questions/${id}/duplicate`, body)),
  favorite: (id: number, on: boolean) => after(on ? http.put(`/api/questions/${id}/favorite`) : http.delete(`/api/questions/${id}/favorite`)),
};

export const kindLabel: Record<QuestionKind, string> = { builder: 'Question', sql: 'SQL', federated: 'Multi-source' };
