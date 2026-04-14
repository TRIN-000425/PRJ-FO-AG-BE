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
    window.showLoader(`Preparing PDF Report for ${unitNumber}...`);
    doc.setFontSize(22); doc.setTextColor(24, 119, 242); doc.text(`Punch List: Unit ${unitNumber}`, 20, 20);
    doc.setFontSize(10); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 28);
    doc.line(20, 32, 190, 32);
    let y = 45;
    for (let i = 0; i < defects.length; i++) {
        const d = defects[i];
        if (y > 220) { doc.addPage(); y = 20; }
        doc.setFontSize(14); doc.setTextColor(0); doc.text(`${i + 1}. ${d.description || 'No Description'}`, 20, y);
        y += 7; doc.setFontSize(10); doc.setTextColor(100); doc.text(`Status: ${d.status} | Floor: ${d.story} | Date: ${new Date(d.timestamp).toLocaleDateString()}`, 20, y);
        const photoUrl = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : ''));
        if (photoUrl) {
            try {
                const imgData = await getBase64FromUrl(photoUrl);
                y += 5; doc.addImage(imgData, 'JPEG', 20, y, 50, 35);
                y += 40;
            } catch (e) { y += 10; }
        } else { y += 10; }
        if (d.history && d.history.length > 0) {
            doc.setFontSize(9); doc.setTextColor(120); doc.text(`Latest Update: ${d.history[d.history.length-1].msg}`, 25, y);
            y += 8;
        }
        y += 5;
    }
    doc.save(`Report_${unitNumber}.pdf`);
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

// --- VERSION CHECKER ---
async function checkAppVersion() {
    const onlineTag = document.getElementById('online-version-tag');
    const localTag = document.getElementById('local-version-tag');
    const version = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : (window.APP_VERSION || "1.7.4");
    if (localTag) localTag.textContent = 'v' + version;

    if (!navigator.onLine) return;

    try {
        const res = await fetch('version.json?t=' + Date.now());
        const data = await res.json();
        if (data.version) {
            if (data.version !== version) {
                if (onlineTag) {
                    onlineTag.textContent = 'Latest: v' + data.version;
                    onlineTag.style.display = 'inline-block';
                    onlineTag.classList.add('version-outdated');
                }
                const banner = document.getElementById('update-banner');
                if (banner) banner.style.display = 'block';
            } else {
                if (onlineTag) onlineTag.style.display = 'none';
            }
        }
    } catch (e) {}
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
    document.getElementById('done-photo-group').style.display = (document.getElementById('update-status-select').value === 'Done') ? 'block' : 'none';
    renderTimeline(defect, document.getElementById('defect-timeline'));
    document.getElementById('detail-modal').style.display = 'block';
};

