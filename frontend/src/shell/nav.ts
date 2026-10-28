import type { ComponentType } from 'react';
import type { IconProps } from '@chakra-ui/react';
import {
  BellIcon, BookIcon, ChartIcon, CodeIcon, FolderIcon, HomeIcon, LayoutIcon, MergeIcon, SearchIcon, ShieldIcon, TableIcon, UploadIcon,
} from '../icons';
import { t } from '../i18n/index.ts';

export interface NavItem {
  to: string;
  label: string;
  /** one line in plain words: the menu's tooltip and the text on the home page */
  hint: string;
  icon: ComponentType<IconProps>;
  milestone?: string; // set while the section is still a placeholder
  adminOnly?: boolean;
  end?: boolean; // active only on exactly this path (saved questions live under /questions/:id)
  /** another way to do what the item above does (SQL editor, Combine under New question): shown indented */
  sub?: boolean;
}

export interface NavGroup {
  id: string;
  /** null: no heading (Home at the top, Admin at the bottom) */
  label: string | null;
  items: NavItem[];
}

/**
 * The menu, grouped by what people want to do (M11, "a calmer menu"). Every section of the
 * app stays one click away; the variants of asking a question sit under "New question".
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    id: 'home',
    label: null,
    items: [{ to: '/', label: t('Home'), icon: HomeIcon, end: true, hint: t('Where to start: your dashboards and what you opened last.') }],
  },
  {
    id: 'lookup',
    label: t('Look up'),
    items: [
      { to: '/search', label: t('Search'), icon: SearchIcon, hint: t('Find a value in every table of a database at once.') },
      { to: '/browse', label: t('Browse'), icon: TableIcon, hint: t('Page through any table, sort, filter and export it to CSV.') },
      { to: '/glossary', label: t('Glossary'), icon: BookIcon, hint: t('What the business terms and numbers mean.') },
    ],
  },
  {
    id: 'answer',
    label: t('Answer questions'),
    items: [
      { to: '/questions', label: t('New question'), icon: ChartIcon, end: true, hint: t('Build questions without SQL: join, filter, group and chart.') },
      { to: '/sql', label: t('SQL editor'), icon: CodeIcon, sub: true, hint: t('Write read-only SQL with autocomplete and safe limits.') },
      { to: '/combine', label: t('Combine sources'), icon: MergeIcon, sub: true, hint: t('Join results from several databases and uploaded files.') },
      { to: '/datasets', label: t('Uploads'), icon: UploadIcon, hint: t('Upload CSV, Excel or Parquet files and query them like tables.') },
    ],
  },
  {
    id: 'share',
    label: t('Saved and shared'),
    items: [
      { to: '/dashboards', label: t('Dashboards'), icon: LayoutIcon, hint: t('Every dashboard you can open: questions on one page, with shared filters.') },
      { to: '/library', label: t('Library'), icon: FolderIcon, hint: t('Everything saved, by collection: questions, dashboards and files, and who can see them.') },
      { to: '/subscriptions', label: t('Subscriptions'), icon: BellIcon, hint: t('Reports and alerts sent by email, Slack, Teams or Telegram on a schedule.') },
    ],
  },
  {
    id: 'admin',
    label: null,
    items: [
      { to: '/admin', label: t('Admin'), icon: ShieldIcon, adminOnly: true, hint: t('Databases, the data model, people and groups, delivery, audit log and backups.') },
    ],
  },
];

/** Every section, in menu order. */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((g) => g.items);

/** The groups a person sees (admins also see Admin); empty groups are left out. */
export function visibleGroups(isAdmin: boolean): NavGroup[] {
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((item) => isAdmin || !item.adminOnly) })).filter((g) => g.items.length > 0);
}

/** A stable test id for a menu entry: "nav-home", "nav-search", "nav-questions" ... */
export const navTestId = (to: string): string => `nav-${to.replace(/^\//, '') || 'home'}`;
