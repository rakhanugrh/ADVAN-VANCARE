const CACHE_NAME = 'vancare-web-push-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', event => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (error) {
    data = { title: 'VANCARE', body: 'Ada pembaruan klaim baru.' };
  }

  const notification = {
    title: data.title || 'VANCARE',
    body: data.body || 'Ada pembaruan baru.',
    icon: '/favicon-192x192.png',
    badge: '/favicon-32x32.png',
    data: { url: data.url || '/admin' },
    tag: data.tag || 'vancare-notification',
    renotify: true,
    requireInteraction: false
  };

  event.waitUntil(self.registration.showNotification(notification.title, notification));
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/admin';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      const existing = clients.find(client => client.url.includes(url));
      if (existing) {
        return existing.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
