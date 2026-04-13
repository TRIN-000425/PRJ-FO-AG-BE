let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;

// GLOBAL STORE for defects
window.allRenderedDefects = {};

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

// Map fixing helper (global)
function fixMapUrl(url) {
    if (!url) return url;
    const trimmed = url.trim();
    if (trimmed.includes('drive.google.com') || trimmed.includes('googledrive.com')) {
        const match = trimmed.match(/\/d\/([^/?]+)/) || 
                      trimmed.match(/id=([^&?]+)/);
        if (match && match[1]) {
            return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
        }
        const idMatch = trimmed.split('id=')[1] || trimmed.split('/d/')[1];
        if (idMatch) {
            const cleanId = idMatch.split(/[&?]/)[0];
            return `https://drive.google.com/thumbnail?id=${cleanId}&sz=w1600`;
        }
    }
    return trimmed;
}

// Define globally before DOMContentLoaded
window.showDefectDetailById = (id) => {
    console.log('Opening defect detail for:', id);
    const defect = window.allRenderedDefects[id];
    if (!defect) {
        console.error('Defect not found in global store:', id);
        return;
    }
    
    currentUpdatingDefect = defect;
    updatedDonePhotoBase64 = null;
    
    try {
        const detailStatusText = document.getElementById('detail-status-text');
        const detailDesc = document.getElementById('detail-desc');
        const detailImg = document.getElementById('detail-img');
        const updateStatusSelect = document.getElementById('update-status-select');
        const donePhotoGroup = document.getElementById('done-photo-group');
        const detailModal = document.getElementById('detail-modal');

        if (detailStatusText) detailStatusText.textContent = defect.status || 'Open';
        if (detailDesc) detailDesc.textContent = defect.description;
        
        const mainPhoto = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : '');
        if (detailImg) {
            detailImg.src = mainPhoto;
            detailImg.style.display = mainPhoto ? 'block' : 'none';
        }
        
        if (updateStatusSelect) updateStatusSelect.value = defect.status || 'Open';
        if (donePhotoGroup) donePhotoGroup.style.display = (updateStatusSelect.value === 'Done') ? 'block' : 'none';
        if (detailModal) detailModal.style.display = 'block';
    } catch (err) {
        console.error('Error opening modal:', err);
    }
};

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

    const adminModal = document.getElementById('admin-modal');
    const closeAdminBtn = document.getElementById('close-admin-btn');
    const detailModal = document.getElementById('detail-modal');
    const closeDetailBtn = document.getElementById('close-detail-btn');
    const updateStatusSelect = document.getElementById('update-status-select');
    const donePhotoGroup = document.getElementById('done-photo-group');
    const donePhotoInput = document.getElementById('done-photo-input');
    const saveUpdateBtn = document.getElementById('save-update-btn');

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

    if (session.role === 'Admin') adminBtn.style.display = 'block';
    adminBtn.onclick = () => adminModal.style.display = 'block';
    closeAdminBtn.onclick = () => adminModal.style.display = 'none';

    document.getElementById('refresh-admin-table-btn').onclick = async () => {
        showLoader('Refreshing configuration...');
        try { await refreshConfig(); } catch (e) { alert(e.toString()); } finally { hideLoader(); }
    };

    logoutBtn.onclick = () => {
        localStorage.removeItem('user_session');
        localStorage.removeItem('project_config');
        window.location.href = 'index.html';
    };

    newReportBtn.onclick = () => { window.location.href = 'defect.html'; };

    // AUTO-SYNC
    function updateSyncUI(status) {
        if (!syncIndicator) return;
        const colors = { syncing: '#1877f2', online: '#1a7f37', offline: '#cf222e' };
        syncIndicator.style.background = colors[status] || '#ccc';
        syncIndicator.style.boxShadow = (status === 'syncing') ? '0 0 10px #1877f2' : 'none';
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
            } catch (e) { console.warn('Sync failed for:', d.id); }
        }
        isSyncing = false;
        if (successCount > 0) { await refreshConfig(); }
        updateSyncUI(navigator.onLine ? 'online' : 'offline');
    }

    window.addEventListener('online', syncAllPending);
    setInterval(syncAllPending, 30000);
    syncAllPending();

    syncBtn.onclick = async () => {
        if (!navigator.onLine) return alert('Offline');
        showLoader('Syncing & checking for updates...');
        try {
            await syncAllPending();
            await refreshConfig();
            if ('serviceWorker' in navigator) {
                const reg = await navigator.serviceWorker.getRegistration();
                if (reg) await reg.update();
            }
            alert('Complete!');
        } catch (e) { alert(e.toString()); } finally { hideLoader(); }
    };

    // DASHBOARD
    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading lifecycle data...</p></div>';
        let projectConfig = { syncedDefects: [] };
        const cached = localStorage.getItem('project_config');
        if (cached) {
            projectConfig = JSON.parse(cached);
            warmCache(projectConfig);
        }

        const pendingDefects = await db.getAll('pending_defects');
        const allDefects = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true })),
            ...pendingDefects.map(d => ({ ...d, isSynced: false }))
        ];

        window.allRenderedDefects = {};
        allDefects.forEach(d => { window.allRenderedDefects[d.id] = d; });

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
            html += `<div class="unit-section"><h3 class="unit-header">${unit}</h3><div class="defect-grid">`;
            html += defects.map(d => {
                const photo = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : 
                            (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png'));
                return `
                    <div class="defect-card neu-raised" onclick="window.showDefectDetailById('${d.id}')">
                        <span class="badge ${d.status || 'Open'}">${d.status || 'Open'}</span>
                        ${!d.isSynced ? '<span class="badge pending" style="top: auto; bottom: 10px;">Pending</span>' : ''}
                        <img src="${photo}" class="defect-card-img" onerror="this.src='assets/floorplan-placeholder.png'">
                        <h4>${d.story || 'N/A'}</h4>
                        <p class="desc">${d.description || 'No description'}</p>
                        <p class="date">${new Date(d.timestamp).toLocaleDateString()}</p>
                    </div>
                `;
            }).join('');
            html += `</div></div>`;
        }
        dashboardContent.innerHTML = html;
    }

    async function refreshConfig() {
        try {
            const res = await authorizedPost('get_config', {});
            if (res) {
                const result = await res.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    await renderDashboard();
                    warmCache(result.config);
                }
            }
        } catch (e) { console.error('Refresh Config Exception:', e); }
    }

    function warmCache(config) {
        if (!config || !navigator.onLine) return;
        const urls = new Set();
        if (config.maps) config.maps.forEach(m => { if (m.mapUrl) urls.add(fixMapUrl(m.mapUrl)); });
        if (config.syncedDefects) config.syncedDefects.forEach(d => {
            if (d.photoUrl) urls.add(fixMapUrl(d.photoUrl));
            if (d.donePhotoUrl) urls.add(fixMapUrl(d.donePhotoUrl));
        });
        urls.forEach(url => { if (url && url.startsWith('http')) fetch(url, { mode: 'no-cors' }).catch(() => {}); });
    }

    await loadAdminSelectors(); // Initial load of selectors
    await renderDashboard();

    // UPDATE LOGIC
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
            return alert('Completion photo is required.');
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
        syncAllPending();
    };

    closeDetailBtn.onclick = () => detailModal.style.display = 'none';

    async function loadAdminSelectors() {
        const cached = localStorage.getItem('project_config');
        if (!cached) return;
        try {
            const config = JSON.parse(cached);
            const unitSelect = document.getElementById('admin-unit-select');
            const storySelect = document.getElementById('admin-story-select');
            if (config.unitTypes && unitSelect) {
                unitSelect.innerHTML = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
            }
            if (config.stories && storySelect) {
                storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
            }
        } catch (e) { console.error('Error parsing config:', e); }
    }

    async function authorizedPost(action, payload) {
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', 
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action,
                    auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken },
                    ...payload
                })
            });
            if (res.status === 401) { 
                localStorage.removeItem('user_session'); 
                window.location.href = 'index.html'; 
                return null; 
            }
            return res;
        } catch (err) { return null; }
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
