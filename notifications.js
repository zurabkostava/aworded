// ==== notifications.js ====

const NOTIF_STORAGE_KEY = 'aworded_notifications';
let notificationSchedules = [];
let notifCheckInterval = null;
let lastFiredKey = ''; // prevents double-firing within same minute
let editingNotifIndex = -1; // -1 = adding new, >= 0 = editing existing

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

function loadNotificationSchedules() {
    try {
        notificationSchedules = JSON.parse(localStorage.getItem(NOTIF_STORAGE_KEY)) || [];
    } catch {
        notificationSchedules = [];
    }
}

function saveNotificationSchedules() {
    localStorage.setItem(NOTIF_STORAGE_KEY, JSON.stringify(notificationSchedules));
}

function renderNotificationList() {
    const container = document.getElementById('notificationListContainer');
    if (!container) return;

    if (notificationSchedules.length === 0) {
        container.innerHTML = '<p class="notif-empty" style="text-align: center; color: #888;">შეხსენებები არ გაქვთ.</p>';
        return;
    }

    const dayNames = ['კვი', 'ორშ', 'სამ', 'ოთხ', 'ხუთ', 'პარ', 'შაბ'];

    container.innerHTML = notificationSchedules.map((notif, index) => {
        const days = (notif.days || []).map(d => dayNames[d]).join(', ');
        const dictName = getDictionaryNameById(notif.dictionaryId);
        const tagNames = (notif.tags || []).join(', ');
        const progressLabel = !notif.progressRange ? 'გლობალური' : notif.progressRange === '100-100' ? 'ნასწავლი' : notif.progressRange === '0-99' ? '100%-ის გარეშე' : `${notif.progressRange}%`;

        return `
            <div class="notif-item" data-index="${index}">
                <div class="notif-item-header">
                    <span class="notif-time">${notif.time}</span>
                    <span class="notif-days">${days}</span>
                    <label class="notif-toggle">
                        <input type="checkbox" ${notif.enabled !== false ? 'checked' : ''} onchange="toggleNotification(${index}, this.checked)">
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
                    ${progressLabel ? `<span class="notif-progress"><i class="fas fa-chart-line"></i> ${progressLabel}</span>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

function getDictionaryNameById(id) {
    if (typeof allDictionaries !== 'undefined') {
        const dict = allDictionaries.find(d => d.id === id);
        if (dict) return dict.name;
    }
    return 'ყველა';
}

function deleteNotification(index) {
    if (!confirm('ნამდვილად წაშალოთ შეხსენება?')) return;
    notificationSchedules.splice(index, 1);
    saveNotificationSchedules();
    renderNotificationList();
    updateServiceWorkerSchedules();
}

function toggleNotification(index, enabled) {
    notificationSchedules[index].enabled = enabled;
    saveNotificationSchedules();
    updateServiceWorkerSchedules();
}

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
        // Editing existing
        formTitle.textContent = 'შეხსენების რედაქტირება';
        document.getElementById('notifTimeInput').value = notif.time || '12:00';
        populateNotifDictDropdown(notif.dictionaryId);
        populateNotifTagDropdown(notif.tags);
        if (progressSelect) progressSelect.value = notif.progressRange || '';
        // Set weekday buttons
        document.querySelectorAll('.weekday-btn').forEach(btn => {
            const day = parseInt(btn.dataset.day);
            btn.classList.toggle('active', (notif.days || []).includes(day));
        });
    } else {
        // Adding new
        formTitle.textContent = 'ახალი შეხსენება';
        document.getElementById('notifTimeInput').value = '12:00';
        populateNotifDictDropdown();
        populateNotifTagDropdown();
        if (progressSelect) progressSelect.value = '';
        document.querySelectorAll('.weekday-btn').forEach(btn => btn.classList.remove('active'));
    }
}

function editNotification(index) {
    editingNotifIndex = index;
    openNotifForm(notificationSchedules[index]);
}

function initNotificationUI() {
    const notifBtn = document.getElementById('notificationsBtn');
    const modal = document.getElementById('notificationsModal');
    const closeBtn = document.getElementById('closeNotificationsModalBtn');
    const addBtn = document.getElementById('openAddNotificationModalBtn');
    const form = document.getElementById('notifAddForm');
    const saveBtn = document.getElementById('notifSaveBtn');
    const cancelBtn = document.getElementById('notifCancelBtn');

    if (!notifBtn || !modal) return;

    loadNotificationSchedules();

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

    // Save notification (create or update)
    saveBtn.onclick = () => {
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
            enabled: true,
            createdAt: Date.now()
        };

        if (editingNotifIndex >= 0) {
            // Preserve enabled state when editing
            notifData.enabled = notificationSchedules[editingNotifIndex].enabled;
            notifData.createdAt = notificationSchedules[editingNotifIndex].createdAt || Date.now();
            notificationSchedules[editingNotifIndex] = notifData;
            showToast('შეხსენება განახლდა', 'success');
        } else {
            notificationSchedules.push(notifData);
            showToast('შეხსენება დაემატა', 'success');
        }

        saveNotificationSchedules();
        renderNotificationList();
        updateServiceWorkerSchedules();

        form.style.display = 'none';
        addBtn.style.display = '';
        editingNotifIndex = -1;
    };

    // Request notification permission
    requestNotificationPermission();

    // Start checking schedule
    startNotificationChecker();
}

