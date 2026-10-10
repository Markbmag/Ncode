import { ComingSoon } from './ComingSoon';

export default function DashboardsPage() {
  return (
    <ComingSoon
      title="Dashboards"
      milestone="M5"
      points={[
        'Drag-and-resize cards made from saved questions, text and headings.',
        'Shared filters (date range, category, number) applied to every card.',
        'Auto-refresh, full-screen TV mode and export.',
      ]}
    />
  );
}
