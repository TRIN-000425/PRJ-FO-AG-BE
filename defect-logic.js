let compressedPhotoData = null;
let projectConfig = { unitTypes: [], stories: [], unitNumbers: [], maps: [], syncedDefects: [] };
let isSyncing = false;

document.addEventListener('DOMContentLoaded', async () => {
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session) { window.location.href = 'index.html'; return; }

    const db = await window.initDB();
    const mapContainer = document.getElementById('map-container');
    const floorplanImg = document.getElementById('floorplan-img');
    const unitSelect = document.getElementById('unit-number-select');
    const storySelect = document.getElementById('story-select');
    const unitDisplay = document.getElementById('current-unit-display');
    const floorDisplay = document.getElementById('current-floor-display');
    const pinsContainer = document.getElementById('pins-container');
    const defectModal = document.getElementById('defect-modal');
    const photoInput = document.getElementById('defect-photo');
    const previewImg = document.getElementById('preview-img');
    const photoPlaceholder = document.getElementById('photo-placeholder');
    const saveBtn = document.getElementById('save-defect-btn');
    const cancelBtn = document.getElementById('cancel-defect-btn');
    const confirmPinBtn = document.getElementById('confirm-pin-btn');
    const activeCrosshair = document.getElementById('active-crosshair');

    let activePinPosition = null;

    // --- NAV BINDING ---
    document.getElementById('back-label').onclick = (e) => {
        e.preventDefault();
        window.showLoader('Returning to Dashboard...');
        setTimeout(() => { window.location.href = 'home.html'; }, 200);
    };

    document.getElementById('sync-label').onclick = async (e) => {
        e.preventDefault();
        window.showLoader('Syncing...');
        await syncAllPending();
        window.hideLoader();
    };

    mapContainer.onclick = (e) => {
        if (defectModal.style.display === 'flex') return;
        const rect = mapContainer.getBoundingClientRect();
        const x = ((e.clientX - rect.left) / rect.width) * 100;
        const y = ((e.clientY - rect.top) / rect.height) * 100;
        activePinPosition = { x, y };
        
        activeCrosshair.style.left = x + '%';
        activeCrosshair.style.top = y + '%';
        activeCrosshair.style.display = 'block';
        confirmPinBtn.style.display = 'flex';
    };

    confirmPinBtn.onclick = () => {
        defectModal.style.display = 'flex';
        confirmPinBtn.style.display = 'none';
    };

    cancelBtn.onclick = () => {
        defectModal.style.display = 'none';
        activeCrosshair.style.display = 'none';
        activePinPosition = null;
        document.getElementById('defect-desc').value = '';
        previewImg.style.display = 'none';
        photoPlaceholder.style.display = 'flex';
        compressedPhotoData = null;
    };

    photoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            document.getElementById('compressing-msg').style.display = 'block';
            compressImage(file, 1024, 0.7, (base) => {
                compressedPhotoData = base;
                previewImg.src = base;
                previewImg.style.display = 'block';
                photoPlaceholder.style.display = 'none';
                document.getElementById('compressing-msg').style.display = 'none';
            });
        }
    };

    saveBtn.onclick = async () => {
        const desc = document.getElementById('defect-desc').value.trim();
        if (!desc || !compressedPhotoData) return window.showAlert('Photo and description are required.', 'Missing Information', 'error');
        
        window.showLoader('Saving Defect...');
        const defect = { 
            id: window.generateId('def'),
            description: desc, photo: compressedPhotoData, position: activePinPosition, 
            timestamp: new Date().toISOString(), unit: unitSelect.value, story: storySelect.value, status: 'Open', history: []
        };
        await db.put('pending_defects', defect);
        await updateSelection();
        cancelBtn.onclick();
        window.hideLoader();
        syncAllPending(); // Background sync
        updateSyncBadge();
    };

    async function updateSyncBadge() {
        const pending = await db.getAll('pending_defects');
        const count = pending.length;
        const syncBadge = document.getElementById('sync-badge');
        if (syncBadge) {
            syncBadge.style.display = count > 0 ? 'flex' : 'none';
            syncBadge.textContent = count;
        }
    }

    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) return;
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) { updateSyncBadge(); return; }
        isSyncing = true;
        for (const d of pending) {
            try {
                const res = await window.authorizedPost('sync_defects', { defect: d });
                if (res && (await res.json()).status === 'success') await db.delete('pending_defects', d.id);
            } catch (e) {}
        }
        isSyncing = false;
        updateSyncBadge();
        await loadProjectConfig(false);
    }

    async function loadProjectConfig(useLoader = true) {
        if (useLoader) window.showLoader('Loading plans...');
        const cached = localStorage.getItem('project_config');
        if (cached) { projectConfig = JSON.parse(cached); renderSelectors(projectConfig); }
        if (navigator.onLine) {
            try {
                const res = await window.authorizedPost('get_config', {});
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
        if (config.unitNumbers) {
            unitSelect.innerHTML = config.unitNumbers.map(u => `<option value="${u.number}">${window.sanitize(u.number)} (${window.sanitize(u.type)})</option>`).join('');
        }
        if (config.stories) {
            storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${window.sanitize(s.label)}</option>`).join('');
        }
        updateSelection();
    }

    async function updateSelection() {
        const unitNumber = unitSelect.value;
        const story = storySelect.value;
        const unitMapping = projectConfig.unitNumbers.find(u => u.number === unitNumber);
        const unitType = unitMapping ? unitMapping.type : unitNumber;
        
        unitDisplay.textContent = unitNumber;
        floorDisplay.textContent = story;
        pinsContainer.innerHTML = '';
        
        let mapUrl = 'assets/floorplan-placeholder.png';
        if (projectConfig.maps) {
            const currentMap = projectConfig.maps.find(m => m.unit === unitType && m.story === story);
            if (currentMap) mapUrl = window.fixMapUrl(currentMap.mapUrl);
        }
        floorplanImg.src = mapUrl;
        
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
        const colors = { Open: '#f9ab00', Onprogress: '#1a73e8', Done: '#188038' };
        pin.style.backgroundColor = colors[defect.status] || '#d93025';
        if (type === 'pending') pin.style.boxShadow = '0 0 0 4px rgba(217, 48, 37, 0.4)';
        pinsContainer.appendChild(pin);
    }

    unitSelect.onchange = updateSelection;
    storySelect.onchange = updateSelection;

    await loadProjectConfig(true);
    await updateSyncBadge();
    window.checkAppVersion();
});

function compressImage(file, max, qual, cb) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = max;
            canvas.height = max;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#000000';
            ctx.fillRect(0, 0, max, max);
            let w = img.width, h = img.height;
            let targetW, targetH;
            if (w > h) {
                targetW = max;
                targetH = h * (max / w);
            } else {
                targetH = max;
                targetW = w * (max / h);
            }
            const offsetX = (max - targetW) / 2;
            const offsetY = (max - targetH) / 2;
            ctx.drawImage(img, offsetX, offsetY, targetW, targetH);
            cb(canvas.toDataURL('image/jpeg', qual));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}
