/**
 * A saved question opens as its result (M12); "Edit" opens the builder, SQL editor or Combine around
 * it. While one of them edits a saved question, its header offers "Done" to go back to the result.
 */
import { createContext, useContext } from 'react';

export interface EditorMode {
  /** back to the result (the header asks first when there are unsaved changes) */
  onDone: () => void;
}

export const EditorModeContext = createContext<EditorMode | null>(null);

export const useEditorMode = (): EditorMode | null => useContext(EditorModeContext);

/** ?edit=1 keeps the editor open across a reload; a link without it shows the result. */
export const EDIT_PARAM = 'edit';

export function withEditing(search: URLSearchParams, on: boolean): URLSearchParams {
  const next = new URLSearchParams(search);
  if (on) next.set(EDIT_PARAM, '1');
  else next.delete(EDIT_PARAM);
  return next;
}
