/**
 * Which app the phone puts on its home screen (K2): on /kanban pages "Ncode - Kanban" with its own
 * icon and start page, elsewhere "Ncode". The tags are in index.html; this only changes them.
 */
export type AppService = 'bi' | 'kanban';

export interface AppIdentity {
  manifest: string;
  icon: string;
  title: string; // the name under the icon on an iPhone
  documentTitle: string;
}

export function identityOf(service: AppService): AppIdentity {
  return service === 'kanban'
    ? { manifest: '/kanban.webmanifest', icon: '/icons/kanban-180.png', title: 'Kanban', documentTitle: 'Ncode - Kanban' }
    : { manifest: '/manifest.webmanifest', icon: '/icons/ncode-180.png', title: 'Ncode', documentTitle: '' };
}

let originalTitle: string | null = null;

export function setAppIdentity(service: AppService): void {
  if (typeof document === 'undefined') return;
  const id = identityOf(service);
  if (originalTitle === null) originalTitle = document.title;
  document.querySelector('link[data-pwa="manifest"]')?.setAttribute('href', id.manifest);
  document.querySelector('link[data-pwa="icon"]')?.setAttribute('href', id.icon);
  document.querySelector('meta[data-pwa="title"]')?.setAttribute('content', id.title);
  document.title = id.documentTitle || originalTitle;
}
