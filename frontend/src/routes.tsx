import { lazy } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import AppShell from './shell/AppShell';

// Each section is its own chunk: heavy editors and charts (M2, M3) only load when opened.
const HomePage = lazy(() => import('./pages/HomePage'));
const SearchPage = lazy(() => import('./pages/SearchPage'));
const BrowsePage = lazy(() => import('./pages/BrowsePage'));
const QuestionsPage = lazy(() => import('./pages/QuestionsPage'));
const SqlPage = lazy(() => import('./pages/SqlPage'));
const DashboardsPage = lazy(() => import('./pages/DashboardsPage'));
const AdminPage = lazy(() => import('./pages/AdminPage'));
const ChartGalleryPage = lazy(() => import('./pages/ChartGalleryPage'));

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<HomePage />} />
        <Route path="search" element={<SearchPage />} />
        <Route path="browse" element={<BrowsePage />} />
        <Route path="questions" element={<QuestionsPage />} />
        <Route path="sql" element={<SqlPage />} />
        <Route path="dashboards" element={<DashboardsPage />} />
        <Route path="admin" element={<AdminPage />} />
        <Route path="admin/charts" element={<ChartGalleryPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
