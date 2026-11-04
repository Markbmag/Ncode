/** Ncode - Kanban: the shapes the API answers with (backend app/kanban, /api/kanban/*). */

export type Priority = 'low' | 'normal' | 'high' | 'urgent';
export const PRIORITIES: Priority[] = ['low', 'normal', 'high', 'urgent'];
export type Role = 'editor' | 'owner';

/** A person as the API names one: an id, a username, or both. */
export type UserRef = number | string | { id?: number | null; username?: string | null; name?: string | null } | null | undefined;
export type GroupRef = number | string | { id?: number | null; name?: string | null } | null | undefined;

export interface BoardSummary {
  id: number;
  name: string;
  description: string | null;
  color: string | null;
  owner: UserRef;
  role: Role | null; // your role on the board (null: you only read it)
  can_edit?: boolean; // members and administrators
  can_manage?: boolean; // owners and administrators
  members_count: number;
  member_names?: string[]; // up to 6, people and groups
  cards_open: number;
  cards_done: number;
  updated_at: number;
  archived: boolean;
}

export interface Column {
  id: number;
  name: string;
  color: string | null;
  position: number;
  is_done: boolean;
}

export interface Label {
  id: number;
  name: string;
  color: string;
}

export interface Member {
  id: number;
  user?: UserRef; // a user id
  group?: GroupRef; // a group id
  role: Role;
  name?: string | null; // the user's or group's name
}

export interface Person {
  id: number;
  username: string;
  active?: boolean; // false: disabled, still shown where assigned
}

export interface Group {
  id: number;
  name: string;
}

export interface CardSummary {
  id: number;
  column_id: number;
  title: string;
  priority: Priority;
  start_date: string | null;
  due_date: string | null;
  position: number;
  assignees: number[];
  labels: number[];
  checklist: { done: number; total: number };
  comments: number;
  attachments: number;
  cover: string | null;
  completed_at: number | null;
  updated_at: number;
  archived?: boolean;
}

export interface ChecklistItem {
  id: number;
  text: string;
  done: boolean;
  done_by: UserRef;
  done_at: number | null;
  position: number;
}

export interface Comment {
  id: number;
  user: UserRef;
  body: string;
  created_at: number;
  edited_at: number | null;
}

export interface Attachment {
  id: number;
  filename: string;
  content_type: string;
  size: number;
  url: string;
  thumb_url: string | null;
  is_image?: boolean;
  uploaded_by: UserRef;
  created_at: number;
}

export interface HistoryEntry {
  id: number;
  user: UserRef;
  action: string;
  details: Record<string, unknown> | string | null;
  created_at: number;
}

export interface Card extends CardSummary {
  description: string | null;
  created_by: UserRef;
  created_at: number;
  checklist_items: ChecklistItem[];
  comments_list: Comment[];
  attachments_list: Attachment[];
  history: HistoryEntry[];
}

export interface BoardDetail {
  board: BoardSummary;
  columns: Column[];
  labels: Label[];
  members: Member[];
  cards: CardSummary[];
  people: Person[];
  groups?: Group[];
}

/** What the board's WebSocket sends after every change. */
export interface BoardEvent {
  type: 'board_changed' | string;
  card_id?: number | null;
  by?: string | null;
  action?: string | null;
}

/** GET /api/kanban/my (K3): the caller's tasks on every board they can see. */
export interface MyTasks {
  cards: (CardSummary & { board_id: number })[];
  boards: { id: number; name: string; color: string | null; can_edit: boolean; columns: Column[]; labels: Label[] }[];
  people: Person[];
}
