/**
 * Dashboard filters connect themselves (M12): when a filter is added, each card gets the obvious
 * column (or parameter) of the same type - for a date range the card's date grouping or its main
 * date column, for a list of values a column with the filter's name or one referring to the table
 * the filter is about - and every card connected to one filter compares the same kind of values
 * (line ids with line ids, not with line names). People see what was connected and can change it.
 * Pure, unit-tested in tests/connect.test.ts.
 */
import type { ColumnType, SchemaColumn } from '../api';
import { columnOptions } from '../query/draft.ts';
import type { ColumnOption, SchemaInfo } from '../query/draft.ts';
import { nameOf } from '../lib/names.ts';
import type { QuerySpec } from '../query/types.ts';
import { suggestMapping } from './logic.ts';
import type { CardQuestion, DashCard, DashFilter, FilterType, Mapping } from './types.ts';

const TYPES: Record<FilterType, ColumnType[]> = {
  date_range: ['date', 'datetime'],
  date: ['date', 'datetime'],
  number: ['number'],
  text: ['string', 'unknown'],
  category: ['string', 'number', 'boolean', 'unknown'],
};

/** Lower case letters and digits of any alphabet; a plural "s" dropped ("Lines" = "line"). */
export const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
    .replace(/(?<=..)s$/, '');

interface Candidate {
  ref: string;
  type: ColumnType;
  names: string[];         // what the column is called, normalised
  domain: string;          // what its values are: "table.column", for a foreign key the key it refers to
  foreign: boolean;
  source: boolean;         // a column of the question's own table (not a joined one)
  column?: SchemaColumn;
}

function schemaColumn(schema: SchemaInfo, table: string, column: string): SchemaColumn | undefined {
  return schema.tables.find((t) => t.name === table)?.columns.find((c) => c.name === column);
}

function tableOf(spec: QuerySpec, option: ColumnOption): string {
  if (option.table === (spec.source.alias || spec.source.table)) return spec.source.table;
  return (spec.joins ?? []).find((j) => (j.alias || j.table) === option.table)?.table ?? option.table;
}

/** The columns of a card's question that a filter could narrow. */
export function candidates(question: CardQuestion | undefined, schema: SchemaInfo | null): Candidate[] {
  if (!question || question.state === 'hidden' || question.state === 'deleted') return [];
  if (question.kind === 'federated') {
    return (question.fields ?? []).map((f) => ({
      ref: f.name, type: f.type as ColumnType, names: [norm(f.name)], domain: `*.${f.name}`, foreign: false, source: true,
    }));
  }
  const spec = question.spec as QuerySpec | null | undefined;
  if (question.kind !== 'builder' || !spec || !schema) return [];
  const sourceAlias = spec.source.alias || spec.source.table;
  return columnOptions(spec, schema)
    .filter((o) => o.table !== 'Custom' && !(spec.expressions ?? []).some((e) => e.name === o.ref))
    .map((o) => {
      const table = tableOf(spec, o);
      const column = schemaColumn(schema, table, o.column);
      const fk = column?.foreign_key ?? null;
      const target = fk ? schema.tables.find((t) => t.name === fk.table) : undefined;
      const bare = o.column.replace(/_?id$/i, '');
      const names = [o.column, bare, o.name, o.name.replace(/\s*id$/i, '')];
      if (fk) names.push(fk.table, nameOf(fk.table, target));
      return {
        ref: o.ref, type: o.type, names: names.map(norm).filter(Boolean),
        domain: fk ? `${fk.table}.${fk.column}` : `${table}.${o.column}`, foreign: !!fk, source: o.table === sourceAlias, column,
      };
    });
}

/** What the values of a mapped column are (see Candidate.domain); null for parameters and unknown columns. */
export function domainOf(card: DashCard, filterId: string, schema: SchemaInfo | null): string | null {
  const field = card.mappings?.[filterId]?.field;
  if (!field) return null;
  return candidates(card.question, schema).find((c) => c.ref === field)?.domain ?? null;
}

const DATE_NAME = /(^|_)(date|day)$|_(at|on)$|^(created|date)/i;

function dateColumn(question: CardQuestion, all: Candidate[]): Candidate | undefined {
  const dates = all.filter((c) => TYPES.date.includes(c.type));
  const spec = question.spec as QuerySpec | null | undefined;
  // the date the question is grouped by ("per month") is the one people think of
  for (const b of spec?.breakouts ?? []) {
    const hit = b.ref ? dates.find((c) => c.ref === b.ref || c.ref.endsWith(`.${b.ref}`)) : undefined;
    if (hit) return hit;
  }
  const own = dates.filter((c) => c.source);
  for (const group of [own, dates]) {
    const found =
      group.find((c) => c.column?.semantic_type === 'created') ?? group.find((c) => DATE_NAME.test(c.ref.split('.').pop() ?? '')) ?? group[0];
    if (found) return found;
  }
  return undefined;
}

/**
 * The obvious connection of a filter on one card, or null. `domain`: what the cards connected so far
 * compare (a column that holds other values is not taken).
 */
export function autoMapping(filter: DashFilter, question: CardQuestion | undefined, schema: SchemaInfo | null, domain: string | null = null): Mapping | null {
  const param = suggestMapping(filter, question);
  if (param) return param;
  if (!question) return null;
  const all = candidates(question, schema).filter((c) => TYPES[filter.type].includes(c.type));
  if (filter.type === 'date_range' || filter.type === 'date') {
    const found = dateColumn(question, all);
    return found ? { field: found.ref } : null;
  }
  const wanted = [norm(filter.label), norm(filter.id)].filter(Boolean);
  const named = all.filter((c) => c.names.some((n) => wanted.includes(n)) && (domain === null || c.domain === domain));
  // ids reach more cards than names (every table with a line_id, not only those joined to the lines)
  const rank = (c: Candidate) => (c.foreign ? 0 : 2) + (c.source ? 0 : 1);
  const best = [...named].sort((a, b) => rank(a) - rank(b))[0];
  return best ? { field: best.ref } : null;
}

export interface Connected {
  cards: DashCard[];
  connected: string[]; // keys of the cards connected automatically
}

/**
 * Connect a filter to every card it obviously fits, leaving `keep` cards (connected by hand) as they are.
 * Cards connected by hand set what the values are; the first card connected here sets it otherwise.
 */
export function connectFilter(
  filter: DashFilter, cards: DashCard[], schemaOf: (connection: string) => SchemaInfo | null, keep: (card: DashCard) => boolean = () => false,
): Connected {
  const schemaFor = (c: DashCard) => (c.question?.connection ? schemaOf(c.question.connection) : null);
  let domain: string | null = null;
  for (const c of cards) if (keep(c)) domain ??= domainOf(c, filter.id, schemaFor(c));
  const connected: string[] = [];
  const out = cards.map((c) => {
    if (c.kind !== 'question' || keep(c)) return c;
    const m = autoMapping(filter, c.question, schemaFor(c), filter.type === 'category' || filter.type === 'text' || filter.type === 'number' ? domain : null);
    const rest = { ...c.mappings };
    delete rest[filter.id];
    if (!m) return { ...c, mappings: rest };
    const next = { ...c, mappings: { ...rest, [filter.id]: m } };
    if (m.field) domain ??= domainOf(next, filter.id, schemaFor(c));
    connected.push(c.key);
    return next;
  });
  return { cards: out, connected };
}
