/** Admin → Broken content (backend/app/content/health.py): the report and its sentences. */
import { t } from '../i18n/index.ts';

export type BrokenKind = 'question' | 'dashboard' | 'subscription' | 'dataset';

export interface BrokenItem {
  kind: BrokenKind;
  id: number;
  name: string;
  owner: string | null;
  collection: { id: number; name: string | null } | null;
  problem: string; // the server's English sentence (fallback)
  code: string;
  params: Record<string, string>;
  link: string;
  connection: string | null;
}

export interface BrokenReport {
  checked_at: number;
  duration_sec: number;
  items: BrokenItem[];
  unchecked: { connection: string; label: string; questions: number; reason: string }[];
  counts: { questions: number; dashboards: number; subscriptions: number; datasets: number };
}

export const KIND_ORDER: BrokenKind[] = ['question', 'dashboard', 'subscription', 'dataset'];

/** One plain sentence per problem, in the UI language (the server's English text if the code is new). */
export function problemText(item: Pick<BrokenItem, 'code' | 'params' | 'problem'>): string {
  const p = item.params ?? {};
  let text: string;
  switch (item.code) {
    case 'missing_table': text = t('The table {table} no longer exists in {connection}.', { table: p.table, connection: p.connection }); break;
    case 'missing_column': text = t('The column {column} no longer exists.', { column: p.column }); break;
    case 'missing_join_column': text = t('A join uses a column that no longer exists ({detail}).', { detail: p.detail }); break;
    case 'no_relationship': text = t('The join to {table} relied on a relationship that no longer exists.', { table: p.table }); break;
    case 'ambiguous_column': text = t('The column {column} now exists in several tables of the question.', { column: p.column }); break;
    case 'cannot_build': text = t('The question cannot be built any more: {detail}', { detail: p.detail }); break;
    case 'missing_metric': text = t('It uses a metric that was deleted.'); break;
    case 'invalid_spec': text = t('The saved question is not valid any more: {detail}', { detail: p.detail }); break;
    case 'missing_connection': text = t('The database {connection} was removed.', { connection: p.connection }); break;
    case 'deleted_question': text = t('It shows a question that was deleted.'); break;
    case 'archived_question': text = t('It shows the question {question}, which is in the archive.', { question: p.question }); break;
    case 'deleted_dashboard': text = t('It sends a dashboard that was deleted.'); break;
    case 'deleted_dataset': text = t('It reads an uploaded file that was deleted.'); break;
    case 'missing_file': text = t("The uploaded file's data is missing on the server ({file}).", { file: p.file }); break;
    default: return item.problem;
  }
  if (p.source) text = `${t('Source {name}:', { name: p.source })} ${text}`;
  if (p.card) text = `${t('Card {name}:', { name: p.card })} ${text}`;
  return text;
}

export function groupByKind(items: BrokenItem[]): [BrokenKind, BrokenItem[]][] {
  return KIND_ORDER.map((k) => [k, items.filter((i) => i.kind === k)] as [BrokenKind, BrokenItem[]]).filter(([, list]) => list.length > 0);
}

export function kindTitle(kind: BrokenKind): string {
  return { question: t('Questions'), dashboard: t('Dashboards'), subscription: t('Subscriptions'), dataset: t('Uploaded files') }[kind];
}
