/** History requests (M15): the versions of a question or dashboard, one version, restore. */
import { useQuery } from '@tanstack/react-query';
import { http } from '../api';
import { queryClient } from '../lib/queryClient';
import { libraryKeys } from './api';
import { dashboardKeys } from '../dashboards/api';
import type { HistoryKind, VersionDetail, VersionInfo } from './versions';

const base = (kind: HistoryKind, id: number) => `/api/${kind === 'question' ? 'questions' : 'dashboards'}/${id}/versions`;
export const versionKeys = { list: (kind: HistoryKind, id: number) => [...libraryKeys.all, 'versions', kind, id] as const };

export function useVersions(kind: HistoryKind, id: number, enabled = true) {
  return useQuery({
    queryKey: versionKeys.list(kind, id),
    enabled,
    queryFn: async () => (await http.get<{ versions: VersionInfo[]; keep: number }>(base(kind, id))).data,
  });
}

export const versions = {
  get: async <T>(kind: HistoryKind, id: number, n: number) => (await http.get<VersionDetail<T>>(`${base(kind, id)}/${n}`)).data,
  /** Bring a version back: the restored question or dashboard, also put into the cache the page shows. */
  restore: async (kind: HistoryKind, id: number, n: number): Promise<unknown> => {
    const data = (await http.post<unknown>(`${base(kind, id)}/${n}/restore`)).data;
    queryClient.setQueryData(kind === 'question' ? libraryKeys.question(id) : dashboardKeys.one(id), data);
    await queryClient.invalidateQueries({ queryKey: libraryKeys.all });
    return data;
  },
  runUrl: (id: number, n: number) => `${base('question', id)}/${n}/run`,
};

