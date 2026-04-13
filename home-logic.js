let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
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
    const logoutBtn = document.getElementById('logout-btn');
    const newReportBtn = document.getElementById('new-report-btn');
    const syncBtn = document.getElementById('sync-btn');
    const adminBtn = document.getElementById('admin-btn');
    const dashboardContent = document.getElementById('dashboard-content');
    const syncIndicator = document.getElementById('sync-indicator');

    // Modals & Elements
    const adminModal = document.getElementById('admin-modal');
    const closeAdminBtn = document.getElementById('close-admin-btn');
    const detailModal = document.getElementById('detail-modal');
    const closeDetailBtn = document.getElementById('close-detail-btn');
    const updateStatusSelect = document.getElementById('update-status-select');
    const donePhotoGroup = document.getElementById('done-photo-group');
    const donePhotoInput = document.getElementById('done-photo-input');
    const saveUpdateBtn = document.getElementById('save-update-btn');
    
    const detailStatusText = document.getElementById('detail-status-text');
    const detailDesc = document.getElementById('detail-desc');
    const detailImg = document.getElementById('detail-img');

    // Admin UI Initialization
    if (session.role === 'Admin') adminBtn.style.display = 'block';
    adminBtn.onclick = () => adminModal.style.display = 'block';
    closeAdminBtn.onclick = () => adminModal.style.display = 'none';

    logoutBtn.onclick = () => {
        localStorage.removeItem('user_session');
        localStorage.removeItem('project_config');
        window.location.href = 'index.html';
    };

    newReportBtn.onclick = () => {
        window.location.href = 'defect.html';
    };

    // --- AUTO-SYNC LOGIC ---
    function updateSyncUI(status) {
        if (!syncIndicator) return;
        if (status === 'syncing') {
            syncIndicator.style.background = '#1877f2';
            syncIndicator.style.boxShadow = '0 0 10px #1877f2';
            syncIndicator.title = 'Syncing in background...';
        } else if (status === 'online') {
            syncIndicator.style.background = '#1a7f37';
            syncIndicator.style.boxShadow = 'none';
            syncIndicator.title = 'Online - Ready';
        } else {
            syncIndicator.style.background = '#cf222e';
            syncIndicator.style.boxShadow = 'none';
            syncIndicator.title = 'Offline';
        }
    }

    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) return;
        
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) {
            updateSyncUI('online');
            return;
        }

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
            } catch (e) { console.warn('Background sync failed for item:', d.id); }
        }

        isSyncing = false;
        if (successCount > 0) {
            await refreshConfig(); // Refresh dashboard if items were synced
        }
        updateSyncUI(navigator.onLine ? 'online' : 'offline');
    }

    // Trigger sync on events
    window.addEventListener('online', syncAllPending);
    setInterval(syncAllPending, 30000); // Check every 30 seconds
    syncAllPending(); // Initial check

    // Manual Sync Button
    syncBtn.onclick = async () => {
        if (!navigator.onLine) return alert('You are offline. Cannot sync.');
        await syncAllPending();
        alert('Manual sync complete.');
    };

    // --- CONFIG & ADMIN ---
    await loadAdminSelectors();

    async function loadAdminSelectors() {
        const cached = localStorage.getItem('project_config');
        if (cached) {
            const config = JSON.parse(cached);
            const unitSelect = document.getElementById('admin-unit-select');
            const storySelect = document.getElementById('admin-story-select');
            if (config.unitTypes) unitSelect.innerHTML = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
            if (config.stories) storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
        }
    }

    document.getElementById('add-unit-btn').onclick = async () => {
        const val = document.getElementById('new-unit-val').value.trim();
        const label = document.getElementById('new-unit-label').value.trim();
        if (!val || !label) return alert('Enter both ID and Name');
        const res = await authorizedPost('add_unit', { value: val, label: label });
        if (res && (await res.json()).status === 'success') { alert('Unit added!'); await refreshConfig(); }
    };

    document.getElementById('add-story-btn').onclick = async () => {
        const val = document.getElementById('new-story-val').value.trim();
        const label = document.getElementById('new-story-label').value.trim();
        if (!val || !label) return alert('Enter both ID and Name');
        const res = await authorizedPost('add_story', { value: val, label: label });
        if (res && (await res.json()).status === 'success') { alert('Story added!'); await refreshConfig(); }
    };

    document.getElementById('upload-map-btn').onclick = async () => {
        const file = document.getElementById('map-upload-input').files[0];
        if (!file) return alert('Select PNG');
        const reader = new FileReader();
        reader.onload = async (e) => {
            const res = await authorizedPost('upload_map', { 
                unit: document.getElementById('admin-unit-select').value, 
                story: document.getElementById('admin-story-select').value, 
                imageBlob: e.target.result 
            });
            if (res && (await res.json()).status === 'success') { alert('Uploaded!'); await refreshConfig(); }
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('add-map-url-btn').onclick = async () => {
        const url = document.getElementById('map-url-input').value.trim();
        if (!url) return alert('Enter URL');
        const res = await authorizedPost('add_map_url', { 
            unit: document.getElementById('admin-unit-select').value, 
            story: document.getElementById('admin-story-select').value, 
            mapUrl: url 
        });
        if (res && (await res.json()).status === 'success') { alert('Map URL updated!'); await refreshConfig(); }
    };

    async function refreshConfig() {
        const res = await authorizedPost('get_config', {});
        if (res) {
            const result = await res.json();
            if (result.status === 'success') {
                localStorage.setItem('project_config', JSON.stringify(result.config));
                await loadAdminSelectors();
                await renderDashboard();
            }
        }
    }

    // --- DASHBOARD RENDER ---
    await renderDashboard();

    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading lifecycle data...</p></div>';
        let projectConfig = { syncedDefects: [] };
        const cached = localStorage.getItem('project_config');
        if (cached) projectConfig = JSON.parse(cached);

        const pendingDefects = await db.getAll('pending_defects');
        const allDefects = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true })),
            ...pendingDefects.map(d => ({ ...d, isSynced: false }))
        ];

        if (allDefects.length === 0) {
            dashboardContent.innerHTML = '<div class="neu-inset" style="text-align: center; padding: 50px; border-radius: 20px;"><p>No defect reports found.</p></div>';
            return;
        }

        const grouped = allDefects.reduce((acc, d) => {
            const unit = d.unit || 'Unknown';
            if (!acc[unit]) acc[unit] = [];
            acc[unit].push(d);
            return acc;
        }, {});

        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            html += `
                <div class="unit-section">
                    <h3 class="unit-header">${unit}</h3>
                    <div class="defect-grid">
                        ${defects.map(d => `
                            <div class="defect-card neu-raised" onclick='window.showDefectDetail(${JSON.stringify(d).replace(/'/g, "&apos;")})'>
                                <span class="badge ${d.status || 'Open'}">${d.status || 'Open'}</span>
                                ${!d.isSynced ? '<span class="badge pending" style="top: auto; bottom: 10px;">Pending Sync</span>' : ''}
                                <img src="${d.donePhotoUrl || d.photo || d.photoUrl || 'assets/floorplan-placeholder.png'}" class="defect-card-img">
                                <h4>${d.story || 'N/A'}</h4>
                                <p class="desc">${d.description || 'No description'}</p>
                                <p class="date">${new Date(d.timestamp).toLocaleDateString()}</p>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `;
        }
        dashboardContent.innerHTML = html;
    }

    window.showDefectDetail = (defect) => {
        currentUpdatingDefect = defect;
        updatedDonePhotoBase64 = null;
        detailStatusText.textContent = defect.status || 'Open';
        detailDesc.textContent = defect.description;
        detailImg.src = defect.photo || defect.photoUrl || '';
        updateStatusSelect.value = defect.status || 'Open';
        donePhotoGroup.style.display = (updateStatusSelect.value === 'Done') ? 'block' : 'none';
        detailModal.style.display = 'block';
    };

    updateStatusSelect.onchange = () => {
        donePhotoGroup.style.display = (updateStatusSelect.value === 'Done') ? 'block' : 'none';
    };

    donePhotoInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            document.getElementById('done-compressing-msg').style.display = 'block';
            compressImage(file, 1024, 0.7, (base) => {
                updatedDonePhotoBase64 = base;
                document.getElementById('done-compressing-msg').style.display = 'none';
            });
        }
    };

    saveUpdateBtn.onclick = async () => {
        const newStatus = updateStatusSelect.value;
        if (newStatus === 'Done' && !updatedDonePhotoBase64 && !currentUpdatingDefect.donePhotoUrl) {
            return alert('Completion photo is required to mark as Done.');
        }

        const updated = { 
            ...currentUpdatingDefect, 
            status: newStatus,
            donePhoto: updatedDonePhotoBase64 || currentUpdatingDefect.donePhoto
        };
        delete updated.isSynced;

        await db.put('pending_defects', updated);
        detailModal.style.display = 'none';
        await renderDashboard();
        syncAllPending(); // Trigger auto-sync immediately
    };

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
