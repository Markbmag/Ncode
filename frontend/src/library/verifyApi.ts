/** Verified content (M11): POST / DELETE /api/{questions|dashboards}/{id}/verify, admins only. */
import { http } from '../api';
import { dashboardKeys } from '../dashboards/api';
import type { Dashboard } from '../dashboards/types';
import { queryClient } from '../lib/queryClient';
import { libraryKeys, refreshLibrary } from './api';
import type { SavedQuestion } from './api';
import type { Verified } from './verified.ts';

export type VerifiableKind = 'question' | 'dashboard';

/** Mark it or take the mark away; the item's cache and the lists refresh. */
export async function setVerified(kind: VerifiableKind, id: number, on: boolean): Promise<Verified | null> {
  const url = `/api/${kind === 'question' ? 'questions' : 'dashboards'}/${id}/verify`;
  const { data } = on ? await http.post<SavedQuestion | Dashboard>(url) : await http.delete<SavedQuestion | Dashboard>(url);
  queryClient.setQueryData(kind === 'question' ? libraryKeys.question(id) : dashboardKeys.one(id), data);
  await refreshLibrary();
  return data.verified ?? null;
}
