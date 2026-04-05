/**
 * sw.js — Kill switch build
 * Clears all caches, unregisters self, and reloads clients.
 * This breaks the stale-SW deadlock so the app loads fresh.
 */

self.addEventListener('install', () => {
  console.log('[SW] Kill switch installing — skipping wait');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('[SW] Kill switch activating — clearing all caches');
  event.waitUntil(
    caches.keys()
      .then(keys => {
        console.log('[SW] Deleting caches:', keys);
        return Promise.all(keys.map(k => caches.delete(k)));
      })
      .then(() => self.registration.unregister())
      .then(() => {
        console.log('[SW] Unregistered. Reloading all clients.');
        return self.clients.matchAll({ type: 'window' });
      })
      .then(clients => {
        clients.forEach(client => client.navigate(client.url));
      })
  );
});
