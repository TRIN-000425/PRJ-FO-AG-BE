let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;
let currentView = 'grid';

window.allRenderedDefects = {};

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

function fixMapUrl(url) {
    if (!url) return url;
    const trimmed = url.trim();
    if (trimmed.includes('drive.google.com') || trimmed.includes('googledrive.com')) {
        const match = trimmed.match(/\/d\/([^/?]+)/) || trimmed.match(/id=([^&?]+)/);
        if (match && match[1]) return `https://drive.google.com/thumbnail?id=${match[1]}&sz=w1600`;
        const idMatch = trimmed.split('id=')[1] || trimmed.split('/d/')[1];
        if (idMatch) {
            const cleanId = idMatch.split(/[&?]/)[0];
            return `https://drive.google.com/thumbnail?id=${cleanId}&sz=w1600`;
        }
    }
    return trimmed;
}

// --- PDF EXPORT WITH IMAGES ---
window.exportUnitPDF = async (unitNumber) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const defects = Object.values(window.allRenderedDefects).filter(d => d.unit === unitNumber);
    
    window.showLoader(`Generating professional report for ${unitNumber}...`);
    
    doc.setFontSize(22);
    doc.setTextColor(24, 119, 242);
    doc.text(`Punch List: Unit ${unitNumber}`, 20, 20);
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 28);
    doc.line(20, 32, 190, 32);
    
    let y = 45;
    for (let i = 0; i < defects.length; i++) {
        const d = defects[i];
        if (y > 220) { doc.addPage(); y = 20; }
        
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text(`${i + 1}. ${d.description || 'No Description'}`, 20, y);
        
        y += 7;
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Status: ${d.status} | Floor: ${d.story} | Date: ${new Date(d.timestamp).toLocaleDateString()}`, 20, y);
        
        // Add Photo if available
        const photoUrl = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : ''));
        if (photoUrl) {
            try {
                const imgData = await getBase64FromUrl(photoUrl);
                y += 5;
                doc.addImage(imgData, 'JPEG', 20, y, 50, 35);
                y += 40;
            } catch (e) { console.warn('PDF Image failed:', e); y += 10; }
        } else {
            y += 10;
        }
        
        if (d.history && d.history.length > 0) {
            doc.setFontSize(9);
            doc.setTextColor(120);
            doc.text(`Latest Update: ${d.history[d.history.length-1].msg}`, 25, y);
            y += 8;
        }
        y += 5;
    }
    
    doc.save(`Report_${unitNumber}_${new Date().getTime()}.pdf`);
    window.hideLoader();
};

async function getBase64FromUrl(url) {
    if (url.startsWith('data:')) return url;
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// --- GLOBAL MODAL ACCESS ---
window.showDefectDetailById = (id) => {
    const defect = window.allRenderedDefects[id];
    if (!defect) return;
    currentUpdatingDefect = JSON.parse(JSON.stringify(defect));
    updatedDonePhotoBase64 = null;
    
    document.getElementById('detail-status-text').textContent = defect.status || 'Open';
    document.getElementById('detail-desc').textContent = defect.description;
    
    const mainPhoto = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : '');
    const img = document.getElementById('detail-img');
    img.src = mainPhoto;
    img.style.display = mainPhoto ? 'block' : 'none';
    
    document.getElementById('update-status-select').value = defect.status || 'Open';
    document.getElementById('done-photo-group').style.display = (defect.status === 'Done' || document.getElementById('update-status-select').value === 'Done') ? 'block' : 'none';
    
    renderTimeline(defect, document.getElementById('defect-timeline'));
    document.getElementById('detail-modal').style.display = 'block';
};

function renderTimeline(defect, container) {
    if (!container) return;
    let html = `<div style="color: var(--text-muted); padding: 5px 0;"><span style="font-weight: 600;">Reported:</span> ${new Date(defect.timestamp).toLocaleString()}</div>`;
    if (defect.history && defect.history.length > 0) {
        defect.history.forEach(h => {
            html += `<div style="border-left: 2px solid var(--accent-color); padding-left: 10px; margin: 5px 0;"><div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(h.time).toLocaleString()}</div><div style="font-weight: 500;">${h.msg}</div></div>`;
        });
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

document.addEventListener('DOMContentLoaded', async () => {
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session) { window.location.href = 'index.html'; return; }

    const db = await initDB();
    const dashboardContent = document.getElementById('dashboard-content');
    const syncIndicator = document.getElementById('sync-indicator');
    const unsyncedBanner = document.getElementById('unsynced-banner');
    const unsyncedCountEl = document.getElementById('unsynced-count');

    // UI Controls
    const searchInput = document.getElementById('search-input');
    const filterStatus = document.getElementById('filter-status');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewListBtn = document.getElementById('view-list-btn');

    let masterDefectList = [];
    let projectConfig = { syncedDefects: [], unitNumbers: [], stories: [], maps: [] };

    window.showLoader = (text) => {
        document.getElementById('loader-text').textContent = text || 'Loading...';
        document.getElementById('global-loader').style.display = 'flex';
    };
    window.hideLoader = () => document.getElementById('global-loader').style.display = 'none';

    async function checkUnsynced() {
        const pending = await db.getAll('pending_defects');
        if (pending.length > 0) {
            unsyncedBanner.style.display = 'block';
            unsyncedCountEl.textContent = pending.length;
        } else {
            unsyncedBanner.style.display = 'none';
        }
    }

    async function renderDashboard() {
        const cached = localStorage.getItem('project_config');
        if (cached) projectConfig = JSON.parse(cached);
        const pending = await db.getAll('pending_defects');
        masterDefectList = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true })),
            ...pending.map(d => ({ ...d, isSynced: false }))
        ];
        window.allRenderedDefects = {};
        masterDefectList.forEach(d => { window.allRenderedDefects[d.id] = d; });
        applyFilters();
        checkUnsynced();
    }

    function applyFilters() {
        const query = (searchInput.value || '').toLowerCase();
        const status = filterStatus.value;
        const filtered = masterDefectList.filter(d => {
            const matchSearch = (d.unit || '').toLowerCase().includes(query) || (d.description || '').toLowerCase().includes(query);
            const matchStatus = (status === 'all') || (d.status === status);
            return matchSearch && matchStatus;
        });

        if (currentView === 'grid') renderGridView(filtered);
        else renderListView(filtered);
    }

    function renderGridView(filtered) {
        if (filtered.length === 0) { dashboardContent.innerHTML = '<p style="text-align:center;padding:50px;">No matches.</p>'; return; }
        const grouped = groupDefects(filtered);
        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            html += `<div class="unit-section"><h3>${unit}</h3><div class="defect-grid">`;
            html += defects.map(d => {
                const photo = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png'));
                return `
                    <div class="defect-card neu-raised" onclick="window.showDefectDetailById('${d.id}')">
                        <span class="badge ${d.status}">${d.status}</span>
                        ${!d.isSynced ? '<span class="badge pending" style="top:auto;bottom:10px;">Unsynced</span>' : ''}
                        <img src="${photo}" class="defect-card-img" onerror="this.src='assets/floorplan-placeholder.png'">
                        <h4>${d.story}</h4><p class="desc">${d.description}</p>
                    </div>`;
            }).join('');
            html += `</div></div>`;
        }
        dashboardContent.innerHTML = html;
    }

    function renderListView(filtered) {
        if (filtered.length === 0) { dashboardContent.innerHTML = '<p style="text-align:center;padding:50px;">No matches.</p>'; return; }
        const grouped = groupDefects(filtered);
        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            html += `<div class="unit-section neu-raised" style="padding:20px;border-radius:20px;margin-bottom:30px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:15px;"><h3>Unit: ${unit}</h3><button class="primary" onclick="window.exportUnitPDF('${unit}')" style="width:auto;padding:5px 15px;">PDF Report</button></div>`;
            
            const storyGroups = defects.reduce((acc, d) => { if (!acc[d.story]) acc[d.story] = []; acc[d.story].push(d); return acc; }, {});
            for (const [story, sDefects] of Object.entries(storyGroups)) {
                const mapMapping = projectConfig.unitNumbers.find(u => u.number === unit);
                const mapObj = projectConfig.maps.find(m => m.unit === (mapMapping?mapMapping.type:unit) && m.story === story);
                const mapUrl = mapObj ? fixMapUrl(mapObj.mapUrl) : 'assets/floorplan-placeholder.png';
                
                html += `<div style="margin-top:20px;"><h4>Floor: ${story}</h4>
                    <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:20px;">
                        <div style="position:relative;border-radius:10px;overflow:hidden;background:#fff;" class="neu-inset">
                            <img src="${mapUrl}" style="width:100%;display:block;" onerror="this.src='assets/floorplan-placeholder.png'">
                            ${sDefects.map(d => `<div class="pin" style="left:${d.position.x}%;top:${d.position.y}%;background:${d.status==='Done'?'#1a7f37':(d.status==='Onprogress'?'#1877f2':'#d29922')};width:12px;height:12px;border:2px solid #fff;position:absolute;border-radius:50%;transform:translate(-50%,-50%);cursor:pointer;" onclick="window.showDefectDetailById('${d.id}')"></div>`).join('')}
                        </div>
                        <div class="neu-inset" style="padding:10px;border-radius:10px;overflow-x:auto;">
                            <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
                                <thead><tr style="text-align:left;border-bottom:1px solid #ccc;"><th>Status</th><th>Desc</th><th>Action</th></tr></thead>
                                <tbody>${sDefects.map(d => `<tr style="border-bottom:1px solid #eee;"><td>${d.status}</td><td>${d.description}</td><td><button class="primary" style="width:auto;padding:2px 8px;font-size:0.7rem;" onclick="window.showDefectDetailById('${d.id}')">Details</button></td></tr>`).join('')}</tbody>
                            </table>
                        </div>
                    </div></div>`;
            }
            html += `</div>`;
        }
        dashboardContent.innerHTML = html;
    }

    function groupDefects(list) {
        return list.reduce((acc, d) => { const u = d.unit || 'Unknown'; if (!acc[u]) acc[u] = []; acc[u].push(d); return acc; }, {});
    }

    // --- SYNC LOGIC ---
    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) return;
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) { updateSyncUI('online'); return; }

        isSyncing = true;
        updateSyncUI('syncing');
        let success = 0;
        for (let i = 0; i < pending.length; i++) {
            window.showLoader(`Syncing report ${i + 1} of ${pending.length}...`);
            try {
                const res = await authorizedPost('sync_defects', { defect: pending[i] });
                if (res && (await res.json()).status === 'success') {
                    await db.delete('pending_defects', pending[i].id);
                    success++;
                }
            } catch (e) { console.warn(e); }
        }
        isSyncing = false;
        window.hideLoader();
        if (success > 0) await refreshConfig();
        updateSyncUI(navigator.onLine ? 'online' : 'offline');
    }

    function updateSyncUI(status) {
        if (!syncIndicator) return;
        const colors = { syncing: '#1877f2', online: '#1a7f37', offline: '#cf222e' };
        syncIndicator.style.background = colors[status] || '#ccc';
    }

    async function refreshConfig() {
        try {
            const res = await authorizedPost('get_config', {});
            if (res) {
                const result = await res.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    await renderDashboard();
                }
            }
        } catch (e) {}
    }

    // Event Bindings
    searchInput.oninput = applyFilters;
    filterStatus.onchange = applyFilters;
    document.getElementById('reset-filter-btn').onclick = () => { searchInput.value = ''; filterStatus.value = 'all'; applyFilters(); };
    viewGridBtn.onclick = () => { currentView = 'grid'; viewGridBtn.classList.add('success'); viewListBtn.classList.remove('success'); applyFilters(); };
    viewListBtn.onclick = () => { currentView = 'list'; viewListBtn.classList.add('success'); viewGridBtn.classList.remove('success'); applyFilters(); };
    document.getElementById('banner-sync-btn').onclick = syncAllPending;
    document.getElementById('sync-btn').onclick = async () => {
        await syncAllPending();
        if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
    };

    // Standard Actions
    document.getElementById('add-comment-btn').onclick = () => {
        const msg = document.getElementById('new-comment-input').value.trim();
        if (!msg || !currentUpdatingDefect) return;
        if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
        currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Note: ${msg}` });
        document.getElementById('new-comment-input').value = '';
        renderTimeline(currentUpdatingDefect, document.getElementById('defect-timeline'));
    };

    document.getElementById('save-update-btn').onclick = async () => {
        const newStatus = document.getElementById('update-status-select').value;
        if (newStatus === 'Done' && !updatedDonePhotoBase64 && !currentUpdatingDefect.donePhotoUrl) return alert('Photo required for Done.');
        if (newStatus !== currentUpdatingDefect.status) {
            if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
            currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Status: ${newStatus}` });
        }
        const updated = { ...currentUpdatingDefect, status: newStatus, donePhoto: updatedDonePhotoBase64 || currentUpdatingDefect.donePhoto };
        delete updated.isSynced;
        await db.put('pending_defects', updated);
        document.getElementById('detail-modal').style.display = 'none';
        await renderDashboard();
        syncAllPending();
    };

    document.getElementById('update-status-select').onchange = () => {
        document.getElementById('done-photo-group').style.display = (document.getElementById('update-status-select').value === 'Done') ? 'block' : 'none';
    };

    document.getElementById('close-detail-btn').onclick = () => document.getElementById('detail-modal').style.display = 'none';
    document.getElementById('logout-btn').onclick = () => { localStorage.clear(); window.location.href = 'index.html'; };
    document.getElementById('new-report-btn').onclick = () => { window.location.href = 'defect.html'; };

    async function authorizedPost(action, payload) {
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action, auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken }, ...payload })
            });
            if (res.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return null; }
            return res;
        } catch (e) { return null; }
    }

    // Initialize
    if (session.role === 'Admin') document.getElementById('admin-btn').style.display = 'block';
    await renderDashboard();
});
