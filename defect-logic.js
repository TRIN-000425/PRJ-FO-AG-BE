let compressedPhotoData = null;
let projectConfig = { unitTypes: [], stories: [] };
let dbPromise = null;

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
    const unitSelect = document.getElementById('unit-type-select');
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

    const detailModal = document.getElementById('detail-modal');
    const detailStatus = document.getElementById('detail-status');
    const detailDesc = document.getElementById('detail-desc');
    const detailImg = document.getElementById('detail-img');
    const closeDetailBtn = document.getElementById('close-detail-btn');

    backBtn.onclick = () => window.location.href = 'home.html';

    await loadProjectConfig();

    async function loadProjectConfig() {
        const cached = localStorage.getItem('project_config');
        if (cached) { projectConfig = JSON.parse(cached); renderSelectors(projectConfig); }

        if (typeof GA_BACKEND_URL !== 'undefined' && GA_BACKEND_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            try {
                const res = await authorizedPost('get_config', {});
                if (!res) return;
                const result = await res.json();
                if (result.status === 'success') {
                    projectConfig = result.config;
                    localStorage.setItem('project_config', JSON.stringify(projectConfig));
                    renderSelectors(projectConfig);
                }
            } catch (err) { console.warn('Offline: Using cache'); }
        }
    }

    function sanitizeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function renderSelectors(config) {
        const prevUnit = unitSelect.value;
        const prevStory = storySelect.value;

        if (config.unitTypes) {
            unitSelect.innerHTML = config.unitTypes.map(u => 
                `<option value="${sanitizeHTML(u.value)}">${sanitizeHTML(u.label)}</option>`
            ).join('');
        }
        if (config.stories) {
            storySelect.innerHTML = config.stories.map(s => 
                `<option value="${sanitizeHTML(s.value)}">${sanitizeHTML(s.label)}</option>`
            ).join('');
        }

        if (Array.from(unitSelect.options).some(o => o.value === prevUnit)) unitSelect.value = prevUnit;
        if (Array.from(storySelect.options).some(o => o.value === prevStory)) storySelect.value = prevStory;

        updateSelection();
    }

    async function updateSelection() {
        const unit = unitSelect.value;
        const story = storySelect.value;
        unitDisplay.textContent = unit;
        floorDisplay.textContent = story;
        pinsContainer.innerHTML = '';

        let customMapUrl = null;
        if (projectConfig.maps) {
            const currentMap = projectConfig.maps.find(m => m.unit === unit && m.story === story);
            if (currentMap && currentMap.mapUrl) customMapUrl = currentMap.mapUrl;
        }
        
        floorplanImg.src = customMapUrl || `assets/${unit}_${story}.png`;
        floorplanImg.onerror = () => { floorplanImg.src = 'assets/floorplan-placeholder.png'; };
        
        if (projectConfig.syncedDefects) {
            projectConfig.syncedDefects.forEach(d => {
                if (d.unit === unit && d.story === story) addPinToUI(d, 'synced');
            });
        }

        const pending = await db.getAll('pending_defects');
        pending.forEach(d => {
            if (d.unit === unit && d.story === story) addPinToUI(d, 'pending');
        });
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
        
        // Status colors
        const colors = { Open: '#d29922', Onprogress: '#1877f2', Done: '#1a7f37' };
        pin.style.backgroundColor = colors[defect.status || 'Open'] || 'red';

        pin.onclick = (e) => {
            e.stopPropagation();
            showDetail(defect, type);
        };
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

    let isSyncing = false;
    syncBtn.onclick = async () => {
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) return alert('No pending defects');
        isSyncing = true;
        syncBtn.disabled = true; 
        let success = 0;
        for (const defect of pending) {
            syncBtn.textContent = `Syncing... (${success + 1}/${pending.length})`;
            try {
                const res = await authorizedPost('sync_defects', { defect });
                if (res && (await res.json()).status === 'success') {
                    await db.delete('pending_defects', defect.id);
                    success++;
                }
            } catch (err) { console.error(err); }
        }
        alert(`Sync Complete. ${success} records synced.`);
        isSyncing = false;
        syncBtn.disabled = false; 
        syncBtn.textContent = 'Sync to GA';
        await loadProjectConfig(); 
        await updateSelection();
    };

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
            status: 'Open' // Default status
        };
        await db.put('pending_defects', defect);
        if (unitSelect.value === defect.unit && storySelect.value === defect.story) addPinToUI(defect, 'pending');
        closeModal();
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
