// ==== AWorded Service Worker ====
const SW_VERSION = 13;
const PUSH_URL = 'https://wdgvxerfxwtmpqztwgtj.supabase.co/functions/v1/get-push-notification';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
    event.waitUntil(
        caches.keys()
            .then(keys => Promise.all(keys.map(k => caches.delete(k))))
            .then(() => self.clients.claim())
    );
});

// ==== Push: fetch content from queue, show notification ====
self.addEventListener('push', event => {
    event.waitUntil((async () => {
        let title = 'AWorded';
        let body = '';
        let tag = 'aworded-push';

        try {
            const sub = await self.registration.pushManager.getSubscription();
            if (sub) {
                const res = await fetch(`${PUSH_URL}?endpoint=${encodeURIComponent(sub.endpoint)}`);
                if (res.ok) {
                    const d = await res.json();
                    if (d.title) title = d.title;
                    if (d.body) body = d.body;
                    if (d.schedule_id) tag = `aworded-${d.schedule_id}`;
                }
            }
        } catch (e) {
            console.error('[SW] push fetch error:', e);
        }

        return self.registration.showNotification(title, {
            body,
            tag,
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            renotify: true,
            vibrate: [200, 100, 200],
            requireInteraction: true,
        });
    })());
});

// ==== Message from page: show notification directly ====
self.addEventListener('message', event => {
    const d = event.data;
    if (d?.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(d.title || 'AWorded', {
            body: d.body || '',
            icon: './icons/icon-192.png',
            badge: './icons/icon-192.png',
            tag: d.tag || 'aworded-reminder',
            renotify: true,
            vibrate: [200, 100, 200],
            requireInteraction: true,
        });
    }
});

// ==== Click: open/focus app ====
self.addEventListener('notificationclick', event => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(clients => clients.length > 0 ? clients[0].focus() : self.clients.openWindow('./'))
    );
});
