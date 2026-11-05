/** Changes made without a connection (K4): kept on the phone, sent in order when it is back.
 * Ticks of steps, moves (Done included), comments and photos / files. Creating tasks still needs the
 * connection. A change the server refuses later (the task was deleted meanwhile...) is dropped and
 * reported; nothing else is lost. */
import axios from 'axios';
import { addComment, moveCard, moveCardToTop, updateChecklistItem, uploadAttachment, uploadThumb } from '../api';
import { isImage } from '../logic';
import { makeThumbnail } from '../thumb';
import * as idb from './idb';

export type Op =
  | { kind: 'tick'; cardId: number; itemId: number; done: boolean; label: string }
  | { kind: 'move'; cardId: number; columnId: number; position: number | null; label: string }
  | { kind: 'comment'; cardId: number; body: string; label: string }
  | { kind: 'attach'; cardId: number; name: string; type: string; blob: Blob; label: string };
export type Stored = Op & { id: number; at: number };

export const QUEUED = Symbol('queued');
export type Queued = typeof QUEUED;
export const isQueued = (v: unknown): v is Queued => v === QUEUED;

// who is listening for the number of waiting changes (the banner, the task page)
let waiting: Stored[] = [];
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());
export const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const waitingNow = () => waiting;

export async function reload(): Promise<void> {
  waiting = (await idb.all<Stored>('queue')).sort((a, b) => a.id - b.id);
  changed();
}

/** No answer at all (no connection, the server out of reach): worth keeping and trying again. */
export function isNetworkError(err: unknown): boolean {
  return axios.isAxiosError(err) && !err.response;
}

export async function enqueue(op: Op): Promise<Queued> {
  await idb.put('queue', { ...op, at: Date.now() });
  await reload();
  return QUEUED;
}

/** Sends now when there is a connection; keeps it for later when there is none (or no answer comes). */
export async function sendOrQueue<T>(op: Op, send: () => Promise<T>): Promise<T | Queued> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return enqueue(op);
  try {
    return await send();
  } catch (err) {
    if (isNetworkError(err)) return enqueue(op);
    throw err;
  }
}

async function sendOne(op: Stored): Promise<void> {
  switch (op.kind) {
    case 'tick':
      await updateChecklistItem(op.itemId, { done: op.done });
      return;
    case 'move':
      await (op.position === null ? moveCardToTop(op.cardId, op.columnId) : moveCard(op.cardId, op.columnId, op.position));
      return;
    case 'comment':
      await addComment(op.cardId, op.body);
      return;
    case 'attach': {
      const res = await uploadAttachment(op.cardId, op.blob, op.name, op.type);
      if (isImage(op.type) && res?.id) {
        const thumb = await makeThumbnail(op.blob);
        if (thumb) await uploadThumb(res.id, thumb).catch(() => undefined);
      }
    }
  }
}

let flushing: Promise<{ sent: number; failed: string[] }> | null = null;

/** Sends what is waiting, oldest first; stops at the first change that gets no answer. */
export function flush(): Promise<{ sent: number; failed: string[] }> {
  if (flushing) return flushing;
  flushing = (async () => {
    await reload();
    let sent = 0;
    const failed: string[] = [];
    for (const op of waiting) {
      try {
        await sendOne(op);
        sent += 1;
      } catch (err) {
        if (isNetworkError(err)) break; // still no connection: try again later
        failed.push(op.label); // refused for good (e.g. the task is gone): drop it
      }
      await idb.remove('queue', op.id);
    }
    await reload();
    return { sent, failed };
  })().finally(() => {
    flushing = null;
  });
  return flushing;
}

export async function waitingCount(): Promise<number> {
  return (await idb.keys('queue')).length;
}

export async function forgetQueue(): Promise<void> {
  await idb.clear('queue');
  await reload();
}