async function requestNotificationPermission() {
    if (isInIframe()) {
        // Ask parent page to request permission
        window.parent.postMessage({ type: 'REQUEST_NOTIFICATION_PERMISSION' }, '*');
        return;
    }
    if (!('Notification' in window)) return;
    if (Notification.permission === 'default') {
        await Notification.requestPermission();
    }
}

function startNotificationChecker() {
    if (notifCheckInterval) clearInterval(notifCheckInterval);
    notifCheckInterval = setInterval(checkNotificationSchedule, 30000); // check every 30 seconds
}

async function checkNotificationSchedule() {
    // In iframe, check parent permission; otherwise check directly
    if (isInIframe()) {
        if (window._parentNotifPermission !== 'granted') return;
    } else if (Notification.permission !== 'granted') return;

    const now = new Date();
    const currentDay = now.getDay(); // 0=Sun, 1=Mon, ...
    const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    for (let index = 0; index < notificationSchedules.length; index++) {
        const notif = notificationSchedules[index];
        if (!notif.enabled) continue;
        if (notif.time !== currentTime) continue;
        if (!notif.days.includes(currentDay)) continue;

        // Prevent double-fire within same minute
        const fireKey = `${index}-${currentTime}-${currentDay}-${now.toDateString()}`;
        if (fireKey === lastFiredKey) continue;
        lastFiredKey = fireKey;

        await showNotificationWithCard(notif);
    }
}

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
        const {data, error} = await supabaseClient.rpc('get_random_card', params).single();
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
        const word = card.word || '';
        const translations = (card.main_translations || []).join(', ');
        title = word;
        body = translations;
    } else {
        body = dictName;
    }

    // If in iframe, delegate notification to parent page
    if (isInIframe()) {
        window.parent.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            body: body,
            icon: 'https://zurabkostava.github.io/aworded/icons/logo.svg'
        }, '*');
        return;
    }

    // Try service worker notification first (persists even if tab not focused)
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'SHOW_NOTIFICATION',
            title: title,
            body: body,
            icon: '/icons/logo.svg'
        });
    } else {
        // Fallback to regular Notification API
        new Notification(title, {
            body: body,
            icon: '/icons/logo.svg',
            tag: 'aworded-reminder'
        });
    }
}

function updateServiceWorkerSchedules() {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        navigator.serviceWorker.controller.postMessage({
            type: 'UPDATE_SCHEDULES',
            schedules: notificationSchedules
        });
    }
}

// Register service worker
async function registerNotificationSW() {
    if (!('serviceWorker' in navigator)) return;
    try {
        const reg = await navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' });
        // Pass schedules once SW is active
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
