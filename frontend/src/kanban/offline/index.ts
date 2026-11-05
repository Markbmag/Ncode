/** Kanban without a connection (K4): the cache of what was last seen and the queue of changes. */
import { forgetCache } from './cache';
import { forgetQueue } from './queue';

export { hydrate, persist } from './cache';
export { enqueue, flush, isNetworkError, isQueued, QUEUED, reload, sendOrQueue, subscribe, waitingCount, waitingNow } from './queue';
export type { Op, Queued, Stored } from './queue';

/** On sign-out and when the session ends: nothing of one person stays on a shared phone. */
export async function forgetOfflineData(): Promise<void> {
  await Promise.all([forgetCache(), forgetQueue()]);
}
