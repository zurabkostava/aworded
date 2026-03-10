// ==== sw.js - AWorded Service Worker (Push Notifications) ====
const SW_VERSION = 7;

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(key => caches.delete(key)))
        ).then(() => self.clients.claim())
    );
});

// ==== Push Notification Handler ====
self.addEventListener('push', (event) => {
    let data = { title: 'AWorded', body: '' };
    try {
        data = event.data.json();
    } catch {
        data.body = event.data ? event.data.text() : '';
    }

    event.waitUntil(
        self.registration.showNotification(data.title || 'AWorded', {
            body: data.body || '',
            icon: './icons/logo.svg',
            badge: './icons/logo.svg',
            tag: data.tag || 'aworded-push',
            renotify: true,
            data: data
        })
    );
});

// ==== Message Handler (for direct notifications from page) ====
self.addEventListener('message', (event) => {
    const data = event.data;

    if (data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(data.title || 'AWorded', {
            body: data.body || '',
            icon: data.icon || './icons/logo.svg',
            badge: './icons/logo.svg',
            tag: 'aworded-reminder',
            renotify: true
        });
    }
});

// ==== Notification Click Handler ====
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
            if (clients.length > 0) {
                return clients[0].focus();
            }
            return self.clients.openWindow('./');
        })
    );
});
