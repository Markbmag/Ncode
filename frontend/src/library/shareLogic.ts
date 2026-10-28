/**
 * Who can see a saved question or dashboard, and where it can move to be shared (the Share
 * dialog, M11). Pure; unit-tested in tests/home.test.ts.
 */
import { flattenTree } from './tree.ts';
import type { TreeNode } from './tree.ts';

/** The fields of a collection (GET /api/collections) this needs. */
export interface ShareCollection {
  id: number;
  name: string;
  parent_id: number | null;
  personal: boolean;
  mine: boolean;
  archived: boolean;
  access: 'view' | 'edit' | null;
  can_manage: boolean;
  shared: boolean;
}

/**
 * private: in a personal collection (or inside one) - only its owner and admins, and it cannot be shared;
 * restricted: an ordinary collection nobody has been given access to yet;
 * shared: people, a group or everyone were given access (here or on a collection above).
 */
export type Audience = 'private' | 'restricted' | 'shared';

export function audienceOf(collections: ShareCollection[], id: number): Audience {
  const byId = new Map(collections.map((c) => [c.id, c]));
  let node = byId.get(id);
  for (let guard = 0; node && guard < 30; guard++) {
    if (node.personal) return 'private';
    node = node.parent_id !== null ? byId.get(node.parent_id) : undefined;
  }
  return byId.get(id)?.shared ? 'shared' : 'restricted';
}

/** Collections the item can move to so that others can see it: editable, not private, not where it is. Tree order. */
export function shareTargets<T extends ShareCollection>(collections: T[], currentId: number): TreeNode<T>[] {
  return flattenTree(collections).filter(
    (c) => c.id !== currentId && c.access === 'edit' && !c.archived && audienceOf(collections, c.id) !== 'private',
  );
}

/** Of the questions on a dashboard, those in the given collection (the person's own): they move along. */
export function questionsToMove(cardQuestionIds: (number | null | undefined)[], inCollection: number[]): number[] {
  const here = new Set(inCollection);
  return [...new Set(cardQuestionIds.filter((id): id is number => typeof id === 'number' && here.has(id)))];
}
