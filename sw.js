// ==== sw.js - AWorded Service Worker ====
const SW_VERSION = 5;
const CACHE_NAME = 'aworded-v5';

let schedules = [];
let checkInterval = null;
let lastFiredKey = '';

self.addEventListener('install', () => {
    self.skipWaiting();
});

self.addEventListener('activate', (event) => {
    // Clear all old caches on activation
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(key => caches.delete(key)))
        ).then(() => self.clients.claim())
    );
    startScheduleChecker();
});

// Network-first strategy: always fetch fresh, cache as fallback for offline
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Only handle same-origin requests (our app files)
    if (url.origin !== self.location.origin) return;

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    event.respondWith(
        fetch(event.request, { cache: 'no-cache' }).then(response => {
            // Cache the fresh response for offline fallback
            const clone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, clone);
            });
            return response;
        }).catch(() => {
            // Network failed, try cache
            return caches.match(event.request);
        })
    );
});

self.addEventListener('message', (event) => {
    const data = event.data;

    if (data.type === 'UPDATE_SCHEDULES') {
        schedules = data.schedules || [];
        startScheduleChecker();
    }

    if (data.type === 'SHOW_NOTIFICATION') {
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: data.icon || '/icons/logo.svg',
            badge: '/icons/logo.svg',
            tag: 'aworded-reminder',
            renotify: true
        });
    }
});

// When user clicks notification, open the app
self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({type: 'window', includeUncontrolled: true}).then(clients => {
            if (clients.length > 0) {
                return clients[0].focus();
            }
            return self.clients.openWindow('/');
        })
    );
});

function startScheduleChecker() {
    if (checkInterval) clearInterval(checkInterval);
    if (schedules.length > 0) {
        checkInterval = setInterval(checkSchedules, 30000);
    }
}

function checkSchedules() {
    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    schedules.forEach((notif, index) => {
        if (!notif.enabled) return;
        if (notif.time !== currentTime) return;
        if (!notif.days.includes(currentDay)) return;

        const fireKey = `${index}-${currentTime}-${currentDay}-${now.toDateString()}`;
        if (fireKey === lastFiredKey) return;
        lastFiredKey = fireKey;

        const dictName = notif.dictionaryName || '';
        const body = notif.tags && notif.tags.length
            ? `${notif.message}\n${dictName} | ${notif.tags.join(', ')}`
            : `${notif.message}\n${dictName}`;

        self.registration.showNotification('AWorded', {
            body: body,
            icon: '/icons/logo.svg',
            badge: '/icons/logo.svg',
            tag: 'aworded-reminder-' + index,
            renotify: true
        });
    });
}
