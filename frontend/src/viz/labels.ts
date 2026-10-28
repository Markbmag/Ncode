/**
 * What a result column is called on screen (M11): its friendly name (the builder's readable
 * names, or the data model's in the UI language) and its description for hovers. The technical
 * name stays the column's identity (chart settings, CSV, sorting). Pure, tested in tests/viz.test.ts.
 */
import type { ColumnType, ResultColumn } from '../api';
import { t } from '../i18n/index.ts';
import { descriptionOf, pickText } from '../lib/names.ts';

type Labelled = Pick<ResultColumn, 'name' | 'display_name' | 'description' | 'translations'>;

/** The column's name to show: friendly when there is one, else as the query named it (SQL keeps its aliases). */
export function columnTitle(col: Labelled | undefined, fallback = ''): string {
  if (!col) return fallback;
  return pickText(col.display_name, col.translations, 'display_name') ?? col.name;
}

/** The data model's description of the column, in the UI language. */
export function columnDescription(col: Labelled | undefined): string | null {
  return col ? descriptionOf(col) : null;
}

/** The friendly name of a column of the table by its technical name (chart axes, legends, settings). */
export function titleOf(columns: Labelled[], name: string | undefined): string {
  if (!name) return '';
  return columnTitle(columns.find((c) => c.name === name), name);
}

/** A column type in plain words. */
export function typeWord(type: ColumnType): string {
  switch (type) {
    case 'string':
      return t('text');
    case 'number':
      return t('number');
    case 'date':
      return t('date');
    case 'datetime':
      return t('date and time');
    case 'time':
      return t('time of day');
    case 'boolean':
      return t('yes / no');
    case 'json':
      return 'JSON';
    case 'binary':
      return t('file data');
    default:
      return t('unknown type');
  }
}
