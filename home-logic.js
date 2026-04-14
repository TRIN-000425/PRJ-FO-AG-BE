let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;
let currentView = 'grid'; // 'grid' or 'list' (Map & Table)

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

// --- DEFECT DETAIL MODAL ---
window.showDefectDetailById = (id) => {
    const defect = window.allRenderedDefects[id];
    if (!defect) return;
    
    currentUpdatingDefect = JSON.parse(JSON.stringify(defect)); // Deep copy
    updatedDonePhotoBase64 = null;
    
    const detailStatusText = document.getElementById('detail-status-text');
    const detailDesc = document.getElementById('detail-desc');
    const detailImg = document.getElementById('detail-img');
    const updateStatusSelect = document.getElementById('update-status-select');
    const donePhotoGroup = document.getElementById('done-photo-group');
    const detailModal = document.getElementById('detail-modal');
    const timelineContainer = document.getElementById('defect-timeline');

    if (detailStatusText) detailStatusText.textContent = defect.status || 'Open';
    if (detailDesc) detailDesc.textContent = defect.description;
    
    const mainPhoto = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : '');
    if (detailImg) {
        detailImg.src = mainPhoto;
        detailImg.style.display = mainPhoto ? 'block' : 'none';
    }
    
    if (updateStatusSelect) updateStatusSelect.value = defect.status || 'Open';
    if (donePhotoGroup) donePhotoGroup.style.display = (updateStatusSelect.value === 'Done') ? 'block' : 'none';
    
    renderTimeline(defect, timelineContainer);
    if (detailModal) detailModal.style.display = 'block';
};

