import { useSyncExternalStore } from 'react';
import { subscribe, waitingNow } from './queue';
import type { Stored } from './queue';

/** The changes waiting to be sent (all of them, or one task's). */
export function useWaiting(cardId?: number): Stored[] {
  const all = useSyncExternalStore(subscribe, waitingNow, waitingNow);
  return cardId === undefined ? all : all.filter((op) => op.cardId === cardId);
}
