/**
 * markStep('change_filter') ticks a step of the new-user checklist (./steps.ts) in the personal
 * settings (PUT /api/account/prefs). Cheap to call often: once a step is known to be done (or the
 * checklist is hidden), nothing is sent. Calls run one after another, each on the settings as
 * saved, so two steps marked at the same moment both stay ticked.
 */
import { getToken } from '../api';
import { queryClient } from '../lib/queryClient';
import { homeApi, homeKeys } from './api';
import { checklistOf, withStep } from './steps';
import type { ChecklistState, StepId } from './steps';

let known: { token: string | null; state: ChecklistState } | null = null; // as last read or saved in this tab
let chain: Promise<unknown> = Promise.resolve();

const current = (): ChecklistState | null => (known && known.token === getToken() ? known.state : null); // another sign-in: read again
const keep = (state: ChecklistState) => {
  known = { token: getToken(), state };
};

/** The home page tells what it loaded, so the other pages need not ask. */
export function rememberChecklist(state: ChecklistState): void {
  keep({ done: state.done, hidden: state.hidden });
}

export function markStep(step: StepId): void {
  const state = current();
  if (state && (state.hidden || state.done.includes(step))) return;
  chain = chain
    .then(async () => {
      const saved = checklistOf(await homeApi.prefs());
      keep(saved);
      const next = saved.hidden ? null : withStep(saved, step);
      if (!next) return;
      keep(checklistOf(await homeApi.savePrefs({ checklist: next })));
      await queryClient.invalidateQueries({ queryKey: homeKeys.home });
    })
    .catch(() => undefined); // a tick is never worth an error message
}

/** "Hide" on the home page (and "Show the first steps again"). */
export async function setChecklistHidden(hidden: boolean): Promise<void> {
  const saved = checklistOf(await homeApi.prefs());
  keep(checklistOf(await homeApi.savePrefs({ checklist: { ...saved, hidden } })));
  await queryClient.invalidateQueries({ queryKey: homeKeys.home });
}
