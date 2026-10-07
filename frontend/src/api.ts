import axios from 'axios';

export const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000';
export const WS_URL: string = API_URL.replace(/^http/, 'ws');

export const http = axios.create({ baseURL: API_URL });

export type MatchMode = 'contains' | 'exact' | 'starts_with';

export interface Connection {
  key: string;
  label: string;
  engine: string;
  database: string;
  id_hints: string[];
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
}
