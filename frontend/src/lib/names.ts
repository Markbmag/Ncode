/**
 * Friendly names (roadmap M11): what tables, columns and metrics are called in the UI language.
 *
 * The data model (Admin -> Data model) gives a display name and a description, plus translations
 * {"ru": {"display_name": "...", "description": "..."}} (metrics: "name" / "description"). The text
 * in the current UI language wins, then the base text the admin typed, then the technical name made
 * readable ("order_items" -> "Order items"). Technical names stay what is sent to the server,
 * searched and used in test ids.
 *
 *   pickText(meta.display_name, meta.translations, 'display_name')   -> the text to show, or null
 *   nameOf('order_items', meta)                                       -> "Позиции заказа" / "Order items"
 *   tableLabel(connection, 'orders'), columnLabel(connection, 'orders', 'total')
 *
 * tableLabel / columnLabel read what is already loaded for the connection (its table names, its
 * table list or its schema). A component that only has the technical names calls useNames(connection)
 * from src/lib/useNames.ts, so it re-renders once the names arrive. Pure, tested in tests/names.test.ts.
 */
import { lang, t } from '../i18n/index.ts';
import { queryClient, queryKeys } from './queryClient.ts';

/** {"ru": {"display_name": "...", "description": "..."}} */
export type Translations = Record<string, Record<string, string | null | undefined> | null | undefined>;

/** What the data model knows about a table or a column (all optional). */
export interface NameMeta {
  display_name?: string | null;
  description?: string | null;
  translations?: Translations | null;
}

/** The text in the UI language, else the base text; null when neither has one. */
export function pickText(base: string | null | undefined, translations: Translations | null | undefined, field: string): string | null {
  const own = translations?.[lang()]?.[field];
  if (typeof own === 'string' && own.trim()) return own;
  return typeof base === 'string' && base.trim() ? base : null;
}

/** Blank texts and languages left out, texts trimmed; null when nothing is left (as the server stores them). */
export function cleanTranslations(tr: Translations | null | undefined): Translations | null {
  const out: Translations = {};
  for (const [language, texts] of Object.entries(tr ?? {})) {
    const kept: Record<string, string> = {};
    for (const [key, value] of Object.entries(texts ?? {})) if (typeof value === 'string' && value.trim()) kept[key] = value.trim();
    if (Object.keys(kept).length) out[language] = kept;
  }
  return Object.keys(out).length ? out : null;
}

/** Sets one translated text: setTranslation(tr, 'ru', 'display_name', 'Заказы'). */
export function setTranslation(tr: Translations | null | undefined, language: string, field: string, value: string): Translations {
  return { ...(tr ?? {}), [language]: { ...(tr?.[language] ?? {}), [field]: value } };
}

/** A technical name made readable, as the app always did: "order_items" -> "Order items", "orderId" -> "Order Id". */
export const prettify = (name: string): string =>
  name
    .replace(/[_]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/^\w/, (c) => c.toUpperCase());

/** The friendly name of a table or column: data model (UI language) -> data model -> prettified. */
export function nameOf(technical: string, meta?: NameMeta | null): string {
  return pickText(meta?.display_name, meta?.translations, 'display_name') ?? prettify(technical);
}

export function descriptionOf(meta?: NameMeta | null): string | null {
  return pickText(meta?.description, meta?.translations, 'description');
}

/** True when the friendly name differs from the technical one enough to show both. */
export function differsFromTechnical(technical: string, label: string): boolean {
  return label !== technical && label !== prettify(technical);
}

/** Metrics keep their name as the base text: {"ru": {"name", "description"}}. */
export interface MetricNames {
  name: string;
  description?: string | null;
  translations?: Translations | null;
}

export const metricName = (m: MetricNames): string => pickText(m.name, m.translations, 'name') ?? m.name;
export const metricDescription = (m: MetricNames): string | null => pickText(m.description, m.translations, 'description');

/** Case-insensitive "contains" over every name a thing is known by (technical and friendly). */
export function nameMatches(query: string, ...names: (string | null | undefined)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return names.some((n) => typeof n === 'string' && n.toLowerCase().includes(q));
}

// ---------------------------------------------------------------- databases

/** The demo database (backend app/demo.py): key "demo", source "demo" (for everyone), label "Factory demo". */
export const DEMO_KEY = 'demo';
export const isDemo = (c: { source?: string }): boolean => c.source === 'demo';

/** A database's name in the UI language: admins name their own; the demo is translated. */
export const connectionLabel = (c: { label: string; source?: string }): string => (isDemo(c) ? t('Factory demo') : c.label);

// ---------------------------------------------------------------- lists that carry the names

export type Named = NameMeta & { name: string };

/** The friendly name of `name` among tables or columns at hand (schema v2 tables, the table list ...). */
export function labelIn(items: readonly Named[] | null | undefined, name: string): string {
  return nameOf(name, items?.find((i) => i.name === name));
}

export function descriptionIn(items: readonly Named[] | null | undefined, name: string): string | null {
  return descriptionOf(items?.find((i) => i.name === name));
}

export interface Labelled<T> {
  item: T;
  name: string;           // technical: values, test ids, what the server gets
  label: string;          // friendly, in the UI language
  description: string | null;
  showTechnical: boolean; // the label hides the technical name: show it small next to it
}

/** Tables or columns with their friendly names, sorted by them (pickers and lists). */
export function byLabel<T extends Named>(items: readonly T[]): Labelled<T>[] {
  return items
    .map((item) => {
      const label = nameOf(item.name, item);
      return { item, name: item.name, label, description: descriptionOf(item), showTechnical: differsFromTechnical(item.name, label) };
    })
    .sort((a, b) => a.label.localeCompare(b.label, lang()) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- what is loaded for a connection

const hasMeta = (m: NameMeta | null | undefined): m is NameMeta =>
  !!m && (!!m.display_name || !!m.description || (!!m.translations && Object.keys(m.translations).length > 0));

/** Table metadata from the caches: GET /api/semantic/{c}/tables, the table list, the schema. */
export function tableMeta(connection: string, table: string): NameMeta | null {
  const names = queryClient.getQueryData<Record<string, NameMeta>>(queryKeys.tableNames(connection));
  if (hasMeta(names?.[table])) return names[table];
  const list = queryClient.getQueryData<Named[]>(queryKeys.tables(connection));
  const listed = Array.isArray(list) ? list.find((t) => t.name === table) : undefined;
  if (hasMeta(listed)) return listed;
  const schema = queryClient.getQueryData<{ tables?: Named[] }>(queryKeys.schema(connection));
  const described = schema?.tables?.find((t) => t.name === table);
  return hasMeta(described) ? described : null;
}

/** Column metadata from the connection's schema (when it is loaded). */
export function columnMeta(connection: string, table: string, column: string): NameMeta | null {
  const schema = queryClient.getQueryData<{ tables?: (Named & { columns?: Named[] })[] }>(queryKeys.schema(connection));
  const found = schema?.tables?.find((t) => t.name === table)?.columns?.find((c) => c.name === column);
  return hasMeta(found) ? found : null;
}

export const tableLabel = (connection: string, table: string): string => nameOf(table, tableMeta(connection, table));
export const tableDescription = (connection: string, table: string): string | null => descriptionOf(tableMeta(connection, table));
export const columnLabel = (connection: string, table: string, column: string): string =>
  nameOf(column, columnMeta(connection, table, column));
export const columnDescription = (connection: string, table: string, column: string): string | null =>
  descriptionOf(columnMeta(connection, table, column));
