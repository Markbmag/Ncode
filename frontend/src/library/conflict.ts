/**
 * Edit conflicts (M10): saves send the `updated_at` the editor loaded as `base_updated_at`;
 * the server answers 409 with the header X-Edit-Conflict when someone else saved meanwhile.
 * "Save mine anyway" sends the same change without the base (no check).
 */

/** Was this request refused because someone else saved the item meanwhile? (Other 409s, e.g. "archive it first", are not.) */
export function isEditConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const response = (error as { response?: { status?: number; headers?: Record<string, unknown> } }).response;
  return response?.status === 409 && String(response.headers?.['x-edit-conflict'] ?? '') === '1';
}

/** The body with the version it was made on - or without, to overwrite whatever is saved now. */
export function withBase<T extends object>(body: T, base: number | null | undefined, overwrite = false): T & { base_updated_at?: number } {
  return overwrite || base === null || base === undefined ? body : { ...body, base_updated_at: base };
}
