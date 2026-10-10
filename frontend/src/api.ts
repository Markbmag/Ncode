import axios from 'axios';

const TOKEN_KEY = 'ncode_token';
export const UNAUTHORIZED_EVENT = 'ncode:unauthorized';

export const getToken = (): string | null => localStorage.getItem(TOKEN_KEY);
export const setToken = (token: string | null): void => {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
};

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
export const WS_URL: string = API_URL.replace(/^http/, 'ws');

export const http = axios.create({ baseURL: API_URL });

// Attach the session token to every request.
http.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.set('Authorization', `Bearer ${token}`);
  return config;
});

// An expired/invalid session anywhere sends the user back to the login screen.
http.interceptors.response.use(
  (response) => response,
  (error: unknown) => {
    if (axios.isAxiosError(error) && error.response?.status === 401 && getToken()) {
      setToken(null);
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    return Promise.reject(error);
  },
);

/** Pulls a readable message out of an API error (FastAPI puts it in `detail`). */
export function apiErrorMessage(error: unknown, fallback: string): string {
  if (axios.isAxiosError(error)) {
    const detail: unknown = error.response?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    if (Array.isArray(detail) && detail.length > 0) {
      const first: unknown = detail[0];
      if (typeof first === 'object' && first !== null && 'msg' in first) return String((first as { msg: unknown }).msg);
    }
    if (!error.response) return 'Сервер недоступен. Проверьте, что backend запущен.';
  }
  return fallback;
}

/** Like apiErrorMessage, but also understands errors of requests made with responseType "blob". */
export async function apiErrorMessageAsync(error: unknown, fallback: string): Promise<string> {
  if (axios.isAxiosError(error) && error.response?.data instanceof Blob) {
    try {
      const parsed: unknown = JSON.parse(await error.response.data.text());
      if (typeof parsed === 'object' && parsed !== null && 'detail' in parsed) {
        const detail = (parsed as { detail: unknown }).detail;
        if (typeof detail === 'string' && detail) return detail;
      }
    } catch {
      // not JSON - fall through to the generic message
    }
  }
  return apiErrorMessage(error, fallback);
}

// ---------------------------------------------------------------- types

export type MatchMode = 'contains' | 'exact' | 'starts_with';

export interface User {
  username: string;
  role: string;
}

export interface LoginResponse {
  token: string;
  expires_at: number;
  user: User;
}

export interface Connection {
  key: string;
  label: string;
  engine: string;
  database: string;
  id_hints: string[];
  source: string; // "env" (from .env) | "ui" (managed in the interface)
  editable: boolean;
}

export interface EngineOption {
  name: string;
  label: string;
  default_port: number | null;
  available: boolean;
  pip: string | null;
  file_based: boolean;
}

export interface ConnectionDetails {
  key: string;
  label: string;
  engine: string;
  host: string | null;
  port: number | null;
  username: string | null;
  has_password: boolean;
  database: string;
  schema_name: string | null;
  id_hints: string[];
  source: string;
  editable: boolean;
}

export interface ConnectionPayload {
  label: string;
  engine: string;
  host: string | null;
  port: number | null;
  username: string | null;
  password: string | null;
  database: string;
  schema_name: string | null;
  id_hints: string[];
  key?: string | null;
}

export interface DraftTestResult {
  ok: boolean;
  tables?: number;
  error?: string;
}

export interface TableInfo {
  name: string;
  columns: number;
  searchable: number;
}

export interface SearchHit {
  table: string;
  row: Record<string, unknown>;
  cols: string[];
  matched_columns: string[];
  id_column: string | null;
}

export interface TableError {
  table: string;
  error: string;
}

export interface Progress {
  status: string;
  total: number;
  processed: number;
  found: number;
}

export interface TaskMessage extends Partial<Progress> {
  status: string;
  message?: string | null;
  results?: SearchHit[];
  errors?: TableError[];
  truncated_tables?: string[];
  results_capped?: boolean;
  skipped?: number;
  elapsed_sec?: number;
}

export interface BrowseRow {
  values: Record<string, unknown>;
  matched: string[];
}

export interface BrowseResponse {
  table: string;
  columns: string[];
  omitted: string[]; // binary columns that are not shown
  rows: BrowseRow[];
  has_more: boolean;
  offset: number;
  limit: number;
  sort: string | null;
  descending: boolean;
  note: string | null;
}

export interface ColumnInfo {
  name: string;
  type: string;
  nullable: boolean;
  primary_key: boolean;
}

export interface Limits {
  max_row_limit: number;
  max_export_rows: number;
}

// ---------------------------------------------------------------- schema v2

/** Column types normalised by the backend (app/schema_graph.py). */
export type ColumnType = 'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'time' | 'json' | 'binary' | 'unknown';

export interface SchemaColumn {
  name: string;
  type: ColumnType;
  db_type: string;
  nullable: boolean;
  primary_key: boolean;
  foreign_key: { table: string; column: string } | null;
}

export interface SchemaTable {
  name: string;
  primary_key: string[];
  columns: SchemaColumn[];
}

export interface Relationship {
  from_table: string;
  from_columns: string[];
  to_table: string;
  to_columns: string[];
}

export interface SchemaV2 {
  connection: string;
  version: 2;
  tables: SchemaTable[];
  relationships: Relationship[];
}

// ---------------------------------------------------------------- result envelope (used from M1 on)

export interface ResultColumn {
  name: string;
  type: ColumnType;
  role: 'dimension' | 'measure';
}

export interface ResultEnvelope {
  columns: ResultColumn[];
  rows: unknown[][];
  stats: { duration_ms: number; row_count: number; truncated: boolean; cached: boolean };
  sql: string | null;
}
