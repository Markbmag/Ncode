import type { ComponentType } from 'react';
import type { IconProps } from '@chakra-ui/react';
import { ChartIcon, CodeIcon, HomeIcon, LayoutIcon, SearchIcon, ShieldIcon, TableIcon } from '../icons';

export interface NavItem {
  to: string;
  label: string;
  icon: ComponentType<IconProps>;
  milestone?: string; // set while the section is still a placeholder
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home', icon: HomeIcon },
  { to: '/search', label: 'Search', icon: SearchIcon },
  { to: '/browse', label: 'Browse', icon: TableIcon },
  { to: '/questions', label: 'Questions', icon: ChartIcon },
  { to: '/sql', label: 'SQL editor', icon: CodeIcon },
  { to: '/dashboards', label: 'Dashboards', icon: LayoutIcon, milestone: 'M5' },
  { to: '/admin', label: 'Admin', icon: ShieldIcon, adminOnly: true },
];
