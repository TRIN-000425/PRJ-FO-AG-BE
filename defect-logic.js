let currentPinPos = null;
let compressedPhotoData = null;
let projectConfig = { unitTypes: [], stories: [] };

const GA_BACKEND_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

document.addEventListener('DOMContentLoaded', async () => {
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session) { window.location.href = 'index.html'; return; }

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
    const adminBtn = document.getElementById('admin-btn');
    const adminModal = document.getElementById('admin-modal');
    const closeAdminBtn = document.getElementById('close-admin-btn');

    if (session.role !== 'Admin') adminBtn.style.display = 'none';
    const backBtn = document.getElementById('back-btn');
    backBtn.onclick = () => window.location.href = 'index.html';

    await loadProjectConfig();

    async function loadProjectConfig() {
        const cached = localStorage.getItem('project_config');
        if (cached) { projectConfig = JSON.parse(cached); renderSelectors(projectConfig); }

        if (GA_BACKEND_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            try {
                const res = await fetch(GA_BACKEND_URL, { method: 'POST', mode: 'cors', body: JSON.stringify({ action: 'get_config' }) });
                const result = await res.json();
                if (result.status === 'success') {
                    projectConfig = result.config;
                    localStorage.setItem('project_config', JSON.stringify(projectConfig));
                    renderSelectors(projectConfig);
                }
            } catch (err) { console.warn('Offline: Using cache'); }
        }
    }

    function renderSelectors(config) {
        if (config.unitTypes) unitSelect.innerHTML = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
        if (config.stories) storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
        updateSelection();
    }

    function updateSelection() {
        const unit = unitSelect.value;
        const story = storySelect.value;
        unitDisplay.textContent = unit;
        floorDisplay.textContent = story;
        pinsContainer.innerHTML = '';

        // SEARCH FOR CUSTOM MAP URL IN CONFIG
        let customMapUrl = null;
        if (projectConfig.maps) {
            const currentMap = projectConfig.maps.find(m => m.unit === unit && m.story === story);
            if (currentMap && currentMap.mapUrl) {
                customMapUrl = currentMap.mapUrl;
            }
        }
        
        if (customMapUrl) {
            floorplanImg.src = customMapUrl;
        } else {
            floorplanImg.src = `assets/${unit}_${story}.png`;
        }
        
        floorplanImg.onerror = () => { floorplanImg.src = 'assets/floorplan-placeholder.png'; };
        loadPinsForCurrentView(unit, story);
    }

    unitSelect.onchange = updateSelection;
    storySelect.onchange = updateSelection;

    adminBtn.onclick = () => adminModal.style.display = 'block';
    closeAdminBtn.onclick = () => adminModal.style.display = 'none';

    async function authorizedPost(action, payload) {
        return fetch(GA_BACKEND_URL, {
            method: 'POST', mode: 'cors',
            body: JSON.stringify({
                action,
                auth: { 
                    username: session.username, 
                    deviceId: session.deviceId, 
                    deviceToken: session.deviceToken 
                },
                ...payload
            })
        });
    }

    document.getElementById('add-unit-btn').onclick = async () => {
        const val = document.getElementById('new-unit-val').value;
        const label = document.getElementById('new-unit-label').value;
        const res = await authorizedPost('add_unit', { value: val, label: label });
        const result = await res.json();
        if (result.status === 'success') { alert('Unit added!'); await loadProjectConfig(); }
    };

    document.getElementById('add-story-btn').onclick = async () => {
        const val = document.getElementById('new-story-val').value;
        const label = document.getElementById('new-story-label').value;
        const res = await authorizedPost('add_story', { value: val, label: label });
        const result = await res.json();
        if (result.status === 'success') { alert('Story added!'); await loadProjectConfig(); }
    };

    document.getElementById('upload-map-btn').onclick = async () => {
        const file = document.getElementById('map-upload-input').files[0];
        if (!file) return alert('Select PNG');
        const reader = new FileReader();
        reader.onload = async (e) => {
            const res = await authorizedPost('upload_map', {
                unit: unitSelect.value, story: storySelect.value, imageBlob: e.target.result
            });
            const result = await res.json();
            if (result.status === 'success') { alert('Uploaded!'); await loadProjectConfig(); }
        };
        reader.readAsDataURL(file);
    };

    syncBtn.onclick = async () => {
        const defects = JSON.parse(localStorage.getItem('pending_defects') || '[]');
        if (defects.length === 0) return alert('No pending defects');
        syncBtn.disabled = true; syncBtn.textContent = 'Syncing...';
        try {
            const res = await authorizedPost('sync_defects', { defects });
            const result = await res.json();
            if (result.status === 'success') { alert('Synced!'); localStorage.removeItem('pending_defects'); updateSelection(); }
        } catch (err) { alert('Sync failed'); }
        syncBtn.disabled = false; syncBtn.textContent = 'Sync to GA';
    };

    mapContainer.onclick = (e) => {
        const rect = mapContainer.getBoundingClientRect();
        currentPinPos = {
            x: ((e.clientX - rect.left) / rect.width) * 100,
            y: ((e.clientY - rect.top) / rect.height) * 100
        };
        modal.style.display = 'block';
    };

    photoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) compressImage(file, 1024, 0.7, (base) => {
            compressedPhotoData = base;
            previewImg.src = base; previewImg.style.display = 'block';
        });
    };

    saveBtn.onclick = () => {
        const desc = document.getElementById('defect-desc').value;
        if (!desc || !compressedPhotoData) return alert('Missing info');
        saveDefectLocally({ description: desc, photo: compressedPhotoData, position: currentPinPos, timestamp: new Date().toISOString() });
        addPinToUI(currentPinPos);
        closeModal();
    };

    cancelBtn.onclick = closeModal;
    function closeModal() { modal.style.display = 'none'; document.getElementById('defect-desc').value = ''; previewImg.style.display = 'none'; compressedPhotoData = null; }
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

function loadPinsForCurrentView(unit, story) {
    const defects = JSON.parse(localStorage.getItem('pending_defects') || '[]');
    defects.forEach(d => { if (d.unit === unit && d.story === story) addPinToUI(d.position); });
}

function saveDefectLocally(d) {
    d.unit = document.getElementById('unit-type-select').value;
    d.story = document.getElementById('story-select').value;
    const all = JSON.parse(localStorage.getItem('pending_defects') || '[]');
    all.push(d);
    localStorage.setItem('pending_defects', JSON.stringify(all));
}

function addPinToUI(pos) {
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.style.left = pos.x + '%'; pin.style.top = pos.y + '%';
    document.getElementById('pins-container').appendChild(pin);
}
