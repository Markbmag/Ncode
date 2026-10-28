/**
 * Glossary (M11): business terms such as OEE, scrap rate or takt (backend/app/glossary.py).
 *
 * A term has a base text (whatever the admin typed first, usually English) and translations
 * {"ru": {"term", "definition"}}; the UI shows its own language and falls back to the base.
 * Terms link to metrics, columns and questions; termsFor() finds the terms that explain a metric
 * or a column ("See glossary: Scrap rate"). Pure, tested in tests/glossary.test.ts.
 */
import { pickText } from '../lib/names.ts';
import type { Translations } from '../lib/names.ts';
import type { Verified } from '../library/verified.ts';
import { locale } from '../i18n/index.ts';

/** Read links also carry what to show; "missing" / "archived" reach admins only. */
interface LinkState {
  archived?: boolean;
  missing?: boolean;
}
export interface MetricLink extends LinkState {
  kind: 'metric';
  id: number;
  name?: string;
  connection?: string;
  translations?: Translations | null;
}
export interface ColumnLink extends LinkState {
  kind: 'column';
  connection: string;
  table: string;
  column: string;
  display_name?: string | null;
  translations?: Translations | null;
}
export interface QuestionLink extends LinkState {
  kind: 'question';
  id: number;
  name?: string;
  verified?: Verified | null;
}
export type RelatedLink = MetricLink | ColumnLink | QuestionLink;

export interface GlossaryTerm {
  id: number;
  term: string;
  definition: string;
  translations: Record<string, { term?: string; definition?: string }>;
  synonyms: string[];
  related: RelatedLink[];
  archived: boolean;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
}

/** What POST / PUT /api/glossary take. */
export interface TermBody {
  term: string;
  definition: string;
  translations: Record<string, { term?: string; definition?: string }>;
  synonyms: string[];
  related: ({ kind: 'metric' | 'question'; id: number } | { kind: 'column'; connection: string; table: string; column: string })[];
}

export const termName = (term: GlossaryTerm): string => pickText(term.term, term.translations, 'term') ?? term.term;
export const termDefinition = (term: GlossaryTerm): string => pickText(term.definition, term.translations, 'definition') ?? term.definition;

const fold = (s: string) => s.trim().toLocaleLowerCase();

/** The other names a term is known by (base or translated name, synonyms), without the one shown. */
export function otherNames(term: GlossaryTerm): string[] {
  const shown = fold(termName(term));
  const seen = new Set([shown]);
  const out: string[] = [];
  for (const n of [term.term, ...Object.values(term.translations).map((x) => x?.term ?? ''), ...term.synonyms]) {
    const key = fold(n);
    if (key && !seen.has(key)) {
      seen.add(key);
      out.push(n.trim());
    }
  }
  return out;
}

/** Alphabetical by the name shown (UI language), grouped by its first letter; digits and signs under "#". */
export function groupByLetter(terms: GlossaryTerm[]): { letter: string; terms: GlossaryTerm[] }[] {
  const sorted = [...terms].sort((a, b) => termName(a).localeCompare(termName(b), locale(), { sensitivity: 'base' }) || a.id - b.id);
  const groups: { letter: string; terms: GlossaryTerm[] }[] = [];
  for (const term of sorted) {
    const first = termName(term).trim().charAt(0).toLocaleUpperCase(locale());
    const letter = /\p{L}/u.test(first) ? first : '#';
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.terms.push(term);
    else groups.push({ letter, terms: [term] });
  }
  return groups;
}

export type GlossaryTarget = { metric: number } | { connection: string; table: string; column: string };

/** The terms that link to a metric or a column, in the order they are shown. */
export function termsFor(terms: GlossaryTerm[] | undefined, target: GlossaryTarget): GlossaryTerm[] {
  const hit = (link: RelatedLink) =>
    'metric' in target
      ? link.kind === 'metric' && link.id === target.metric
      : link.kind === 'column' && link.connection === target.connection && link.table === target.table && link.column === target.column;
  return (terms ?? []).filter((term) => !term.archived && term.related.some((link) => !link.missing && hit(link)));
}

export function linkKey(link: RelatedLink | TermBody['related'][number]): string {
  return link.kind === 'column' ? `column:${link.connection}:${link.table}:${link.column}` : `${link.kind}:${link.id}`;
}

/** Only what identifies a link: names and flags are read from the server, not saved. */
export function bareLink(link: RelatedLink): TermBody['related'][number] {
  return link.kind === 'column'
    ? { kind: 'column', connection: link.connection, table: link.table, column: link.column }
    : { kind: link.kind, id: link.id };
}

// ---------------------------------------------------------------- the editor form

export interface TermDraft {
  term: string;
  definition: string;
  ruTerm: string;
  ruDefinition: string;
  synonyms: string; // comma-separated
  related: RelatedLink[];
}

export function draftOf(term: GlossaryTerm | null): TermDraft {
  return {
    term: term?.term ?? '',
    definition: term?.definition ?? '',
    ruTerm: term?.translations.ru?.term ?? '',
    ruDefinition: term?.translations.ru?.definition ?? '',
    synonyms: (term?.synonyms ?? []).join(', '),
    related: term?.related ?? [],
  };
}

export const splitSynonyms = (text: string): string[] =>
  text
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** The body to save; translations into other languages than Russian (made through the API) stay. */
export function bodyOf(draft: TermDraft, original: GlossaryTerm | null = null): TermBody {
  const translations: TermBody['translations'] = { ...(original?.translations ?? {}) };
  const ru = { term: draft.ruTerm.trim() || undefined, definition: draft.ruDefinition.trim() || undefined };
  if (ru.term || ru.definition) translations.ru = ru;
  else delete translations.ru;
  return {
    term: draft.term.trim(),
    definition: draft.definition.trim(),
    translations,
    synonyms: splitSynonyms(draft.synonyms),
    related: draft.related.map(bareLink),
  };
}

export const canSave = (draft: TermDraft): boolean => draft.term.trim() !== '' && draft.definition.trim() !== '';
