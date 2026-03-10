// ==== sw.js - AWorded Service Worker (Push Notifications) ====
const SW_VERSION = 9;
const SUPABASE_PUSH_URL = 'https://wdgvxerfxwtmpqztwgtj.supabase.co/functions/v1/get-push-notification';

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
    event.waitUntil((async () => {
        let title = 'AWorded';
        let body = 'დროა ისწავლო!';
        let tag = 'aworded-push';

        try {
            // Get own push endpoint to identify ourselves
            const sub = await self.registration.pushManager.getSubscription();
            if (sub) {
                const res = await fetch(`${SUPABASE_PUSH_URL}?endpoint=${encodeURIComponent(sub.endpoint)}`);
                if (res.ok) {
                    const data = await res.json();
                    title = data.title || title;
                    body = data.body || body;
                    // Use schedule_id as tag so it matches client-side checker (prevents double notification)
                    if (data.schedule_id) tag = `aworded-${data.schedule_id}`;
                }
            }
        } catch (e) {
            console.error('[SW] Failed to fetch push content:', e);
        }

        return self.registration.showNotification(title, {
            body,
            icon: './icons/logo.svg',
            badge: './icons/logo.svg',
            tag,
            renotify: true,
        });
    })());
});

// ==== Message Handler (for direct notifications from page) ====
self.addEventListener('message', (event) => {
    const data = event.data;

    if (data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(data.title || 'AWorded', {
            body: data.body || '',
            icon: data.icon || './icons/logo.svg',
            badge: './icons/logo.svg',
            tag: data.tag || 'aworded-reminder',
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
