import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './shell/AppShell';
import { HomeEntry } from './launcher/HomeEntry';
import { PageSpinner } from './launcher/PageSpinner';
import { LAUNCHER_PATH } from './launcher/service';

// Each section is its own chunk: heavy editors and charts (M2, M3) only load when opened.
const HomePage = lazy(() => import('./pages/HomePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const BrowsePage = lazy(() => import('./pages/BrowsePage'));
const QuestionsPage = lazy(() => import('./pages/QuestionsPage'));
const SqlPage = lazy(() => import('./pages/SqlPage'));
const LibraryPage = lazy(() => import('./pages/LibraryPage'));
const SavedQuestionPage = lazy(() => import('./pages/SavedQuestionPage'));
const DashboardsPage = lazy(() => import('./pages/DashboardsPage'));
const DashboardPage = lazy(() => import('./pages/DashboardPage'));
const CombinePage = lazy(() => import('./pages/CombinePage'));
const DatasetsPage = lazy(() => import('./pages/DatasetsPage'));
const XrayPage = lazy(() => import('./pages/XrayPage'));
const SubscriptionsPage = lazy(() => import('./pages/SubscriptionsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ChartGalleryPage = lazy(() => import('./pages/ChartGalleryPage'));
const GlossaryPage = lazy(() => import('./pages/GlossaryPage'));
// The launcher (Search & BI or Kanban; outside the BI menu) and Ncode - Kanban, a separate service with its own frame (K1).
const LauncherPage = lazy(() => import('./launcher/LauncherPage'));
const KanbanApp = lazy(() => import('./kanban/KanbanApp'));

export function AppRoutes() {
  return (
    <Routes>
      <Route path={LAUNCHER_PATH} element={<Suspense fallback={<PageSpinner />}><LauncherPage /></Suspense>} />
      <Route path="kanban/*" element={<Suspense fallback={<PageSpinner />}><KanbanApp /></Suspense>} />
      <Route element={<HomeEntry><AppShell /></HomeEntry>}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="library" element={<LibraryPage />} />
        <Route path="library/c/:id" element={<LibraryPage />} />
        <Route path="library/archive" element={<LibraryPage archive />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="questions/:id" element={<SavedQuestionPage />} />
        <Route path="sql" element={<SqlPage />} />
        <Route path="combine" element={<CombinePage />} />
        <Route path="datasets" element={<DatasetsPage />} />
        <Route path="xray" element={<XrayPage />} />
        <Route path="dashboards" element={<DashboardsPage />} />
        <Route path="dashboards/:id" element={<DashboardPage />} />
        <Route path="subscriptions" element={<SubscriptionsPage />} />
        <Route path="glossary" element={<GlossaryPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/charts" element={<ChartGalleryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
