import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import KanbanShell from './KanbanShell';

const BoardsPage = lazy(() => import('./BoardsPage'));
const BoardPage = lazy(() => import('./BoardPage'));
const MyTasksPage = lazy(() => import('./MyTasksPage'));

/** Ncode - Kanban under /kanban: the boards, a board, a card on a board (shareable address). */
export default function KanbanApp() {
  return (
    <Routes>
      <Route element={<KanbanShell />}>
        <Route index element={<BoardsPage />} />
        <Route path="my" element={<MyTasksPage />} />
        <Route path="b/:board" element={<BoardPage />}>
          <Route path="c/:card" element={null} />
        </Route>
        <Route path="*" element={<Navigate to="/kanban" replace />} />
      </Route>
    </Routes>
  );
}
