// ==== notifications.js — Supabase-synced notifications ====

let notificationSchedules = [];
let notifCheckInterval = null;
let lastFiredKey = '';
let editingNotifIndex = -1;

// Detect if running inside an iframe
function isInIframe() {
    try { return window.self !== window.top; } catch { return true; }
}

// Listen for permission responses from parent
if (isInIframe()) {
    window.addEventListener('message', (event) => {
        if (event.data && event.data.type === 'NOTIFICATION_PERMISSION') {
            window._parentNotifPermission = event.data.permission;
        }
    });
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
        // Update existing
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
        // Insert new
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
    if (error) {
        showToast('შეცდომა: ' + error.message, 'error');
    }
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
    updateServiceWorkerSchedules();
}

async function toggleNotification(index, enabled) {
    notificationSchedules[index].enabled = enabled;
    const notif = notificationSchedules[index];
    if (notif.id) await toggleNotificationInDB(notif.id, enabled);
    updateServiceWorkerSchedules();
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

    // Load from Supabase
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

    // Weekday toggle buttons
    document.getElementById('notifWeekdays').addEventListener('click', (e) => {
        const btn = e.target.closest('.weekday-btn');
        if (btn) btn.classList.toggle('active');
    });

    // Save notification
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

        // Reload from DB to stay in sync
        await loadNotificationSchedules();
        renderNotificationList();
        updateServiceWorkerSchedules();

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
            const inIframe = isInIframe();
            const swController = !!(navigator.serviceWorker && navigator.serviceWorker.controller);
            const notifSupported = 'Notification' in window;
            const notifPermission = notifSupported ? Notification.permission : 'N/A';

            let info = `iframe: ${inIframe} | SW: ${swController} | Notif API: ${notifSupported} | Permission: ${notifPermission}`;
            if (debugEl) debugEl.textContent = info;
            console.log('[Notif Test]', info);

            // Request permission if needed (only when NOT in iframe)
            if (!inIframe && notifSupported && notifPermission === 'default') {
                const result = await Notification.requestPermission();
                info += ` | Requested: ${result}`;
                if (debugEl) debugEl.textContent = info;
                if (result !== 'granted') {
                    showToast('ნოტიფიკაციის ნებართვა არ მოგეცათ', 'error');
                    return;
                }
            }
            // In iframe, request permission from parent
            if (inIframe) {
                window.parent.postMessage({ type: 'REQUEST_NOTIFICATION_PERMISSION' }, '*');
            }

            // Try to show a test notification
            await showNotificationWithCard({
                dictionaryId: typeof currentDictionaryId !== 'undefined' ? currentDictionaryId : null,
                tags: [],
                progressRange: ''
            });
            showToast('ტესტ ნოტიფიკაცია გაიგზავნა!', 'success');
        };
    }

    // Request notification permission
    requestNotificationPermission();

    // Start checking schedule
    startNotificationChecker();
    updateServiceWorkerSchedules();
}

// ==== Permission ====

async function requestNotificationPermission() {
    if (isInIframe()) {
        // Ask parent page to request permission and report back
        window.parent.postMessage({ type: 'REQUEST_NOTIFICATION_PERMISSION' }, '*');
        // Also ask parent for current permission status
        window.parent.postMessage({ type: 'GET_NOTIFICATION_PERMISSION' }, '*');
        return;
    }
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

function hasNotificationPermission() {
    if (isInIframe()) {
        // In iframe, assume permission is handled by parent — always try to send
        return true;
    }
    return 'Notification' in window && Notification.permission === 'granted';
}

// ==== Notification Checker ====

function startNotificationChecker() {
    if (notifCheckInterval) clearInterval(notifCheckInterval);
    notifCheckInterval = setInterval(checkNotificationSchedule, 30000);
}

async function checkNotificationSchedule() {
    if (!hasNotificationPermission()) return;

    const now = new Date();
    const currentDay = now.getDay();
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (let index = 0; index < notificationSchedules.length; index++) {
        const notif = notificationSchedules[index];
        if (!notif.enabled) continue;
        if (notif.time !== currentTime) continue;
        if (!notif.days.includes(currentDay)) continue;

        const fireKey = `${notif.id || index}-${currentTime}-${currentDay}-${now.toDateString()}`;
        if (fireKey === lastFiredKey) continue;
        lastFiredKey = fireKey;

        await showNotificationWithCard(notif);
    }
}

// ==== Card Fetching & Display ====

async function fetchRandomCard(dictionaryId, tagNames, progressRange) {
    if (typeof supabaseClient === 'undefined' || typeof currentUser === 'undefined' || !currentUser) return null;

    try {
        let progressMin = null;
        let progressMax = null;
        if (progressRange) {
            const parts = progressRange.split('-');
            progressMin = parseInt(parts[0]);
            progressMax = parseInt(parts[1]);
        }

        const params = {
            dict_id_input: dictionaryId || null,
            tag_names_input: tagNames && tagNames.length > 0 ? tagNames : null,
            progress_min_input: progressMin,
            progress_max_input: progressMax
        };
        const { data, error } = await supabaseClient.rpc('get_random_card', params).single();
        if (error || !data) return null;
        return data;
    } catch {
        return null;
    }
}

async function showNotificationWithCard(notif) {
    const dictName = getDictionaryNameById(notif.dictionaryId);
    const card = await fetchRandomCard(notif.dictionaryId, notif.tags, notif.progressRange);

    let title = 'AWorded';
    let body;

    if (card) {
        title = card.word || 'AWorded';
        body = (card.main_translations || []).join(', ');
    } else {
        body = dictName;
    }

    if (isInIframe()) {
        window.parent.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            body,
            icon: 'https://zurabkostava.github.io/aworded/icons/logo.svg'
        }, '*');
        return;
    }

    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title,
            body,
            icon: './icons/logo.svg'
        });
    } else {
        new Notification(title, {
            body,
            icon: './icons/logo.svg',
            tag: 'aworded-reminder'
        });
    }
}

// ==== Service Worker Communication ====

function updateServiceWorkerSchedules() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'UPDATE_SCHEDULES',
            schedules: notificationSchedules
        });
    }
}

async function registerNotificationSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        if (reg.active) {
            reg.active.postMessage({
                type: 'UPDATE_SCHEDULES',
                schedules: notificationSchedules
            });
        }
        navigator.serviceWorker.addEventListener('controllerchange', () => {
            updateServiceWorkerSchedules();
        });
    } catch (err) {
        console.warn('Service worker registration failed:', err);
    }
}
