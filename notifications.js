// ==== notifications.js — Web Push + Supabase-synced notifications ====

const VAPID_PUBLIC_KEY = 'BI6GbgN9_udyAyaXIumgu8X8u3BRwdvuest29gyLcvwKDBqhzk6Bp9OYOjMLeJtFU94Tx8khU-lI19M7APVvMFc';

let notificationSchedules = [];
let notifCheckInterval = null;
let lastFiredKey = '';
let editingNotifIndex = -1;

// ==== Helpers ====

function isInIframe() {
    try { return window.self !== window.top; } catch { return true; }
}

function urlBase64ToUint8Array(base64String) {
    const padding = '='.repeat((4 - base64String.length % 4) % 4);
    const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
    const rawData = atob(base64);
    const outputArray = new Uint8Array(rawData.length);
    for (let i = 0; i < rawData.length; ++i) {
        outputArray[i] = rawData.charCodeAt(i);
    }
    return outputArray;
}

// ==== Web Push Subscription ====

async function subscribeToPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
        console.warn('[Push] Not supported');
        return false;
    }

    try {
        const reg = await navigator.serviceWorker.ready;

        // Check existing subscription
        let subscription = await reg.pushManager.getSubscription();

        if (!subscription) {
            // Request permission
            const permission = await Notification.requestPermission();
            if (permission !== 'granted') {
                console.warn('[Push] Permission denied');
                return false;
            }

            // Subscribe
            subscription = await reg.pushManager.subscribe({
                userVisibleOnly: true,
                applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
            });
        }

        // Save subscription to Supabase
        const key = subscription.toJSON();
        if (typeof supabaseClient !== 'undefined' && typeof currentUser !== 'undefined' && currentUser) {
            const { error } = await supabaseClient
                .from('push_subscriptions')
                .upsert({
                    user_id: currentUser.id,
                    endpoint: key.endpoint,
                    p256dh: key.keys.p256dh,
                    auth: key.keys.auth
                }, { onConflict: 'user_id,endpoint' });

            if (error) {
                console.error('[Push] Save subscription error:', error.message);
            } else {
                console.log('[Push] Subscription saved to Supabase');
            }
        }

        return true;
    } catch (err) {
        console.error('[Push] Subscribe failed:', err);
        return false;
    }
}

// ==== Supabase CRUD for notification schedules ====

async function loadNotificationSchedules() {
    if (typeof supabaseClient === 'undefined' || typeof currentUser === 'undefined' || !currentUser) {
        notificationSchedules = [];
        return;
    }
    try {
        const { data, error } = await supabaseClient
            .from('notification_schedules')
            .select('*')
            .eq('user_id', currentUser.id)
            .order('created_at');
        if (error) {
            console.error('[Notif] Load error:', error.message);
            notificationSchedules = [];
            return;
        }
        notificationSchedules = (data || []).map(row => ({
            id: row.id,
            time: row.time,
            days: row.days || [],
            dictionaryId: row.dictionary_id,
            tags: row.tags || [],
            progressRange: row.progress_range || '',
            enabled: row.enabled !== false,
            createdAt: row.created_at
        }));
    } catch (e) {
        console.error('[Notif] Load exception:', e);
        notificationSchedules = [];
    }
}

async function saveNotification(notifData) {
    if (!currentUser) return null;
    const row = {
        user_id: currentUser.id,
        time: notifData.time,
        days: notifData.days,
        dictionary_id: notifData.dictionaryId || null,
        tags: notifData.tags || [],
        progress_range: notifData.progressRange || '',
        enabled: notifData.enabled !== false
    };

    if (notifData.id) {
        const { data, error } = await supabaseClient
            .from('notification_schedules')
            .update(row)
            .eq('id', notifData.id)
            .select()
            .single();
        if (error) {
            showToast('შეცდომა: ' + error.message, 'error');
            return null;
        }
        return data;
    } else {
        const { data, error } = await supabaseClient
            .from('notification_schedules')
            .insert(row)
            .select()
            .single();
        if (error) {
            showToast('შეცდომა: ' + error.message, 'error');
            return null;
        }
        return data;
    }
}

async function deleteNotificationFromDB(id) {
    const { error } = await supabaseClient
        .from('notification_schedules')
        .delete()
        .eq('id', id);
    if (error) showToast('შეცდომა: ' + error.message, 'error');
}

async function toggleNotificationInDB(id, enabled) {
    await supabaseClient
        .from('notification_schedules')
        .update({ enabled })
        .eq('id', id);
}

// ==== UI Rendering ====

