/** Which Ncode service the person used last (the launcher opens it straight away next time). */
import { loadJson, saveJson } from '../lib/storage.ts';

export type Service = 'bi' | 'kanban';
export const SERVICE_KEY = 'ncode_service';

export const SERVICE_HOME: Record<Service, string> = { bi: '/', kanban: '/kanban' };
export const LAUNCHER_PATH = '/start';

export const SERVICE_GRADIENT: Record<Service, string> = {
  bi: 'linear(to-br, brand.400, brand.600)',
  kanban: 'linear(to-br, #2dd4bf, #0d9488)',
};

export function loadService(): Service | null {
  const v = loadJson<unknown>(SERVICE_KEY, null);
  return v === 'bi' || v === 'kanban' ? v : null;
}

export function saveService(service: Service): void {
  saveJson(SERVICE_KEY, service);
}

/**
 * Where the home page sends someone who has just opened the app (the first page of this tab's
 * history): the launcher when nothing was chosen yet, Kanban when that was the last choice,
 * nowhere (the BI home itself) otherwise. Coming back to "/" from inside the app never redirects.
 */
export function entryTarget(historyIndex: number | null | undefined, last: Service | null): string | null {
  if (historyIndex !== null && historyIndex !== undefined && historyIndex > 0) return null;
  if (last === null) return LAUNCHER_PATH;
  return last === 'kanban' ? SERVICE_HOME.kanban : null;
}

/** The service a path belongs to. */
export const serviceOf = (path: string): Service => (/^\/kanban(\/|$)/.test(path) ? 'kanban' : 'bi');
