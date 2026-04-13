let compressedPhotoData = null;
let projectConfig = { unitTypes: [], stories: [] };
let dbPromise = null;
let isSyncing = false;

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

    // Global Loader helpers
    window.showLoader = (text = 'Loading...') => {
        const loader = document.getElementById('global-loader');
        const loaderText = document.getElementById('loader-text');
        if (loader) {
            if (loaderText) loaderText.textContent = text;
            loader.style.display = 'flex';
        }
    };
    window.hideLoader = () => {
        const loader = document.getElementById('global-loader');
        if (loader) loader.style.display = 'none';
    };

    backBtn.onclick = () => window.location.href = 'home.html';

    // --- AUTO-SYNC LOGIC ---
    function updateSyncUI(status) {
        if (!syncIndicator) return;
        if (status === 'syncing') {
            syncIndicator.style.background = '#1877f2';
            syncIndicator.style.boxShadow = '0 0 10px #1877f2';
        } else if (status === 'online') {
            syncIndicator.style.background = '#1a7f37';
            syncIndicator.style.boxShadow = 'none';
        } else {
            syncIndicator.style.background = '#cf222e';
            syncIndicator.style.boxShadow = 'none';
        }
    }

    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) return;
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) { updateSyncUI('online'); return; }

        isSyncing = true;
        updateSyncUI('syncing');
        let successCount = 0;
        for (const d of pending) {
            try {
                const res = await authorizedPost('sync_defects', { defect: d });
                if (res && (await res.json()).status === 'success') {
                    await db.delete('pending_defects', d.id);
                    successCount++;
                }
            } catch (e) { console.warn('Background sync failed'); }
        }
        isSyncing = false;
        if (successCount > 0) { await loadProjectConfig(); }
        updateSyncUI(navigator.onLine ? 'online' : 'offline');
    }

    window.addEventListener('online', syncAllPending);
    setInterval(syncAllPending, 30000);
    syncAllPending();

    syncBtn.onclick = async () => {
        if (!navigator.onLine) return alert('Offline');
        showLoader('Syncing defects...');
        await syncAllPending();
        hideLoader();
        alert('Sync complete');
    };

    // --- RENDER & LOGIC ---
    await loadProjectConfig();

    async function loadProjectConfig() {
        showLoader('Loading project configuration...');
        const cached = localStorage.getItem('project_config');
        if (cached) { projectConfig = JSON.parse(cached); renderSelectors(projectConfig); }

        if (typeof GA_BACKEND_URL !== 'undefined' && GA_BACKEND_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            try {
                const res = await authorizedPost('get_config', {});
                if (!res) { hideLoader(); return; }
                const result = await res.json();
                if (result.status === 'success') {
                    projectConfig = result.config;
                    localStorage.setItem('project_config', JSON.stringify(projectConfig));
                    renderSelectors(projectConfig);
                }
            } catch (err) { console.warn('Offline: Using cache'); }
        }
        hideLoader();
    }

    function sanitizeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderSelectors(config) {
        const prevUnit = unitSelect.value;
        const prevStory = storySelect.value;
        if (config.unitNumbers) {
            unitSelect.innerHTML = config.unitNumbers.map(u => `<option value="${sanitizeHTML(u.number)}">${sanitizeHTML(u.number)} (${sanitizeHTML(u.type)})</option>`).join('');
        }
        if (config.stories) {
            storySelect.innerHTML = config.stories.map(s => `<option value="${sanitizeHTML(s.value)}">${sanitizeHTML(s.label)}</option>`).join('');
        }
        if (Array.from(unitSelect.options).some(o => o.value === prevUnit)) unitSelect.value = prevUnit;
        if (Array.from(storySelect.options).some(o => o.value === prevStory)) storySelect.value = prevStory;
        updateSelection();
    }

    async function updateSelection() {
        const unitNumber = unitSelect.value.trim();
        const story = storySelect.value.trim();
        
        // Find mapped unit type
        const unitMapping = projectConfig.unitNumbers ? projectConfig.unitNumbers.find(u => u.number === unitNumber) : null;
        const unitType = unitMapping ? unitMapping.type : unitNumber;

        unitDisplay.textContent = unitNumber;
        floorDisplay.textContent = story;
        pinsContainer.innerHTML = '';
        let customMapUrl = null;

        if (projectConfig.maps) {
            // Use unitType for map lookup
            const currentMap = projectConfig.maps.find(m => 
                (m.unit || '').toString().trim().toLowerCase() === unitType.toLowerCase() && 
                (m.story || '').toString().trim().toLowerCase() === story.toLowerCase()
            );
            if (currentMap && currentMap.mapUrl) {
                customMapUrl = fixMapUrl(currentMap.mapUrl);
            }
        }
        
        const finalUrl = customMapUrl || `assets/${unitType}_${story}.png`;
        if (floorplanImg.src !== finalUrl) {
            floorplanImg.src = finalUrl;
        }

        floorplanImg.onerror = () => { 
            // Only fall back if we haven't already fallen back to the placeholder
            if (!floorplanImg.src.includes('placeholder')) {
                console.warn('Map load failed, using placeholder');
                floorplanImg.src = 'assets/floorplan-placeholder.png'; 
            }
        };
        
        if (projectConfig.syncedDefects) {
            projectConfig.syncedDefects.forEach(d => {
                const dUnit = (d.unit || '').toString().trim();
                const dStory = (d.story || '').toString().trim();
                if (dUnit === unitNumber && dStory === story) addPinToUI(d, 'synced');
            });
        }
        const pending = await db.getAll('pending_defects');
        pending.forEach(d => {
            const dUnit = (d.unit || '').toString().trim();
            const dStory = (d.story || '').toString().trim();
            if (dUnit === unitNumber && dStory === story) addPinToUI(d, 'pending');
        });
    }

    function fixMapUrl(url) {
        if (!url) return url;
        const trimmed = url.trim();
        // Convert various Google Drive link styles to a direct viewable format
        if (trimmed.includes('drive.google.com')) {
            const match = trimmed.match(/\/d\/([^/]+)/) || trimmed.match(/id=([^&]+)/);
            if (match && match[1]) {
                // thumbnail sz=w1600 is very reliable for public/shared-link drive images
                return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
            }
        }
        return trimmed;
    }

    unitSelect.onchange = updateSelection;
    storySelect.onchange = updateSelection;

    function addPinToUI(defect, type) {
        if (!defect || !defect.position || isNaN(defect.position.x) || isNaN(defect.position.y)) return;
        const pin = document.createElement('div');
        pin.className = 'pin';
        pin.style.left = defect.position.x + '%'; 
        pin.style.top = defect.position.y + '%';
        pin.style.width = '18px';
        pin.style.height = '18px';
        pin.style.border = '2px solid white';
        const colors = { Open: '#d29922', Onprogress: '#1877f2', Done: '#1a7f37' };
        pin.style.backgroundColor = colors[defect.status || 'Open'] || 'red';
        pin.onclick = (e) => { e.stopPropagation(); showDetail(defect, type); };
        pinsContainer.appendChild(pin);
    }

    function showDetail(defect, type) {
        detailStatus.textContent = defect.status || 'Open';
        detailDesc.textContent = defect.description;
        detailImg.src = defect.photo || defect.photoUrl || '';
        detailImg.style.display = (detailImg.src) ? 'block' : 'none';
        detailModal.style.display = 'block';
    }

    closeDetailBtn.onclick = () => detailModal.style.display = 'none';

    async function authorizedPost(action, payload) {
        const res = await fetch(GA_BACKEND_URL, {
            method: 'POST', mode: 'cors',
            body: JSON.stringify({
                action,
                auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken },
                ...payload
            })
        });
        if (res.status === 401) { localStorage.removeItem('user_session'); window.location.href = 'index.html'; return null; }
        return res;
    }

    let activePinContext = null;
    mapContainer.onclick = (e) => {
        if (modal.style.display === 'block') return;
        if (e.target !== mapContainer && e.target !== floorplanImg) return;
        const rect = mapContainer.getBoundingClientRect();
        activePinContext = {
            unit: unitSelect.value,
            story: storySelect.value,
            position: { x: ((e.clientX - rect.left) / rect.width) * 100, y: ((e.clientY - rect.top) / rect.height) * 100 }
        };
        modal.style.display = 'block';
    };

    photoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            saveBtn.disabled = true;
            document.getElementById('compressing-msg').style.display = 'block';
            compressImage(file, 1024, 0.7, (base) => {
                compressedPhotoData = base;
                previewImg.src = base; 
                previewImg.style.display = 'block';
                saveBtn.disabled = false;
                document.getElementById('compressing-msg').style.display = 'none';
            });
        }
    };

    saveBtn.onclick = async () => {
        const desc = document.getElementById('defect-desc').value;
        if (!desc || !compressedPhotoData) return alert('Missing info');
        const defect = { 
            id: 'def-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5),
            description: desc, 
            photo: compressedPhotoData, 
            position: activePinContext.position, 
            timestamp: new Date().toISOString(),
            unit: activePinContext.unit,
            story: activePinContext.story,
            status: 'Open'
        };
        await db.put('pending_defects', defect);
        if (unitSelect.value === defect.unit && storySelect.value === defect.story) addPinToUI(defect, 'pending');
        closeModal();
        syncAllPending(); // Trigger auto-sync
    };

    cancelBtn.onclick = closeModal;
    function closeModal() { 
        modal.style.display = 'none'; 
        document.getElementById('defect-desc').value = ''; 
        previewImg.style.display = 'none'; 
        compressedPhotoData = null; 
        photoInput.value = '';
        activePinContext = null;
    }
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
