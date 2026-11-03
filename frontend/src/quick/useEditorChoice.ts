/**
 * Which editor "New question" opens (M12): the quick question unless the person switched to the
 * full editor. The choice is a personal setting (PUT /api/account/prefs {"question_editor": ...}),
 * also kept in this browser so the page opens without waiting; ?editor=full|quick in the link wins.
 */
import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { homeApi } from '../home/api';
import { queryClient } from '../lib/queryClient';
import { loadJson, saveJson } from '../lib/storage';
import { EDITOR_PREF, editorMode } from './quick';
import type { EditorMode } from './quick';

const LOCAL_KEY = 'ncode_question_editor';
const PREFS_KEY = ['account-prefs'] as const;
export const EDITOR_PARAM = 'editor';

export function useEditorChoice(): { mode: EditorMode; ready: boolean; choose: (mode: EditorMode) => void; open: (mode: EditorMode) => void } {
  const [search, setSearch] = useSearchParams();
  const prefs = useQuery({ queryKey: PREFS_KEY, queryFn: homeApi.prefs, staleTime: 5 * 60_000 });
  const asked = search.get(EDITOR_PARAM);
  const local = loadJson<unknown>(LOCAL_KEY, null);
  const mode = editorMode(asked, prefs.data?.[EDITOR_PREF], local);
  const ready = asked !== null || local !== null || !prefs.isPending;

  /** this editor for this question only (the link says so, a reload keeps it) */
  const open = useCallback(
    (next: EditorMode) =>
      setSearch((prev) => {
        const out = new URLSearchParams(prev);
        out.set(EDITOR_PARAM, next);
        return out;
      }),
    [setSearch],
  );

  /** this editor from now on: remembered for the person */
  const choose = useCallback(
    (next: EditorMode) => {
      saveJson(LOCAL_KEY, next);
      queryClient.setQueryData<Record<string, unknown>>(PREFS_KEY, (old) => ({ ...(old ?? {}), [EDITOR_PREF]: next }));
      homeApi.savePrefs({ [EDITOR_PREF]: next }).catch(() => undefined); // this browser remembers it either way
      setSearch((prev) => {
        const out = new URLSearchParams(prev);
        out.delete(EDITOR_PARAM);
        return out;
      });
    },
    [setSearch],
  );

  return { mode, ready, choose, open };
}
