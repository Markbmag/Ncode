/** The boards and tasks last seen, kept on the phone (K4), so Kanban opens without a connection.
 * Only Kanban's own data (no files), only for the person signed in: another person signing in on the
 * same phone starts empty, and signing out clears it. */
import type { QueryClient, QueryKey } from '@tanstack/react-query';
import * as idb from './idb';

const KEEP = (key: QueryKey) => key[0] === 'kanban' && key[1] !== 'file' && !key.includes('finished');
interface Entry {
  key: QueryKey;
  data: unknown;
  at: number;
}

export async function hydrate(client: QueryClient, user: string): Promise<void> {
  const owner = await idb.get<string>('meta', 'user');
  if (owner !== user) {
    // someone else on this phone: their boards and their unsent changes are not this person's
    await idb.clear('cache');
    await idb.clear('queue');
    await idb.put('meta', user, 'user');
    return;
  }
  for (const e of await idb.all<Entry>('cache')) {
    // never over newer data the page already has
    if (client.getQueryData(e.key) === undefined) client.setQueryData(e.key, e.data, { updatedAt: e.at });
  }
}

/** Keeps every Kanban query's latest data; returns the function that stops it. */
export function persist(client: QueryClient): () => void {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' || event.action.type !== 'success') return;
    const q = event.query;
    if (!KEEP(q.queryKey) || q.state.data === undefined) return;
    const id = JSON.stringify(q.queryKey);
    clearTimeout(timers.get(id));
    timers.set(id, setTimeout(() => void idb.put('cache', { key: q.queryKey, data: q.state.data, at: q.state.dataUpdatedAt }, id), 400));
  });
}

export async function forgetCache(): Promise<void> {
  await idb.clear('cache');
  await idb.clear('meta');
}