// --- PIN HIGHLIGHT HELPERS ---
window.highlightPin = (id, active) => {
    const pin = document.getElementById(`pin-${id}`);
    if (pin) {
        if (active) pin.classList.add('pin-highlight');
        else pin.classList.remove('pin-highlight');
    }
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
    console.log("Dashboard initializing...");

    try {
        window.showLoader('Initializing Dashboard...');
        
        const session = JSON.parse(localStorage.getItem('user_session'));
        if (!session) { window.location.href = 'index.html'; return; }

        const db = await initDB();
        const dashboardContent = document.getElementById('dashboard-content');
        const unsyncedBanner = document.getElementById('unsynced-banner');
        const unsyncedCountEl = document.getElementById('unsynced-count');

        const searchInput = document.getElementById('search-input');
        const filterStatus = document.getElementById('filter-status');
        const viewGridBtn = document.getElementById('view-grid-btn');
        const viewListBtn = document.getElementById('view-list-btn');

        const newReportLabel = document.getElementById('new-report-label');
        const syncLabel = document.getElementById('sync-label');
        const adminLabel = document.getElementById('admin-label');
        const logoutLabel = document.getElementById('logout-label');

        let masterDefectList = [];
        let projectConfig = { syncedDefects: [], unitNumbers: [], stories: [], unitTypes: [], maps: [] };

        window.showLoader = (text) => {
            const loaderText = document.getElementById('loader-text');
            if (loaderText) loaderText.textContent = text || 'Loading...';
            document.getElementById('global-loader').style.display = 'flex';
        };
        window.hideLoader = () => {
            const loader = document.getElementById('global-loader');
            if (loader) loader.style.display = 'none';
        };

        async function checkUnsynced() {
            const pending = await db.getAll('pending_defects');
            if (pending.length > 0) {
                if (unsyncedBanner) unsyncedBanner.style.display = 'block';
                if (unsyncedCountEl) unsyncedCountEl.textContent = pending.length;
            } else {
                if (unsyncedBanner) unsyncedBanner.style.display = 'none';
            }
        }

        async function renderDashboard(useLoader = false) {
            if (useLoader) window.showLoader('Updating View...');
            try {
                const cached = localStorage.getItem('project_config');
                if (cached) projectConfig = JSON.parse(cached);
                const pending = await db.getAll('pending_defects');
                masterDefectList = [
                    ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true, history: d.history || [] })),
                    ...pending.map(d => ({ ...d, isSynced: false, history: d.history || [] }))
                ];
                window.allRenderedDefects = {};
                masterDefectList.forEach(d => { window.allRenderedDefects[d.id] = d; });
                applyFilters();
                await checkUnsynced();
            } catch (e) {
                console.error("Dashboard render error:", e);
                if (dashboardContent) dashboardContent.innerHTML = `<div class="neu-raised" style="padding:30px;color:red;text-align:center;">Error loading dashboard: ${e.message}</div>`;
            } finally {
                if (useLoader) window.hideLoader();
            }
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
            if (!dashboardContent) return;
            if (filtered.length === 0) { 
                dashboardContent.innerHTML = '<div style="text-align:center;padding:50px;"><p class="neu-inset" style="padding:20px;display:inline-block;">No defects found matching your criteria.</p></div>'; 
                return; 
            }
            const grouped = groupDefects(filtered);
            let html = '';
            for (const [unit, defects] of Object.entries(grouped)) {
                html += `<div class="unit-section"><h3 class="unit-header">${unit}</h3><div class="defect-grid">`;
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
            if (!dashboardContent) return;
            if (filtered.length === 0) { 
                dashboardContent.innerHTML = '<div style="text-align:center;padding:50px;"><p class="neu-inset" style="padding:20px;display:inline-block;">No defects found matching your criteria.</p></div>'; 
                return; 
            }
            const grouped = groupDefects(filtered);
            let html = '';
            for (const [unit, defects] of Object.entries(grouped)) {
                html += `<div class="unit-section neu-raised" style="padding:20px;border-radius:20px;margin-bottom:30px;">
                    <div style="display:flex;justify-content:space-between;margin-bottom:15px;align-items:center;"><h3>Unit: ${unit}</h3><button class="primary" onclick="window.exportUnitPDF('${unit}')" style="width:auto;padding:5px 15px;font-size:0.75rem;">PDF Report</button></div>`;
                const storyGroups = defects.reduce((acc, d) => { if (!acc[d.story]) acc[d.story] = []; acc[d.story].push(d); return acc; }, {});
                for (const [story, sDefects] of Object.entries(storyGroups)) {
                    const mapMapping = projectConfig.unitNumbers.find(u => u.number === unit);
                    const mapObj = projectConfig.maps.find(m => m.unit === (mapMapping?mapMapping.type:unit) && m.story === story);
                    const mapUrl = mapObj ? fixMapUrl(mapObj.mapUrl) : 'assets/floorplan-placeholder.png';
                    html += `<div style="margin-top:20px;"><h4>Floor: ${story}</h4>
                        <div style="display:grid;grid-template-columns:1fr 1.5fr;gap:20px;">
                            <div style="position:relative;border-radius:10px;overflow:hidden;background:#fff;" class="neu-inset">
                                <img src="${mapUrl}" style="width:100%;display:block;" onerror="this.src='assets/floorplan-placeholder.png'">
                                ${sDefects.map(d => `<div id="pin-${d.id}" class="pin" style="left:${d.position.x}%;top:${d.position.y}%;background:${d.status==='Done'?'#1a7f37':(d.status==='Onprogress'?'#1877f2':'#d29922')};width:12px;height:12px;border:2px solid #fff;position:absolute;border-radius:50%;transform:translate(-50%,-50%);cursor:pointer;" onclick="window.showDefectDetailById('${d.id}')"></div>`).join('')}
                            </div>
                            <div class="neu-inset" style="padding:10px;border-radius:10px;overflow-x:auto;">
                                <table style="width:100%;font-size:0.8rem;border-collapse:collapse;">
                                    <thead><tr style="text-align:left;border-bottom:1px solid #ccc;"><th style="padding:10px;">Status</th><th style="padding:10px;">Desc</th><th style="padding:10px;">Action</th></tr></thead>
                                    <tbody>${sDefects.map(d => `
                                        <tr style="border-bottom:1px solid #eee; transition: background 0.2s;" onmouseenter="window.highlightPin('${d.id}', true)" onmouseleave="window.highlightPin('${d.id}', false)">
                                            <td style="padding:10px;"><span class="badge ${d.status}" style="position:static; padding:2px 8px; font-size:0.6rem;">${d.status}</span></td>
                                            <td style="padding:10px;">${d.description}</td>
                                            <td style="padding:10px;"><button class="primary" style="width:auto;padding:2px 8px;font-size:0.7rem;" onclick="window.showDefectDetailById('${d.id}')">Details</button></td>
                                        </tr>`).join('')}
                                    </tbody>
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

        // --- SYNC & REFRESH ---
        async function syncAllPending(silent = false) {
            if (isSyncing || !navigator.onLine) { updateSyncUI(navigator.onLine ? 'online' : 'offline'); return; }
            const pending = await db.getAll('pending_defects');
            if (pending.length === 0) { updateSyncUI('online'); return; }
            isSyncing = true; updateSyncUI('syncing');
            for (let i = 0; i < pending.length; i++) {
                if (!silent) window.showLoader(`Uploading staged report ${i + 1} of ${pending.length}...`);
                try {
                    const res = await authorizedPost('sync_defects', { defect: pending[i] });
                    if (res && (await res.json()).status === 'success') await db.delete('pending_defects', pending[i].id);
                } catch (e) {}
            }
            isSyncing = false;
            await refreshConfig(silent);
            updateSyncUI(navigator.onLine ? 'online' : 'offline');
            await checkUnsynced();
        }

        async function refreshConfig(silent = true) {
            if (!navigator.onLine) return;
            if (!silent) window.showLoader('Syncing with Cloud...');
            try {
                const res = await authorizedPost('get_config', {});
                if (res) {
                    const result = await res.json();
                    if (result.status === 'success') {
                        localStorage.setItem('project_config', JSON.stringify(result.config));
                        projectConfig = result.config;
                        await loadAdminSelectors();
                        await renderDashboard(false);
                    }
                }
            } catch (e) {}
            if (!silent) window.hideLoader();
        }

        function updateSyncUI(status) {
            const container = document.getElementById('connection-status');
            const iconEl = document.getElementById('status-icon');
            const textEl = document.getElementById('status-text');
            if (!container || !iconEl || !textEl) return;

            const onlineIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.55a11 11 0 0 1 14.08 0"></path><path d="M1.42 9a16 16 0 0 1 21.16 0"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`;
            const offlineIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="1" y1="1" x2="23" y2="23"></line><path d="M16.72 11.06A10.94 10.94 0 0 1 19 12.55"></path><path d="M5 12.55a10.94 10.94 0 0 1 5.17-2.39"></path><path d="M10.71 5.05A16 16 0 0 1 22.58 9"></path><path d="M1.42 9a15.91 15.91 0 0 1 4.7-2.88"></path><path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path><line x1="12" y1="20" x2="12.01" y2="20"></line></svg>`;

            container.className = 'status-container';
            if (status === 'syncing') {
                container.classList.add('status-syncing');
                textEl.textContent = 'Syncing...';
                iconEl.innerHTML = onlineIcon;
                container.style.animation = 'pulse 1.5s infinite';
            } else if (status === 'online') {
                container.classList.add('status-online');
                textEl.textContent = 'Online';
                iconEl.innerHTML = onlineIcon;
                container.style.animation = 'none';
            } else {
                container.classList.add('status-offline');
                textEl.textContent = 'Offline';
                iconEl.innerHTML = offlineIcon;
                container.style.animation = 'none';
            }
        }

        searchInput.oninput = applyFilters;
        filterStatus.onchange = applyFilters;
        document.getElementById('reset-filter-btn').onclick = () => { searchInput.value = ''; filterStatus.value = 'all'; applyFilters(); };
        viewGridBtn.onclick = () => { currentView = 'grid'; viewGridBtn.classList.add('success'); viewListBtn.classList.remove('success'); applyFilters(); };
        viewListBtn.onclick = () => { currentView = 'list'; viewListBtn.classList.add('success'); viewGridBtn.classList.remove('success'); applyFilters(); };
        
        document.getElementById('banner-sync-btn').onclick = async () => {
            window.showLoader('Uploading staged data...');
            await syncAllPending(false);
            window.hideLoader();
        };

        document.getElementById('sync-btn').onclick = async () => {
            showLoader('Full Synchronization in Progress...');
            await syncAllPending(false);
            await refreshConfig(false);
            await checkAppVersion();
            if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
            hideLoader();
        };

        document.getElementById('refresh-admin-table-btn').onclick = () => refreshConfig(false);
        document.getElementById('force-purge-btn').onclick = async () => {
            if (confirm('Force purge local cache and re-download?')) {
                window.showLoader('Clearing Cache...');
                localStorage.removeItem('project_config');
                await refreshConfig(false);
            }
        };

        window.addEventListener('online', () => { syncAllPending(true); refreshConfig(true); checkAppVersion(); });
        setInterval(syncAllPending, 15000);
        setInterval(checkAppVersion, 300000);

        document.getElementById('add-comment-btn').onclick = async () => {
            const msg = document.getElementById('new-comment-input').value.trim();
            if (!msg || !currentUpdatingDefect) return;
            window.showLoader('Adding note...');
            if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
            currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Note: ${msg}` });
            document.getElementById('new-comment-input').value = '';
            const updated = { ...currentUpdatingDefect };
            delete updated.isSynced;
            await db.put('pending_defects', updated);
            renderTimeline(currentUpdatingDefect, document.getElementById('defect-timeline'));
            syncAllPending(true);
            setTimeout(window.hideLoader, 300);
        };

        document.getElementById('save-update-btn').onclick = async () => {
            const newStatus = document.getElementById('update-status-select').value;
            if (newStatus === 'Done' && !updatedDonePhotoBase64 && !currentUpdatingDefect.donePhotoUrl) return alert('Completion photo is required.');
            window.showLoader('Updating Status...');
            if (newStatus !== currentUpdatingDefect.status) {
                if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
                currentUpdatingDefect.history.push({ time: new Date().toISOString(), msg: `Status: ${newStatus}` });
            }
            const updated = { ...currentUpdatingDefect, status: newStatus, donePhoto: updatedDonePhotoBase64 || currentUpdatingDefect.donePhoto };
            delete updated.isSynced;
            await db.put('pending_defects', updated);
            document.getElementById('detail-modal').style.display = 'none';
            await renderDashboard(false);
            syncAllPending(true);
            setTimeout(window.hideLoader, 500);
        };

        document.getElementById('update-status-select').onchange = () => {
            document.getElementById('done-photo-group').style.display = (document.getElementById('update-status-select').value === 'Done') ? 'block' : 'none';
        };

        document.getElementById('close-detail-btn').onclick = () => document.getElementById('detail-modal').style.display = 'none';
        document.getElementById('logout-btn').onclick = () => { 
            window.showLoader('Signing out...');
            localStorage.clear(); 
            setTimeout(() => { window.location.href = 'index.html'; }, 500);
        };
        document.getElementById('new-report-btn').onclick = () => { 
            window.showLoader('Opening Report View...');
            setTimeout(() => { window.location.href = 'defect.html'; }, 300);
        };

        async function loadAdminSelectors() {
            const cached = localStorage.getItem('project_config');
            if (!cached) return;
            try {
                const config = JSON.parse(cached);
                const unitSelect = document.getElementById('admin-unit-select');
                const storySelect = document.getElementById('admin-story-select');
                const newUnitTypeSelect = document.getElementById('new-unit-number-type');
                if (config.unitTypes) {
                    const opts = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
                    if (unitSelect) unitSelect.innerHTML = opts;
                    if (newUnitTypeSelect) newUnitTypeSelect.innerHTML = '<option value="">Select Type...</option>' + opts;
                }
                if (config.stories && storySelect) storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
                const tbody = document.getElementById('admin-data-table-body');
                if (tbody && config.unitNumbers) {
                    tbody.innerHTML = config.unitNumbers.map(un => {
                        const floors = (config.maps || []).filter(m => m.unit === un.type).map(m => m.story).join(', ') || 'No maps';
                        return `<tr style="border-bottom: 1px solid var(--border-color);"><td style="padding: 10px;">${un.number}</td><td style="padding: 10px;">${un.type}</td><td style="padding: 10px;">${floors}</td></tr>`;
                    }).join('') || '<tr><td colspan="3" style="padding: 20px; text-align: center;">No units</td></tr>';
                }
            } catch (e) {}
        }

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

        if (session.role === 'Admin' && adminLabel) adminLabel.style.display = 'flex';

        newReportLabel.onclick = () => {
            document.getElementById('new-report-radio').checked = true;
            window.showLoader('Opening Report View...');
            setTimeout(() => { window.location.href = 'defect.html'; }, 300);
        };

        syncLabel.onclick = async () => {
            document.getElementById('sync-radio').checked = true;
            showLoader('Full Synchronization in Progress...');
            await syncAllPending(false);
            await refreshConfig(false);
            await checkAppVersion();
            if ('serviceWorker' in navigator) { const reg = await navigator.serviceWorker.getRegistration(); if (reg) await reg.update(); }
            hideLoader();
        };

        logoutLabel.onclick = () => {
            document.getElementById('logout-radio').checked = true;
            window.showLoader('Signing out...');
            localStorage.clear(); 
            setTimeout(() => { window.location.href = 'index.html'; }, 500);
        };

        if (adminLabel) {
            adminLabel.onclick = () => {
                document.getElementById('admin-radio').checked = true;
                // Existing logic for admin button if any, or just visual feedback
            };
        }

        // STARTUP FLOW:        // 1. Show existing cache immediately
        try {
            await renderDashboard(false);
            await loadAdminSelectors();
            await checkAppVersion();
        } catch (e) { console.error("Initial load sequence error:", e); }
        
        // 2. Perform Sync & Refresh
        if (navigator.onLine) {
            try {
                const pending = await db.getAll('pending_defects');
                if (pending.length > 0) await syncAllPending(true);
                await refreshConfig(true);
            } catch (e) { console.error("Cloud sync/refresh error:", e); }
        }
        
        setTimeout(window.hideLoader, 800);
        console.log("Dashboard initialization complete.");

    } catch (err) {
        console.error("Critical Dashboard Initialization Failure:", err);
        window.hideLoader();
        const content = document.getElementById('dashboard-content');
        if (content) content.innerHTML = `<div class="neu-raised" style="padding:30px;color:red;text-align:center;">Critical Error: ${err.message}<br><button onclick="window.location.reload()" class="primary" style="width:auto;margin-top:20px;">Retry</button></div>`;
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
