let compressedPhotoData = null;
let projectConfig = { unitTypes: [], stories: [], unitNumbers: [], maps: [], syncedDefects: [] };
let dbPromise = null;
let isSyncing = false;
const APP_VERSION = "1.6.9";

// Initialize IndexedDB
async function initDB() {
    if (dbPromise) return dbPromise;
    dbPromise = idb.openDB('defects-db', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('pending_defects')) {
                db.createObjectStore('pending_defects', { keyPath: 'id' });
            }
        },
    });
    return dbPromise;
}

async function checkAppVersion() {
    if (!navigator.onLine) return;
    try {
        const res = await fetch('version.json?t=' + Date.now());
        const data = await res.json();
        if (data.version && data.version !== APP_VERSION) {
            console.log("New version available:", data.version);
        }
    } catch (e) {}
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session) { window.location.href = 'index.html'; return; }

    const db = await initDB();
    const mapContainer = document.getElementById('map-container');
    const floorplanImg = document.getElementById('floorplan-img');
    const unitSelect = document.getElementById('unit-number-select');
    const storySelect = document.getElementById('story-select');
    const unitDisplay = document.getElementById('current-unit-display');
    const floorDisplay = document.getElementById('current-floor-display');
    const pinsContainer = document.getElementById('pins-container');
    const modal = document.getElementById('defect-modal');
    const photoInput = document.getElementById('defect-photo');
    const previewImg = document.getElementById('preview-img');
    const saveBtn = document.getElementById('save-defect-btn');
    const cancelBtn = document.getElementById('cancel-defect-btn');
    const syncBtn = document.getElementById('sync-btn');
    const backBtn = document.getElementById('back-btn');
    const syncIndicator = document.getElementById('sync-indicator');

    const detailModal = document.getElementById('detail-modal');
    const detailStatus = document.getElementById('detail-status');
    const detailDesc = document.getElementById('detail-desc');
    const detailImg = document.getElementById('detail-img');
    const closeDetailBtn = document.getElementById('close-detail-btn');
    const confirmPinBtn = document.getElementById('confirm-pin-btn');
    const activeCrosshair = document.getElementById('active-crosshair');

    window.showLoader = (text = 'Loading...') => {
        const loader = document.getElementById('global-loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) { if (loaderText) loaderText.textContent = text; loader.style.display = 'flex'; }
    };
    window.hideLoader = () => {
        const loader = document.getElementById('global-loader');
        if (loader) loader.style.display = 'none';
    };

    backBtn.onclick = () => {
        window.showLoader('Returning to Dashboard...');
        setTimeout(() => { window.location.href = 'home.html'; }, 300);
    };

    let activePinContext = null;

    mapContainer.onclick = (e) => {
        if (modal.style.display === 'block' || detailModal.style.display === 'block') return;
        if (e.target !== mapContainer && e.target !== floorplanImg && e.target !== activeCrosshair) return;
        const rect = mapContainer.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        activePinContext = { unit: unitSelect.value, story: storySelect.value, position: { x, y } };
        activeCrosshair.style.left = x + '%';
        activeCrosshair.style.top = y + '%';
        activeCrosshair.style.display = 'block';
        confirmPinBtn.style.display = 'block';
    };

    confirmPinBtn.onclick = () => { modal.style.display = 'block'; confirmPinBtn.style.display = 'none'; };

    // --- SYNC & STATUS ---
    function updateSyncUI(status) {
        if (!syncIndicator) return;
        const colors = { syncing: '#1877f2', online: '#1a7f37', offline: '#cf222e' };
        syncIndicator.style.background = colors[status] || '#ccc';
        syncIndicator.title = status.charAt(0).toUpperCase() + status.slice(1);
    }

    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) {
            updateSyncUI(navigator.onLine ? 'online' : 'offline');
            return;
        }
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) { updateSyncUI('online'); return; }
        isSyncing = true; updateSyncUI('syncing');
        for (const d of pending) {
            try {
                const res = await authorizedPost('sync_defects', { defect: d });
                if (res && (await res.json()).status === 'success') await db.delete('pending_defects', d.id);
            } catch (e) {}
        }
        isSyncing = false;
        await loadProjectConfig(false);
        updateSyncUI(navigator.onLine ? 'online' : 'offline');
    }

    window.addEventListener('online', () => { syncAllPending(); loadProjectConfig(false); checkAppVersion(); });
    setInterval(syncAllPending, 15000);
    setInterval(checkAppVersion, 300000);
    syncAllPending();
    checkAppVersion();

    syncBtn.onclick = async () => {
        showLoader('Synchronizing data with cloud...');
        await syncAllPending();
        await checkAppVersion();
        if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
        hideLoader();
    };

    // --- CONFIG & RENDER ---
    async function loadProjectConfig(useLoader = true) {
        if (useLoader) window.showLoader('Fetching project floor plans...');
        const cached = localStorage.getItem('project_config');
        if (cached) { projectConfig = JSON.parse(cached); renderSelectors(projectConfig); }
        if (navigator.onLine) {
            try {
                const res = await authorizedPost('get_config', {});
                if (res) {
                    const result = await res.json();
                    if (result.status === 'success') {
                        projectConfig = result.config;
                        localStorage.setItem('project_config', JSON.stringify(projectConfig));
                        renderSelectors(projectConfig);
                    }
                }
            } catch (err) {}
        }
        if (useLoader) window.hideLoader();
    }

    function renderSelectors(config) {
        const prevUnit = unitSelect.value;
        const prevStory = storySelect.value;
        if (config.unitNumbers) {
            unitSelect.innerHTML = config.unitNumbers.map(u => `<option value="${u.number}">${u.number} (${u.type})</option>`).join('');
        }
        if (config.stories) {
            storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
        }
        if (prevUnit && Array.from(unitSelect.options).some(o => o.value === prevUnit)) unitSelect.value = prevUnit;
        if (prevStory && Array.from(storySelect.options).some(o => o.value === prevStory)) storySelect.value = prevStory;
        updateSelection();
    }

    async function updateSelection() {
        const unitNumber = unitSelect.value.trim();
        const story = storySelect.value.trim();
        const unitMapping = projectConfig.unitNumbers.find(u => u.number === unitNumber);
        const unitType = unitMapping ? unitMapping.type : unitNumber;
        unitDisplay.textContent = unitNumber;
        floorDisplay.textContent = story;
        pinsContainer.innerHTML = '';
        let mapUrl = null;
        if (projectConfig.maps) {
            const currentMap = projectConfig.maps.find(m => m.unit === unitType && m.story === story);
            if (currentMap) mapUrl = fixMapUrl(currentMap.mapUrl);
        }
        floorplanImg.src = mapUrl || `assets/${unitType}_${story}.png`;
        floorplanImg.onerror = () => { if (!floorplanImg.src.includes('placeholder')) floorplanImg.src = 'assets/floorplan-placeholder.png'; };
        
        if (projectConfig.syncedDefects) {
            projectConfig.syncedDefects.forEach(d => {
                if (d.unit === unitNumber && d.story === story) addPinToUI(d, 'synced');
            });
        }
        const pending = await db.getAll('pending_defects');
        pending.forEach(d => {
            if (d.unit === unitNumber && d.story === story) addPinToUI(d, 'pending');
        });
    }

    function addPinToUI(defect, type) {
        if (!defect || !defect.position) return;
        const pin = document.createElement('div');
        pin.className = 'pin';
        pin.style.left = defect.position.x + '%'; 
        pin.style.top = defect.position.y + '%';
        pin.style.width = '18px'; pin.style.height = '18px'; pin.style.border = '2px solid white'; pin.style.position = 'absolute'; pin.style.borderRadius = '50%'; pin.style.transform = 'translate(-50%, -50%)';
        const colors = { Open: '#d29922', Onprogress: '#1877f2', Done: '#1a7f37' };
        pin.style.backgroundColor = colors[defect.status] || 'red';
        if (type === 'pending') pin.style.boxShadow = '0 0 10px #cf222e';
        pin.onclick = (e) => { e.stopPropagation(); showDetail(defect, type); };
        pinsContainer.appendChild(pin);
    }

    function fixMapUrl(url) {
        if (!url) return url;
        const trimmed = url.trim();
        if (trimmed.includes('drive.google.com') || trimmed.includes('googledrive.com')) {
            const match = trimmed.match(/\/d\/([^/?]+)/) || trimmed.match(/id=([^&?]+)/);
            if (match && match[1]) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
        }
        return trimmed;
    }

    function showDetail(defect, type) {
        detailStatus.textContent = defect.status || 'Open';
        detailDesc.textContent = defect.description;
        const mainPhoto = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : '');
        detailImg.src = mainPhoto;
        detailImg.style.display = (mainPhoto) ? 'block' : 'none';
        detailModal.style.display = 'block';
    }

    photoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            saveBtn.disabled = true;
            document.getElementById('compressing-msg').style.display = 'block';
            compressImage(file, 1024, 0.7, (base) => {
                compressedPhotoData = base;
                previewImg.src = base; previewImg.style.display = 'block';
                saveBtn.disabled = false;
                document.getElementById('compressing-msg').style.display = 'none';
            });
        }
    };

    saveBtn.onclick = async () => {
        const desc = document.getElementById('defect-desc').value;
        if (!desc || !compressedPhotoData) return alert('Description and Photo are required.');
        
        window.showLoader('Staging report locally...');
        const defect = { 
            id: 'def-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            description: desc, photo: compressedPhotoData, position: activePinContext.position, 
            timestamp: new Date().toISOString(), unit: activePinContext.unit, story: activePinContext.story, status: 'Open', history: []
        };
        await db.put('pending_defects', defect);
        updateSelection();
        closeModal();
        syncAllPending();
        setTimeout(window.hideLoader, 500);
    };

    unitSelect.onchange = updateSelection;
    storySelect.onchange = updateSelection;
    closeDetailBtn.onclick = () => detailModal.style.display = 'none';
    cancelBtn.onclick = closeModal;
    function closeModal() { modal.style.display = 'none'; document.getElementById('defect-desc').value = ''; previewImg.style.display = 'none'; compressedPhotoData = null; photoInput.value = ''; activePinContext = null; activeCrosshair.style.display = 'none'; confirmPinBtn.style.display = 'none'; }

    async function authorizedPost(action, payload) {
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', mode: 'cors', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action, auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken }, ...payload })
            });
            if (res.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return null; }
            return res;
        } catch (err) { return null; }
    }

    await loadProjectConfig(true);
});

function compressImage(file, max, qual, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let w = img.width, h = img.height;
            if (w > h) { if (w > max) { h *= max/w; w = max; } }
            else { if (h > max) { w *= max/h; h = max; } }
            canvas.width = w; canvas.height = h;
            canvas.getContext('2d').drawImage(img, 0, 0, w, h);
            cb(canvas.toDataURL('image/jpeg', qual));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
