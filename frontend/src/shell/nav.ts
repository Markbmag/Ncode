import type { ComponentType } from 'react';
import type { IconProps } from '@chakra-ui/react';
import { BellIcon, ChartIcon, CodeIcon, FolderIcon, HomeIcon, LayoutIcon, MergeIcon, SearchIcon, ShieldIcon, TableIcon, UploadIcon } from '../icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  milestone?: string; // set while the section is still a placeholder
  adminOnly?: boolean;
  end?: boolean; // active only on exactly this path (saved questions live under /questions/:id)
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/browse', label: 'Browse', icon: TableIcon },
  { to: '/library', label: 'Library', icon: FolderIcon },
  { to: '/questions', label: 'New question', icon: ChartIcon, end: true },
  { to: '/sql', label: 'SQL editor', icon: CodeIcon },
  { to: '/combine', label: 'Combine', icon: MergeIcon },
  { to: '/datasets', label: 'Uploads', icon: UploadIcon },
  { to: '/dashboards', label: 'Dashboards', icon: LayoutIcon },
  { to: '/subscriptions', label: 'Subscriptions', icon: BellIcon },
  { to: '/admin', label: 'Admin', icon: ShieldIcon, adminOnly: true },
];