function renderTimeline(defect, container) {
    if (!container) return;
    let html = `<div style="color: var(--text-muted); padding: 5px 0;"><span style="font-weight: 600;">Reported:</span> ${new Date(defect.timestamp).toLocaleString()}</div>`;
    if (defect.history && defect.history.length > 0) {
        defect.history.forEach(h => {
            html += `<div style="border-left: 2px solid var(--accent-color); padding-left: 10px; margin: 5px 0;"><div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(h.time).toLocaleString()}</div><div style="font-weight: 500;">${h.msg}</div></div>`;
        });
    } else {
        html += `<div style="color: var(--text-muted); opacity: 0.5; font-style: italic;">No activity logged yet.</div>`;
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// --- PDF EXPORT ---
window.exportUnitPDF = async (unitNumber) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const defects = Object.values(window.allRenderedDefects).filter(d => d.unit === unitNumber);
    doc.setFontSize(20); doc.text(`Defect Report: Unit ${unitNumber}`, 20, 20);
    doc.setFontSize(10); doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, 28);
    let y = 40;
    defects.forEach((d, index) => {
        if (y > 250) { doc.addPage(); y = 20; }
        doc.setFontSize(12); doc.setTextColor(24, 119, 242); doc.text(`${index + 1}. ${d.description || 'No Description'}`, 20, y);
        doc.setFontSize(10); doc.setTextColor(100); y += 7;
        doc.text(`Status: ${d.status} | Story: ${d.story} | Date: ${new Date(d.timestamp).toLocaleDateString()}`, 20, y);
        if (d.history && d.history.length > 0) { y += 7; doc.setFontSize(9); doc.text(`Latest Note: ${d.history[d.history.length-1].msg}`, 25, y); }
        y += 15;
    });
    doc.save(`Defect_Report_Unit_${unitNumber}.pdf`);
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
    const newCommentInput = document.getElementById('new-comment-input');
    const addCommentBtn = document.getElementById('add-comment-btn');

    // Filter Elements
    const searchInput = document.getElementById('search-input');
    const filterStatus = document.getElementById('filter-status');
    const resetFilterBtn = document.getElementById('reset-filter-btn');
    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewListBtn = document.getElementById('view-list-btn');

    let masterDefectList = [];
    let projectConfig = { syncedDefects: [], unitNumbers: [], stories: [], unitTypes: [], maps: [] };

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

    // --- AUTO-SYNC LOGIC ---
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
        if (successCount > 0) await refreshConfig();
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

    // --- DASHBOARD RENDER & FILTERING ---
    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading lifecycle data...</p></div>';
        const cached = localStorage.getItem('project_config');
        if (cached) projectConfig = JSON.parse(cached);

        const pendingDefects = await db.getAll('pending_defects');
        masterDefectList = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true })),
            ...pendingDefects.map(d => ({ ...d, isSynced: false }))
        ];

        window.allRenderedDefects = {};
        masterDefectList.forEach(d => { window.allRenderedDefects[d.id] = d; });
        applyFilters();
    }

    function applyFilters() {
        const query = (searchInput.value || '').toLowerCase();
        const status = filterStatus.value;
        const filtered = masterDefectList.filter(d => {
            const matchSearch = (d.unit || '').toLowerCase().includes(query) || (d.description || '').toLowerCase().includes(query);
            const matchStatus = (status === 'all') || (d.status === status);
            return matchSearch && matchStatus;
        });

        if (filtered.length === 0) {
            dashboardContent.innerHTML = '<div class="neu-inset" style="text-align: center; padding: 50px; border-radius: 20px;"><p>No matching reports found.</p></div>';
            return;
        }

        const grouped = filtered.reduce((acc, d) => {
            const unit = d.unit || 'Unknown';
            if (!acc[unit]) acc[unit] = [];
            acc[unit].push(d);
            return acc;
        }, {});

        if (currentView === 'grid') renderGridView(grouped);
        else renderListView(grouped);
    }

    function renderGridView(grouped) {
        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            html += `
                <div class="unit-section">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                        <h3 class="unit-header" style="margin: 0;">${unit}</h3>
                        <button class="primary" onclick="window.exportUnitPDF('${unit}')" style="width: auto; padding: 5px 12px; font-size: 0.7rem;">Export PDF</button>
                    </div>
                    <div class="defect-grid">
                        ${defects.map(d => {
                            const photo = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png'));
                            return `
                                <div class="defect-card neu-raised" onclick="window.showDefectDetailById('${d.id}')">
                                    <span class="badge ${d.status || 'Open'}">${d.status || 'Open'}</span>
                                    ${!d.isSynced ? '<span class="badge pending" style="top: auto; bottom: 10px;">Pending</span>' : ''}
                                    <img src="${photo}" class="defect-card-img" onerror="this.src='assets/floorplan-placeholder.png'">
                                    <h4>${d.story || 'N/A'}</h4>
                                    <p class="desc">${d.description || 'No description'}</p>
                                    <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 10px;">
                                        <span style="font-size: 0.7rem; color: var(--text-muted);">${new Date(d.timestamp).toLocaleDateString()}</span>
                                        ${d.history ? `<span style="font-size: 0.7rem; color: var(--accent-color); font-weight: 600;">${d.history.length} updates</span>` : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        dashboardContent.innerHTML = html;
    }

    function renderListView(grouped) {
        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            const storyGroups = defects.reduce((acc, d) => {
                if (!acc[d.story]) acc[d.story] = [];
                acc[d.story].push(d);
                return acc;
            }, {});

            html += `
                <div class="unit-section neu-raised" style="padding: 20px; border-radius: 20px; margin-bottom: 40px; background: var(--bg-color);">
                    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 2px solid var(--border-color); padding-bottom: 10px;">
                        <h3 style="margin: 0; color: var(--accent-color);">Unit: ${unit}</h3>
                        <button class="primary" onclick="window.exportUnitPDF('${unit}')" style="width: auto; padding: 8px 15px; font-size: 0.8rem;">Download PDF Report</button>
                    </div>
            `;

            for (const [story, storyDefects] of Object.entries(storyGroups)) {
                const mapping = projectConfig.unitNumbers.find(u => u.number === unit);
                const unitType = mapping ? mapping.type : unit;
                const mapObj = (projectConfig.maps || []).find(m => m.unit === unitType && m.story === story);
                const mapUrl = mapObj ? fixMapUrl(mapObj.mapUrl) : `assets/${unitType}_${story}.png`;

                html += `
                    <div style="margin-bottom: 30px;">
                        <h4 style="margin-bottom: 15px; color: var(--text-muted); text-transform: uppercase; font-size: 0.8rem; letter-spacing: 1px;">Floor: ${story}</h4>
                        <div style="display: grid; grid-template-columns: minmax(300px, 1fr) 1.5fr; gap: 20px; align-items: start;">
                            <div class="neu-inset" style="position: relative; border-radius: 15px; overflow: hidden; background: #fff;">
                                <img src="${mapUrl}" style="width: 100%; display: block;" onerror="this.src='assets/floorplan-placeholder.png'">
                                ${storyDefects.map(d => `
                                    <div class="pin" style="left: ${d.position.x}%; top: ${d.position.y}%; background: ${d.status==='Done'?'#1a7f37':(d.status==='Onprogress'?'#1877f2':'#d29922')}; width: 12px; height: 12px; border: 2px solid #fff; position: absolute; border-radius: 50%; transform: translate(-50%, -50%); cursor: pointer; z-index: 5;" onclick="window.showDefectDetailById('${d.id}')" title="${d.description}"></div>
                                `).join('')}
                            </div>
                            <div class="neu-inset" style="padding: 10px; border-radius: 15px; overflow-x: auto;">
                                <table style="width: 100%; border-collapse: collapse; font-size: 0.8rem;">
                                    <thead>
                                        <tr style="border-bottom: 1px solid var(--border-color); text-align: left; color: var(--text-muted);">
                                            <th style="padding: 10px;">Status</th>
                                            <th style="padding: 10px;">Description</th>
                                            <th style="padding: 10px;">Date</th>
                                            <th style="padding: 10px;">Action</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${storyDefects.map(d => `
                                            <tr style="border-bottom: 1px solid rgba(0,0,0,0.05);">
                                                <td style="padding: 10px;"><span class="badge ${d.status || 'Open'}" style="position: static; font-size: 0.6rem; padding: 3px 8px;">${d.status}</span></td>
                                                <td style="padding: 10px; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${d.description}</td>
                                                <td style="padding: 10px;">${new Date(d.timestamp).toLocaleDateString()}</td>
                                                <td style="padding: 10px;"><button class="primary" style="width: auto; padding: 4px 8px; font-size: 0.7rem;" onclick="window.showDefectDetailById('${d.id}')">Details</button></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </div>
                `;
            }
            html += `</div>`;
        }
        dashboardContent.innerHTML = html;
    }

    searchInput.oninput = applyFilters;
    filterStatus.onchange = applyFilters;
    resetFilterBtn.onclick = () => { searchInput.value = ''; filterStatus.value = 'all'; applyFilters(); };
    viewGridBtn.onclick = () => { currentView = 'grid'; viewGridBtn.classList.add('success'); viewListBtn.classList.remove('success'); applyFilters(); };
    viewListBtn.onclick = () => { currentView = 'list'; viewListBtn.classList.add('success'); viewGridBtn.classList.remove('success'); applyFilters(); };
    viewGridBtn.classList.add('success');

    // --- CONFIG & ADMIN ACTIONS ---
    async function loadAdminSelectors() {
        const cached = localStorage.getItem('project_config');
        if (!cached) return;
        try {
            const config = JSON.parse(cached);
            projectConfig = config;
            const unitSelect = document.getElementById('admin-unit-select');
            const storySelect = document.getElementById('admin-story-select');
            const newUnitTypeSelect = document.getElementById('new-unit-number-type');
            if (config.unitTypes) {
                const options = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
                if (unitSelect) unitSelect.innerHTML = options;
                if (newUnitTypeSelect) newUnitTypeSelect.innerHTML = '<option value="">Select Type...</option>' + options;
            }
            if (config.stories && storySelect) storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
            const tbody = document.getElementById('admin-data-table-body');
            if (tbody && config.unitNumbers) {
                tbody.innerHTML = config.unitNumbers.map(un => {
                    const floors = (config.maps || []).filter(m => m.unit === un.type).map(m => m.story).join(', ') || 'No maps';
                    return `<tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 10px;">${un.number}</td><td style="padding: 10px;">${un.type}</td><td style="padding: 10px;">${floors}</td></tr>`;
                }).join('') || '<tr><td colspan="3" style="padding: 20px; text-align: center;">No units</td></tr>';
            }
        } catch (e) { console.error(e); }
    }

    document.getElementById('refresh-admin-table-btn').onclick = async () => {
        showLoader('Refreshing configuration...');
        try { await refreshConfig(); } catch (e) { alert(e); } finally { hideLoader(); }
    };

    document.getElementById('add-unit-btn').onclick = async () => {
        const val = document.getElementById('new-unit-val').value.trim();
        const label = document.getElementById('new-unit-label').value.trim();
        if (!val || !label) return alert('Enter values');
        showLoader('Adding unit type...');
        try {
            const res = await authorizedPost('add_unit', { value: val, label: label });
            if (res && (await res.json()).status === 'success') { await refreshConfig(); alert('Added!'); }
        } catch (e) { alert(e); } finally { hideLoader(); }
    };

    document.getElementById('add-single-unit-btn').onclick = async () => {
        const num = document.getElementById('new-unit-number-val').value.trim();
        const typ = document.getElementById('new-unit-number-type').value;
        if (!num || !typ) return alert('Enter values');
        showLoader('Adding unit number...');
        try {
            const res = await authorizedPost('add_unit_numbers', { units: [{ number: num, type: typ }] });
            if (res && (await res.json()).status === 'success') { await refreshConfig(); alert('Added!'); }
        } catch (e) { alert(e); } finally { hideLoader(); }
    };

    document.getElementById('upload-map-btn').onclick = async () => {
        const file = document.getElementById('map-upload-input').files[0];
        if (!file) return alert('Select file');
        showLoader('Uploading map...');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const res = await authorizedPost('upload_map', { unit: document.getElementById('admin-unit-select').value, story: document.getElementById('admin-story-select').value, imageBlob: e.target.result });
                if (res && (await res.json()).status === 'success') { await refreshConfig(); alert('Uploaded!'); }
            } catch (err) { alert(err); } finally { hideLoader(); }
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('add-map-url-btn').onclick = async () => {
        const url = document.getElementById('map-url-input').value.trim();
        if (!url) return alert('Enter URL');
        showLoader('Saving Map URL...');
        try {
            const res = await authorizedPost('add_map_url', { unit: document.getElementById('admin-unit-select').value, story: document.getElementById('admin-story-select').value, mapUrl: url });
            if (res && (await res.json()).status === 'success') { await refreshConfig(); alert('Saved!'); }
        } catch (e) { alert(e); } finally { hideLoader(); }
    };

    async function refreshConfig() {
        try {
            const res = await authorizedPost('get_config', {});
            if (res) {
                const result = await res.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    projectConfig = result.config;
                    await loadAdminSelectors();
                    await renderDashboard();
                    warmCache(result.config);
                }
            }
        } catch (e) {}
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

    // --- COMMENT & UPDATE LOGIC ---
    addCommentBtn.onclick = () => {
        const msg = newCommentInput.value.trim();
        if (!msg || !currentUpdatingDefect) return;
        if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
        currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Note: ${msg}` });
        newCommentInput.value = '';
        renderTimeline(currentUpdatingDefect, document.getElementById('defect-timeline'));
    };

    saveUpdateBtn.onclick = async () => {
        const newStatus = updateStatusSelect.value;
        if (newStatus === 'Done' && !updatedDonePhotoBase64 && !currentUpdatingDefect.donePhotoUrl) return alert('Completion photo is required.');
        if (newStatus !== currentUpdatingDefect.status) {
            if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
            currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Status changed to ${newStatus}` });
        }
        const updated = { ...currentUpdatingDefect, status: newStatus, donePhoto: updatedDonePhotoBase64 || currentUpdatingDefect.donePhoto };
        delete updated.isSynced;
        await db.put('pending_defects', updated);
        detailModal.style.display = 'none';
        await renderDashboard();
        syncAllPending();
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

    closeDetailBtn.onclick = () => detailModal.style.display = 'none';
    logoutBtn.onclick = () => { localStorage.clear(); window.location.href = 'index.html'; };
    newReportBtn.onclick = () => { window.location.href = 'defect.html'; };
    
    async function authorizedPost(action, payload) {
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', 
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({ action, auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken }, ...payload })
            });
            if (res.status === 401) { localStorage.clear(); window.location.href = 'index.html'; return null; }
            return res;
        } catch (err) { return null; }
    }

    await loadAdminSelectors();
    await renderDashboard();
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