function renderNotificationList() {
    const container = document.getElementById('notificationListContainer');
    if (!container) return;

    if (notificationSchedules.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: #888;">შეხსენებები არ გაქვთ.</p>';
        return;
    }

    const dayNames = ['კვი', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'];

    container.innerHTML = notificationSchedules.map((notif, index) => {
        const days = (notif.days || []).map(d => dayNames[d]).join(', ');
        const dictName = getDictionaryNameById(notif.dictionaryId);
        const tagNames = (notif.tags || []).join(', ');
        const progressLabel = getProgressLabel(notif.progressRange);

        return `
            <div class="notif-item" data-index="${index}">
                <div class="notif-item-header">
                    <span class="notif-time">${notif.time}</span>
                    <span class="notif-days">${days}</span>
                    <label class="notif-toggle">
                        <input type="checkbox" ${notif.enabled ? 'checked' : ''} onchange="toggleNotification(${index}, this.checked)">
                        <span class="notif-toggle-slider"></span>
                    </label>
                    <button class="notif-edit-btn" onclick="editNotification(${index})" title="რედაქტირება">
                        <i class="fas fa-edit"></i>
                    </button>
                    <button class="notif-delete-btn" onclick="deleteNotification(${index})" title="წაშლა">
                        <i class="fas fa-trash-alt"></i>
                    </button>
                </div>
                <div class="notif-item-details">
                    <span class="notif-dict"><i class="fas fa-book"></i> ${dictName}</span>
                    ${tagNames ? `<span class="notif-tags"><i class="fas fa-tags"></i> ${tagNames}</span>` : ''}
                    <span class="notif-progress"><i class="fas fa-chart-line"></i> ${progressLabel}</span>
                </div>
            </div>
        `;
    }).join('');
}

function getProgressLabel(progressRange) {
    if (!progressRange) return 'გლობალური';
    if (progressRange === '100-100') return 'ნასწავლი';
    if (progressRange === '0-99') return '100%-ის გარეშე';
    return progressRange + '%';
}

function getDictionaryNameById(id) {
    if (typeof allDictionaries !== 'undefined') {
        const dict = allDictionaries.find(d => d.id === id);
        if (dict) return dict.name;
    }
    return 'ყველა';
}

// ==== CRUD Actions ====

async function deleteNotification(index) {
    if (!confirm('ნამდვილად წაშალოთ შეხსენება?')) return;
    const notif = notificationSchedules[index];
    if (notif.id) await deleteNotificationFromDB(notif.id);
    notificationSchedules.splice(index, 1);
    renderNotificationList();
}

async function toggleNotification(index, enabled) {
    notificationSchedules[index].enabled = enabled;
    const notif = notificationSchedules[index];
    if (notif.id) await toggleNotificationInDB(notif.id, enabled);
}

function editNotification(index) {
    editingNotifIndex = index;
    openNotifForm(notificationSchedules[index]);
}

// ==== Form UI ====

function populateNotifDictDropdown(selectedId) {
    const select = document.getElementById('notifDictSelect');
    if (!select || typeof allDictionaries === 'undefined') return;
    select.innerHTML = '';
    allDictionaries.forEach(dict => {
        const option = document.createElement('option');
        option.value = dict.id;
        option.textContent = dict.name;
        if (selectedId ? dict.id === selectedId : (typeof currentDictionaryId !== 'undefined' && dict.id === currentDictionaryId)) {
            option.selected = true;
        }
        select.appendChild(option);
    });
}

function populateNotifTagDropdown(selectedTags) {
    const select = document.getElementById('notifTagSelect');
    if (!select || typeof allTags === 'undefined') return;
    select.innerHTML = '<option value="">ყველა</option>';
    const selected = selectedTags || [];
    [...allTags].forEach(tag => {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        if (selected.includes(tag.name)) option.selected = true;
        select.appendChild(option);
    });
}

function openNotifForm(notif) {
    const form = document.getElementById('notifAddForm');
    const addBtn = document.getElementById('openAddNotificationModalBtn');
    const formTitle = form.querySelector('h3');

    form.style.display = 'block';
    addBtn.style.display = 'none';

    const progressSelect = document.getElementById('notifProgressSelect');

    if (notif) {
        formTitle.textContent = 'შეხსენების რედაქტირება';
        document.getElementById('notifTimeInput').value = notif.time || '12:00';
        populateNotifDictDropdown(notif.dictionaryId);
        populateNotifTagDropdown(notif.tags);
        if (progressSelect) progressSelect.value = notif.progressRange || '';
        document.querySelectorAll('.weekday-btn').forEach(btn => {
            const day = parseInt(btn.dataset.day);
            btn.classList.toggle('active', (notif.days || []).includes(day));
        });
    } else {
        formTitle.textContent = 'ახალი შეხსენება';
        document.getElementById('notifTimeInput').value = '12:00';
        populateNotifDictDropdown();
        populateNotifTagDropdown();
        if (progressSelect) progressSelect.value = '';
        document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('active'));
    }
}

// ==== Init ====

