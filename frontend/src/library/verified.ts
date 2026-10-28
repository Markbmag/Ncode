/**
 * Verified content (M11): an admin marks a question or a dashboard as the official answer.
 * Items carry "verified": {"by", "at"} | null; lists put verified items first (server side).
 * Saving a question with a changed query (spec / SQL, parameters) takes the mark away - not a
 * rename, a move or a new chart - so the editor warns first: queryChanged().
 */
import { localDateText } from '../viz/format.ts';
import { t } from '../i18n/index.ts';

export interface Verified {
  by: string;
  at: number; // unix seconds
}

export function verifiedTooltip(v: Verified): string {
  return t('Checked by {admin} on {date}: this is the official answer', { admin: v.by, date: localDateText(v.at * 1000) });
}

/** JSON with sorted keys (undefined left out, as JSON does): equal for two objects that mean the same. */
export function stableJson(value: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map((x) => (x === undefined ? null : norm(x)));
    if (v && typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const x = (v as Record<string, unknown>)[k];
        if (x !== undefined) out[k] = norm(x);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(value)) ?? 'null';
}

interface QueryPart {
  kind: string;
  connection?: string | null;
  spec: unknown;
  parameters?: { name: string; label?: string | null; type?: string; default?: unknown; required?: boolean }[];
}

/** What the server compares (backend: query_identity): the query, not the name, place or chart. */
function identity(q: QueryPart): string {
  let spec = q.spec;
  if (q.kind === 'federated' && spec && typeof spec === 'object') {
    // the combined columns the editor saves are a hint for dashboards, not part of the query
    const { result_columns: _hint, ...rest } = spec as Record<string, unknown>;
    void _hint;
    spec = rest;
  }
  const params = (q.parameters ?? []).map((p) => ({
    name: p.name, label: p.label ?? null, type: p.type ?? 'text', default: p.default ?? null, required: !!p.required,
  }));
  return stableJson([q.kind, q.kind === 'sql' ? q.connection ?? '' : '', spec, params]);
}

/** Would saving `next` change what the saved question computes (and so remove its Verified mark)? */
export function queryChanged(saved: QueryPart, next: QueryPart | null | undefined): boolean {
  return !!next && identity(saved) !== identity(next);
}
