/** Registers public/sw.js (K2) in the built app. Not during development, and only where browsers
 * allow it: HTTPS or localhost. Without it Ncode works the same, it just needs the connection to open. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || typeof navigator === 'undefined' || !('serviceWorker' in navigator) || !window.isSecureContext) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => undefined); // e.g. a private window that refuses it
  });
}
