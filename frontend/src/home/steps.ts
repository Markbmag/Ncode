/**
 * The new-user checklist on the home page (M11): five first steps that tick themselves.
 * Pure; unit-tested in tests/home.test.ts. The server (backend/app/home.py) also ticks the
 * steps it can see (a dashboard opened, a search, a question run, a question saved); the
 * browser marks the rest with markStep() in ./checklist.ts.
 */
import { t } from '../i18n/index.ts';

export type StepId = 'open_dashboard' | 'change_filter' | 'find_record' | 'ask_question' | 'save_question';

export const STEPS: StepId[] = ['open_dashboard', 'change_filter', 'find_record', 'ask_question', 'save_question'];

/** What GET /api/home answers in "checklist", and what is kept in the personal settings. */
export interface ChecklistState {
  done: StepId[];
  hidden: boolean;
}

export interface StepInfo {
  id: StepId;
  label: string;
  hint: string;
  /** where to do it */
  to: string;
  action: string;
}

export function stepInfo(id: StepId): StepInfo {
  switch (id) {
    case 'open_dashboard':
      return { id, label: t('Open a dashboard'), hint: t('See the numbers your team watches, all on one page.'), to: '/dashboards', action: t('Open dashboards') };
    case 'change_filter':
      return { id, label: t('Change a filter'), hint: t('On a dashboard, pick another date or value at the top: every card follows.'), to: '/dashboards', action: t('Pick a dashboard') };
    case 'find_record':
      return { id, label: t('Find a record'), hint: t('Type an order number, a VIN or a name into Search, or open a table in Browse.'), to: '/search', action: t('Search') };
    case 'ask_question':
      return { id, label: t('Ask a question'), hint: t('Pick a table, then count, add up or group its rows: no SQL needed.'), to: '/questions', action: t('New question') };
    case 'save_question':
      return { id, label: t('Save it'), hint: t('Press Save on your question: it goes to your collection, ready for a dashboard.'), to: '/questions', action: t('New question') };
  }
}

const isStep = (s: unknown): s is StepId => typeof s === 'string' && (STEPS as string[]).includes(s);

/** The checklist kept in the personal settings ({"checklist": {...}}), whatever was stored there. */
export function checklistOf(prefs: unknown): ChecklistState {
  const raw = prefs && typeof prefs === 'object' ? (prefs as Record<string, unknown>).checklist : undefined;
  if (!raw || typeof raw !== 'object') return { done: [], hidden: false };
  const { done, hidden } = raw as { done?: unknown; hidden?: unknown };
  const list = Array.isArray(done) ? done.filter(isStep) : [];
  return { done: STEPS.filter((s) => list.includes(s)), hidden: hidden === true };
}

/** The checklist with `step` ticked, or null when it already was (nothing to save). */
export function withStep(state: ChecklistState, step: StepId): ChecklistState | null {
  if (state.done.includes(step)) return null;
  return { ...state, done: STEPS.filter((s) => s === step || state.done.includes(s)) };
}

export interface Progress {
  /** shown on the home page: not hidden and not finished */
  visible: boolean;
  next: StepId | null;
  doneCount: number;
  total: number;
}

export function progress(state: ChecklistState): Progress {
  const done = STEPS.filter((s) => state.done.includes(s));
  const next = STEPS.find((s) => !done.includes(s)) ?? null;
  return { visible: !state.hidden && next !== null, next, doneCount: done.length, total: STEPS.length };
}