async function initNotificationUI() {
    const notifBtn = document.getElementById('notificationsBtn');
    const modal = document.getElementById('notificationsModal');
    const closeBtn = document.getElementById('closeNotificationsModalBtn');
    const addBtn = document.getElementById('openAddNotificationModalBtn');
    const form = document.getElementById('notifAddForm');
    const saveBtn = document.getElementById('notifSaveBtn');
    const cancelBtn = document.getElementById('notifCancelBtn');

    if (!notifBtn || !modal) return;

    await loadNotificationSchedules();

    notifBtn.onclick = () => {
        renderNotificationList();
        form.style.display = 'none';
        addBtn.style.display = '';
        editingNotifIndex = -1;
        modal.style.display = 'flex';
    };

    closeBtn.onclick = () => {
        modal.style.display = 'none';
        form.style.display = 'none';
        editingNotifIndex = -1;
    };

    addBtn.onclick = () => {
        editingNotifIndex = -1;
        openNotifForm(null);
    };

    cancelBtn.onclick = () => {
        form.style.display = 'none';
        addBtn.style.display = '';
        editingNotifIndex = -1;
    };

    document.getElementById('notifWeekdays').addEventListener('click', (e) => {
        const btn = e.target.closest('.weekday-btn');
        if (btn) btn.classList.toggle('active');
    });

    saveBtn.onclick = async () => {
        const time = document.getElementById('notifTimeInput').value;
        if (!time) {
            showToast('აირჩიეთ დრო', 'error');
            return;
        }

        const selectedDays = [...document.querySelectorAll('.weekday-btn.active')].map(btn => parseInt(btn.dataset.day));
        if (selectedDays.length === 0) {
            showToast('აირჩიეთ მინიმუმ ერთი დღე', 'error');
            return;
        }

        const dictionaryId = document.getElementById('notifDictSelect').value;
        const tagSelect = document.getElementById('notifTagSelect');
        const selectedTags = [...tagSelect.selectedOptions].map(o => o.value).filter(Boolean);
        const progressRange = document.getElementById('notifProgressSelect').value || '';

        const notifData = {
            time,
            days: selectedDays,
            dictionaryId,
            tags: selectedTags,
            progressRange,
            enabled: true
        };

        if (editingNotifIndex >= 0) {
            notifData.id = notificationSchedules[editingNotifIndex].id;
            notifData.enabled = notificationSchedules[editingNotifIndex].enabled;
        }

        const saved = await saveNotification(notifData);
        if (!saved) return;

        await loadNotificationSchedules();
        renderNotificationList();

        form.style.display = 'none';
        addBtn.style.display = '';
        editingNotifIndex = -1;

        showToast(notifData.id ? 'შეხსენება განახლდა' : 'შეხსენება დაემატა', 'success');
    };

    // Test notification button
    const testBtn = document.getElementById('testNotificationBtn');
    if (testBtn) {
        testBtn.onclick = async () => {
            const debugEl = document.getElementById('notifDebugInfo');
            const pushSupported = 'PushManager' in window;
            const swReady = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
            const notifPermission = 'Notification' in window ? Notification.permission : 'N/A';

            let info = `Push: ${pushSupported} | SW: ${swReady} | Permission: ${notifPermission}`;

            // Subscribe to push if not yet
            if (notifPermission !== 'granted') {
                const result = await Notification.requestPermission();
                info += ` | Asked: ${result}`;
                if (result !== 'granted') {
                    if (debugEl) debugEl.textContent = info;
                    showToast('ნოტიფიკაციის ნებართვა უარყოფილია. ბრაუზერის პარამეტრებში ჩართეთ.', 'error');
                    return;
                }
            }

            // Subscribe to push
            const subscribed = await subscribeToPush();
            info += ` | Subscribed: ${subscribed}`;
            if (debugEl) debugEl.textContent = info;

            // Send test via SW
            if (navigator.serviceWorker && navigator.serviceWorker.controller) {
                navigator.serviceWorker.controller.postMessage({
                    type: 'SHOW_NOTIFICATION',
                    title: 'AWorded Test',
                    body: 'ტესტ ნოტიფიკაცია მუშაობს!'
                });
                showToast('ტესტ ნოტიფიკაცია გაიგზავნა!', 'success');
            } else {
                // Fallback
                new Notification('AWorded Test', {
                    body: 'ტესტ ნოტიფიკაცია მუშაობს!',
                    icon: './icons/logo.svg'
                });
                showToast('ტესტ ნოტიფიკაცია გაიგზავნა!', 'success');
            }
        };
    }

    // Subscribe to push notifications
    await subscribeToPush();
}

// ==== Service Worker Registration ====

async function registerNotificationSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
        await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
    } catch (err) {
        console.warn('Service worker registration failed:', err);
    }
}
