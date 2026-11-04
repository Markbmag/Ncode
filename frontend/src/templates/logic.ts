/**
 * The mapping dialog's bookkeeping (pure, tested in tests/templates.test.ts).
 *
 * The server suggests an answer for every role the request leaves out; a role sent as null means
 * "not in my data" and stays empty. So the dialog keeps the mapping the server returned plus the
 * roles the person skipped, and on each change sends both.
 */
import type { Mapping, TemplateInfo, TemplateRole } from './types';

export interface Answers {
  mapping: Mapping;
  skipped: string[];  // optional roles answered "not in my data"
}

export const NO_ANSWERS: Answers = { mapping: {}, skipped: [] };

/** What to send to /suggest: the answers so far, skipped roles as null. */
export function requestMapping(answers: Answers): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = { ...answers.mapping };
  for (const key of answers.skipped) out[key] = null;
  return out;
}

/**
 * The answers after the person picked `value` for a role (null: "not in my data").
 * A new table clears the columns asked about it, so the server suggests them again from that table.
 */
export function answer(template: TemplateInfo, answers: Answers, key: string, value: string | number | null): Answers {
  const role = template.roles.find((r) => r.key === key);
  if (!role) return answers;
  const mapping: Mapping = { ...answers.mapping };
  let skipped = answers.skipped.filter((k) => k !== key);
  if (role.kind === 'table') {
    const before = answers.mapping[key];
    if (before !== value) {
      for (const r of template.roles) {
        if (r.table === key) {
          delete mapping[r.key];
          skipped = skipped.filter((k) => k !== r.key);
        }
      }
    }
  }
  if (value === null || value === '') {
    delete mapping[key];
    skipped = [...skipped, key];
  } else {
    mapping[key] = value;
  }
  return { mapping, skipped };
}

export interface RoleGroup {
  table: TemplateRole | null;  // null: the numbers typed in
  columns: TemplateRole[];
}

/** The questions in the order they are asked: each table, then the columns asked about it. */
export function roleGroups(template: TemplateInfo, answers: Answers): RoleGroup[] {
  const groups: RoleGroup[] = [];
  for (const table of template.roles.filter((r) => r.kind === 'table')) {
    const chosen = answers.mapping[table.key] !== undefined;
    groups.push({ table, columns: chosen ? template.roles.filter((r) => r.table === table.key) : [] });
  }
  const values = template.roles.filter((r) => r.kind === 'value');
  if (values.length) groups.push({ table: null, columns: values });
  return groups;
}

/** A role the person may leave empty ("not in my data"). */
export function canSkip(role: TemplateRole): boolean {
  return !role.required;
}

/** The number typed for a value role, or null when it is not a usable number. */
export function parseMinutes(text: string): number | null {
  const n = Number(text.replace(',', '.').trim());
  return text.trim() !== '' && Number.isFinite(n) && n > 0 && n <= 100000 ? n : null;
}
