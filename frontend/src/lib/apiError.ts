/**
 * Readable messages from failed API calls (M10). Pure logic, so node tests can check it:
 * src/api.ts turns an axios error into an ApiFailure and calls these.
 *
 *   no answer at all        -> "The server is not reachable ..."   (network down, backend stopped)
 *   JSON with "detail"      -> the server's sentence (already in the UI language, see Accept-Language)
 *   validation list (422)   -> "<field>: <message>" of the first problem
 *   5xx without JSON        -> "The server ran into a problem (502) ..." (e.g. a proxy in front of it)
 */
import { t } from '../i18n/index.ts';

export interface ApiFailure {
  /** false when the request never got an answer */
  answered: boolean;
  status?: number;
  data?: unknown;
}

function detailOf(data: unknown): unknown {
  return typeof data === 'object' && data !== null && 'detail' in data ? (data as { detail: unknown }).detail : undefined;
}

export function failureMessage(failure: ApiFailure, fallback: string): string {
  const detail = detailOf(failure.data);
  if (typeof detail === 'string' && detail) return detail;
  if (Array.isArray(detail) && detail.length > 0) {
    const first: unknown = detail[0];
    if (typeof first === 'object' && first !== null && 'msg' in first) {
      const msg = String((first as { msg: unknown }).msg);
      const loc = (first as { loc?: unknown }).loc;
      const field = Array.isArray(loc) ? loc.filter((p) => typeof p === 'string' && p !== 'body' && p !== 'query').pop() : undefined;
      return typeof field === 'string' ? `${field}: ${msg}` : msg;
    }
  }
  if (!failure.answered) return t('The server is not reachable. Make sure the backend is running.');
  if (failure.status !== undefined && failure.status >= 500) {
    return t('The server ran into a problem ({status}). Try again; if it keeps happening, tell your administrator.', {
      status: failure.status,
    });
  }
  return fallback;
}

/** The database's own text behind a message ("details"), for analysts. */
export function failureDetails(failure: ApiFailure): string | undefined {
  const data = failure.data;
  if (typeof data !== 'object' || data === null || !('details' in data)) return undefined;
  const details = (data as { details: unknown }).details;
  return typeof details === 'string' && details ? details : undefined;
}

/**
 * Whether "Try again" can help: no answer, a server error (5xx), a timeout or too many requests.
 * Another 4xx (not found, no access, invalid) answers the same the next time.
 */
export function failureRetryable(failure: ApiFailure | null): boolean {
  if (!failure || !failure.answered || failure.status === undefined) return true;
  return failure.status >= 500 || failure.status === 408 || failure.status === 429;
}
