import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { entryTarget, loadService } from './service';

/**
 * Around the BI frame: on the home page right after the app was opened, the launcher (nothing
 * chosen yet) or Kanban (the last choice) instead. React Router numbers this tab's history
 * entries; 0 is the first, so coming back to "/" from inside the app never redirects.
 */
export function HomeEntry({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const state: unknown = typeof window !== 'undefined' ? window.history.state : null;
  const idx = state && typeof state === 'object' && 'idx' in state ? Number((state as { idx: unknown }).idx) : 0;
  const target = pathname === '/' ? entryTarget(idx, loadService()) : null;
  return target ? <Navigate to={target} replace /> : <>{children}</>;
}
