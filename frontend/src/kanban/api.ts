/** Ncode - Kanban: calls to /api/kanban/* and their react-query cache keys. */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import type { BoardDetail, BoardSummary, Card, CardSummary, Column, Label, MyTasks, Priority, Role } from './types';

const BASE = '/api/kanban';

export const kanbanKeys = {
  all: ['kanban'] as const,
  boards: (archived: boolean) => ['kanban', 'boards', archived] as const,
  board: (id: number) => ['kanban', 'board', id] as const,
  card: (id: number) => ['kanban', 'card', id] as const,
  file: (url: string) => ['kanban', 'file', url] as const,
  my: ['kanban', 'my'] as const,
};

/** My tasks on every board (K3); refreshed every minute and when the window comes back. */
export function useMyTasks() {
  return useQuery({
    queryKey: kanbanKeys.my,
    queryFn: async () => (await http.get<MyTasks>(`${BASE}/my`)).data,
    staleTime: 5_000,
    refetchInterval: 60_000,
  });
}

export function useBoards(archived = false) {
  return useQuery({
    queryKey: kanbanKeys.boards(archived),
    queryFn: async () => (await http.get<{ boards: BoardSummary[] }>(`${BASE}/boards`, { params: archived ? { archived: true } : {} })).data.boards,
    staleTime: 5_000,
  });
}

export function useBoard(id: number) {
  return useQuery({
    queryKey: kanbanKeys.board(id),
    queryFn: async () => (await http.get<BoardDetail>(`${BASE}/boards/${id}`)).data,
    enabled: Number.isFinite(id) && id > 0,
    staleTime: 2_000,
  });
}

/** The board's archived cards (they wait there to be restored or deleted). */
export function useArchivedCards(id: number, enabled: boolean) {
  return useQuery({
    queryKey: [...kanbanKeys.board(id), 'archived'] as const,
    queryFn: async () => (await http.get<BoardDetail>(`${BASE}/boards/${id}`, { params: { archived_cards: true } })).data.cards,
    enabled,
  });
}

export function useCard(id: number | null) {
  return useQuery({
    queryKey: kanbanKeys.card(id ?? 0),
    queryFn: async () => (await http.get<Card>(`${BASE}/cards/${id}`)).data,
    enabled: id !== null && id > 0,
    staleTime: 2_000,
  });
}

// ---------------------------------------------------------------- boards

export interface BoardInput {
  name?: string;
  description?: string | null;
  color?: string | null;
  archived?: boolean;
}

export const createBoard = async (body: BoardInput & { name: string; template?: 'basic' }) =>
  (await http.post<BoardSummary>(`${BASE}/boards`, body)).data;
export const updateBoard = async (id: number, body: BoardInput) => (await http.patch<BoardSummary>(`${BASE}/boards/${id}`, body)).data;
export const deleteBoard = async (id: number) => {
  await http.delete(`${BASE}/boards/${id}`);
};

export interface MemberInput {
  user?: number;
  group?: number;
  role: Role;
}
export const saveMembers = async (id: number, members: MemberInput[]) => (await http.put(`${BASE}/boards/${id}/members`, { members })).data;

// ---------------------------------------------------------------- columns and labels

export const createColumn = async (boardId: number, body: { name: string; color?: string | null; is_done?: boolean }) =>
  (await http.post<Column>(`${BASE}/boards/${boardId}/columns`, body)).data;
export const updateColumn = async (id: number, body: Partial<Pick<Column, 'name' | 'color' | 'is_done' | 'position'>>) =>
  (await http.patch<Column>(`${BASE}/columns/${id}`, body)).data;
export const deleteColumn = async (id: number) => {
  await http.delete(`${BASE}/columns/${id}`);
};

export const createLabel = async (boardId: number, body: { name: string; color: string }) =>
  (await http.post<Label>(`${BASE}/boards/${boardId}/labels`, body)).data;
export const updateLabel = async (id: number, body: Partial<Pick<Label, 'name' | 'color'>>) => (await http.patch<Label>(`${BASE}/labels/${id}`, body)).data;
export const deleteLabel = async (id: number) => {
  await http.delete(`${BASE}/labels/${id}`);
};

// ---------------------------------------------------------------- cards

export interface CardInput {
  title?: string;
  description?: string | null;
  priority?: Priority;
  start_date?: string | null;
  due_date?: string | null;
  assignees?: number[];
  labels?: number[];
  archived?: boolean;
}

export const createCard = async (boardId: number, body: CardInput & { column_id: number; title: string; position?: number }) =>
  (await http.post<Card>(`${BASE}/boards/${boardId}/cards`, body)).data;
/** To the top of a stage (the server picks the place). */
export const moveCardToTop = async (id: number, column_id: number) => (await http.post<Card>(`${BASE}/cards/${id}/move`, { column_id })).data;
export const updateCard = async (id: number, body: CardInput) => (await http.patch<Card>(`${BASE}/cards/${id}`, body)).data;
export const moveCard = async (id: number, column_id: number, position: number) =>
  (await http.post<CardSummary>(`${BASE}/cards/${id}/move`, { column_id, position })).data;
export const deleteCard = async (id: number) => {
  await http.delete(`${BASE}/cards/${id}`);
};

export const addChecklistItem = async (cardId: number, text: string) => (await http.post(`${BASE}/cards/${cardId}/checklist`, { text })).data;
export const updateChecklistItem = async (id: number, body: { text?: string; done?: boolean; position?: number }) =>
  (await http.patch(`${BASE}/checklist/${id}`, body)).data;
export const deleteChecklistItem = async (id: number) => {
  await http.delete(`${BASE}/checklist/${id}`);
};

export const addComment = async (cardId: number, body: string) => (await http.post(`${BASE}/cards/${cardId}/comments`, { body })).data;
export const updateComment = async (id: number, body: string) => (await http.patch(`${BASE}/comments/${id}`, { body })).data;
export const deleteComment = async (id: number) => {
  await http.delete(`${BASE}/comments/${id}`);
};

/** Files go up as the raw request body (no multipart on this server), the name and type in the query. */
export const uploadAttachment = async (cardId: number, file: Blob, filename: string, contentType: string) =>
  (
    await http.post<{ id: number }>(`${BASE}/cards/${cardId}/attachments`, file, {
      params: { filename, content_type: contentType },
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
    })
  ).data;
export const uploadThumb = async (attachmentId: number, jpeg: Blob) => {
  await http.post(`${BASE}/attachments/${attachmentId}/thumb`, jpeg, {
    params: { filename: 'thumb.jpg', content_type: 'image/jpeg' },
    headers: { 'Content-Type': 'image/jpeg' },
  });
};
export const deleteAttachment = async (id: number) => {
  await http.delete(`${BASE}/attachments/${id}`);
};

/** The API's file urls are relative to the API (with or without the /api/kanban prefix). */
export function apiPath(url: string): string {
  if (/^https?:\/\//.test(url) || url.startsWith('/api/')) return url;
  return `${BASE}${url.startsWith('/') ? '' : '/'}${url}`;
}

/** A file behind sign-in, as an object URL an <img> can show (cached per url). */
export function useFileUrl(url: string | null | undefined) {
  return useQuery({
    queryKey: kanbanKeys.file(url ?? ''),
    queryFn: async () => URL.createObjectURL((await http.get<Blob>(apiPath(url!), { responseType: 'blob' })).data),
    enabled: Boolean(url),
    staleTime: Infinity,
    gcTime: 10 * 60_000,
  });
}

export async function downloadAttachment(url: string, filename: string): Promise<void> {
  const blob = (await http.get<Blob>(apiPath(url), { responseType: 'blob' })).data;
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
}
