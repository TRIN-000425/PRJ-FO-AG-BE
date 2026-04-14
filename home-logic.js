let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;
let currentView = 'grid';
let currentStatusFilter = 'all';

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
        const idMatch = trimmed.match(/\/d\/([^/?]+)/) || trimmed.match(/id=([^&?]+)/);
        if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1600`;
    }
    return trimmed;
}

// --- PDF EXPORT ---
window.exportUnitPDF = async (unitNumber) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const defects = Object.values(window.allRenderedDefects).filter(d => d.unit === unitNumber);
    window.showLoader(`Preparing PDF...`);
    doc.setFontSize(20); doc.setTextColor(26, 115, 232); doc.text(`Punch List: Unit ${unitNumber}`, 20, 20);
    doc.setFontSize(10); doc.setTextColor(100); doc.text(`Generated: ${new Date().toLocaleString()}`, 20, 28);
    let y = 45;
    for (const d of defects) {
        if (y > 220) { doc.addPage(); y = 20; }
        doc.setFontSize(14); doc.setTextColor(0); doc.text(`${d.description || 'No Description'}`, 20, y);
        y += 7; doc.setFontSize(10); doc.setTextColor(100); doc.text(`Status: ${d.status} | Floor: ${d.story}`, 20, y);
        const photoUrl = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : ''));
        if (photoUrl) {
            try {
                const imgData = await getBase64FromUrl(photoUrl);
                y += 5; doc.addImage(imgData, 'JPEG', 20, y, 50, 35);
                y += 40;
            } catch (e) { y += 10; }
        } else { y += 10; }
        y += 5;
    }
    doc.save(`Report_${unitNumber}.pdf`);
    window.hideLoader();
};

async function getBase64FromUrl(url) {
    if (url.startsWith('data:')) return url;
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

// --- VERSION CHECKER ---
async function checkAppVersion() {
    const localTag = document.getElementById('local-version-tag');
    const version = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : (window.APP_VERSION || "1.7.4");
    if (localTag) localTag.textContent = 'v' + version;
    if (!navigator.onLine) return;
    try {
        const res = await fetch('version.json?t=' + Date.now());
        const data = await res.json();
        if (data.version && data.version !== version) {
            const banner = document.getElementById('update-banner');
            if (banner) banner.style.display = 'flex';
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
    document.getElementById('detail-status-text').className = `badge ${defect.status || 'Open'}`;
    document.getElementById('detail-desc').textContent = defect.description;
    
    const img = document.getElementById('detail-img');
    const photoUrl = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : 'assets/floorplan-placeholder.png');
    img.src = photoUrl;
    
    document.getElementById('update-status-select').value = defect.status || 'Open';
    document.getElementById('done-photo-group').style.display = (defect.status === 'Done') ? 'block' : 'none';
    
    renderTimeline(defect, document.getElementById('defect-timeline'));
    document.getElementById('detail-modal').style.display = 'flex';
};

function renderTimeline(defect, container) {
    if (!container) return;
    let html = `<div style="margin-bottom: 8px;"><strong>Reported:</strong> ${new Date(defect.timestamp).toLocaleString()}</div>`;
    if (defect.history && defect.history.length > 0) {
        defect.history.forEach(h => {
            html += `<div style="margin-top: 4px; padding-top: 4px; border-top: 1px solid #ddd;">
                <span style="font-size: 0.75rem; color: #666;">${new Date(h.time).toLocaleString()}</span><br>${h.msg}
            </div>`;
        });
    }
    container.innerHTML = html;
}

window.showLoader = (text) => {
    const loaderText = document.getElementById('loader-text');
    if (loaderText) loaderText.textContent = text || 'Loading...';
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'flex';
};
window.hideLoader = () => {
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none';
};

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Dashboard initializing...");

    // --- NAV BINDING ---
    document.getElementById('new-report-label').onclick = (e) => {
        e.preventDefault();
        window.showLoader('Opening Report View...');
        setTimeout(() => { window.location.href = 'defect.html'; }, 200);
    };

    document.getElementById('logout-label').onclick = (e) => {
        e.preventDefault();
        if (confirm('Sign out?')) {
            localStorage.clear(); 
            window.location.href = 'index.html';
        }
    };

    document.getElementById('sync-label').onclick = async (e) => {
        e.preventDefault();
        window.showLoader('Full Synchronization...');
        await syncAllPending(false);
        await refreshConfig(false);
        window.hideLoader();
    };

    // --- FILTERS ---
    const filterPills = document.querySelectorAll('#status-filter-pills .pill');
    filterPills.forEach(pill => {
        pill.onclick = () => {
            filterPills.forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentStatusFilter = pill.dataset.status;
            applyFilters();
        };
    });

    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.oninput = applyFilters;

    const viewGridBtn = document.getElementById('view-grid-btn');
    const viewListBtn = document.getElementById('view-list-btn');
    
    if (viewGridBtn) viewGridBtn.onclick = () => {
        currentView = 'grid';
        viewGridBtn.className = 'primary';
        viewListBtn.className = 'outline';
        applyFilters();
    };
    if (viewListBtn) viewListBtn.onclick = () => {
        currentView = 'list';
        viewListBtn.className = 'primary';
        viewGridBtn.className = 'outline';
        applyFilters();
    };

    try {
        const session = JSON.parse(localStorage.getItem('user_session'));
        if (!session) { window.location.href = 'index.html'; return; }

        const db = await initDB();
        const dashboardContent = document.getElementById('dashboard-content');
        let masterDefectList = [];
        let projectConfig = { syncedDefects: [], unitNumbers: [], stories: [], unitTypes: [], maps: [] };

        async function syncAllPending(silent = false) {
            if (isSyncing || !navigator.onLine) return;
            const pending = await db.getAll('pending_defects');
            if (pending.length === 0) return;
            isSyncing = true;
            for (const d of pending) {
                try {
                    const res = await authorizedPost('sync_defects', { defect: d });
                    if (res && (await res.json()).status === 'success') await db.delete('pending_defects', d.id);
                } catch (e) {}
            }
            isSyncing = false;
            await refreshConfig(silent);
        }

        async function refreshConfig(silent = true) {
            if (!navigator.onLine) { await renderDashboard(false); return; }
            try {
                const res = await authorizedPost('get_config', {});
                if (res) {
                    const result = await res.json();
                    if (result.status === 'success') {
                        localStorage.setItem('project_config', JSON.stringify(result.config));
                        projectConfig = result.config;
                        await renderDashboard(false);
                    }
                }
            } catch (e) { await renderDashboard(false); }
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
            
            const count = pending.length;
            const banner = document.getElementById('unsynced-banner');
            if (banner) banner.style.display = count > 0 ? 'block' : 'none';
            if (document.getElementById('unsynced-count')) document.getElementById('unsynced-count').textContent = count;
        }

        function applyFilters() {
            const query = (searchInput.value || '').toLowerCase();
            const filtered = masterDefectList.filter(d => {
                const matchSearch = (d.unit || '').toLowerCase().includes(query) || (d.description || '').toLowerCase().includes(query);
                const matchStatus = (currentStatusFilter === 'all') || (d.status === currentStatusFilter);
                return matchSearch && matchStatus;
            });
            if (currentView === 'grid') renderGridView(filtered);
            else renderListView(filtered);
        }

        function renderGridView(filtered) {
            if (!dashboardContent) return;
            if (filtered.length === 0) { dashboardContent.innerHTML = '<p style="text-align:center; padding:40px; color:#666;">No defects found.</p>'; return; }
            
            let html = '<div style="display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;">';
            html += filtered.map(d => {
                const photo = d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png');
                return `<div class="card defect-card" onclick="window.showDefectDetailById('${d.id}')">
                    <img src="${photo}" class="defect-card-img" style="height: 120px;">
                    <div class="defect-card-content">
                        <div style="display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;">
                            <span style="font-weight:600; font-size:0.875rem;">${d.unit}</span>
                            <span class="badge ${d.status}" style="font-size:0.65rem; padding:2px 6px;">${d.status}</span>
                        </div>
                        <p style="font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${d.description}</p>
                    </div>
                </div>`;
            }).join('');
            html += '</div>';
            dashboardContent.innerHTML = html;
        }

        function renderListView(filtered) {
            if (!dashboardContent) return;
            let html = filtered.map(d => `<div class="card" onclick="window.showDefectDetailById('${d.id}')" style="display:flex; align-items:center; gap:12px; padding:12px;">
                <img src="${d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png')}" style="width:60px; height:60px; border-radius:8px; object-fit:cover;">
                <div style="flex:1;">
                    <div style="font-weight:600;">${d.unit} - ${d.story}</div>
                    <p style="font-size:0.875rem; color:#666;">${d.description}</p>
                </div>
                <span class="badge ${d.status}">${d.status}</span>
            </div>`).join('');
            dashboardContent.innerHTML = html || '<p style="text-align:center; padding:40px; color:#666;">No defects found.</p>';
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

        // --- STARTUP ---
        await checkAppVersion();
        window.showLoader('Syncing...');
        if (navigator.onLine) {
            await syncAllPending(true);
            await refreshConfig(true);
        } else {
            await renderDashboard();
        }
        window.hideLoader();

    } catch (err) {
        console.error("Init Failure:", err);
        window.hideLoader();
    }
});

// Update modal logic
document.getElementById('close-detail-btn').onclick = () => document.getElementById('detail-modal').style.display = 'none';
document.getElementById('update-status-select').onchange = (e) => {
    document.getElementById('done-photo-group').style.display = (e.target.value === 'Done') ? 'block' : 'none';
};

document.getElementById('save-update-btn').onclick = async () => {
    const newStatus = document.getElementById('update-status-select').value;
    window.showLoader('Saving...');
    const updated = { ...currentUpdatingDefect, status: newStatus };
    if (!updated.history) updated.history = [];
    const note = document.getElementById('new-comment-input').value.trim();
    if (note) updated.history.push({ time: new Date().toISOString(), msg: `Note: ${note}` });
    
    const db = await initDB();
    delete updated.isSynced;
    await db.put('pending_defects', updated);
    document.getElementById('detail-modal').style.display = 'none';
    window.location.reload(); // Simple refresh to show changes
};
