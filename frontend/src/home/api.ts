/** The home page API (backend/app/home.py): GET /api/home, the "Start here" setting, personal settings. */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { libraryKeys } from '../library/api';
import type { QuestionKind } from '../library/api';
import type { Verified } from '../library/verified';
import { queryClient } from '../lib/queryClient';
import type { ChecklistState, StepId } from './steps';

export interface HomeItem {
  type: 'question' | 'dashboard';
  id: number;
  name: string;
  description: string | null;
  collection: { id: number; name: string; mine: boolean } | null;
  verified: Verified | null;
  kind?: QuestionKind; // questions
  viewed_at?: number | null;
  favorite?: boolean; // "your dashboards"
}

export interface StartHere {
  id: number;
  name: string;
  description: string | null;
  items: HomeItem[];
  total: number;
  /** someone besides admins can see it */
  shared: boolean;
}

export interface HomeData {
  recent: HomeItem[];
  start_here: StartHere | null;
  dashboards: HomeItem[];
  checklist: ChecklistState & { steps: StepId[] };
}

// inside the library's keys: saving, moving or archiving anything refreshes the home page too
export const homeKeys = {
  home: [...libraryKeys.all, 'home'] as const,
};

export function useHome(enabled = true) {
  return useQuery({
    queryKey: homeKeys.home,
    enabled,
    staleTime: 0, // what you opened a moment ago belongs on it
    queryFn: async () => (await http.get<HomeData>('/api/home')).data,
  });
}

export const homeApi = {
  /** admins: the collection everyone sees first (null: none) */
  setStartHere: async (collectionId: number | null) => {
    const { data } = await http.put<{ start_here: StartHere | null }>('/api/admin/start-here', { collection_id: collectionId });
    await queryClient.invalidateQueries({ queryKey: homeKeys.home });
    return data.start_here;
  },
  prefs: async () => (await http.get<Record<string, unknown>>('/api/account/prefs')).data,
  /** sets the keys given (null removes one) and keeps the others */
  savePrefs: async (changes: Record<string, unknown>) => (await http.put<Record<string, unknown>>('/api/account/prefs', changes)).data,
};
