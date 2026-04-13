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
    
    // Render Timeline
    renderTimeline(defect, timelineContainer);
    
    if (detailModal) detailModal.style.display = 'block';
};

function renderTimeline(defect, container) {
    if (!container) return;
    let html = `
        <div style="color: var(--text-muted); padding: 5px 0;">
            <span style="font-weight: 600;">Reported:</span> ${new Date(defect.timestamp).toLocaleString()}
        </div>
    `;
    
    if (defect.history && defect.history.length > 0) {
        defect.history.forEach(h => {
            html += `
                <div style="border-left: 2px solid var(--accent-color); padding-left: 10px; margin: 5px 0;">
                    <div style="font-size: 0.75rem; color: var(--text-muted);">${new Date(h.time).toLocaleString()}</div>
                    <div style="font-weight: 500;">${h.msg}</div>
                </div>
            `;
        });
    } else {
        html += `<div style="color: var(--text-muted); opacity: 0.5; font-style: italic;">No activity logged yet.</div>`;
    }
    container.innerHTML = html;
    container.scrollTop = container.scrollHeight;
}

// --- PDF EXPORT FUNCTION ---
window.exportUnitPDF = async (unitNumber) => {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const defects = Object.values(window.allRenderedDefects).filter(d => d.unit === unitNumber);
    
    doc.setFontSize(20);
    doc.text(`Defect Report: Unit ${unitNumber}`, 20, 20);
    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleString()}`, 20, 28);
    
    let y = 40;
    defects.forEach((d, index) => {
        if (y > 250) { doc.addPage(); y = 20; }
        
        doc.setFontSize(12);
        doc.setTextColor(24, 119, 242);
        doc.text(`${index + 1}. ${d.description || 'No Description'}`, 20, y);
        
        doc.setFontSize(10);
        doc.setTextColor(100);
        y += 7;
        doc.text(`Status: ${d.status} | Story: ${d.story} | Date: ${new Date(d.timestamp).toLocaleDateString()}`, 20, y);
        
        if (d.history && d.history.length > 0) {
            y += 7;
            doc.setFontSize(9);
            doc.text(`Latest Note: ${d.history[d.history.length-1].msg}`, 25, y);
        }
        
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

    // Filter Elements
    const searchInput = document.getElementById('search-input');
    const filterStatus = document.getElementById('filter-status');
    const resetFilterBtn = document.getElementById('reset-filter-btn');

    // Detail Modal Elements
    const detailModal = document.getElementById('detail-modal');
    const closeDetailBtn = document.getElementById('close-detail-btn');
    const updateStatusSelect = document.getElementById('update-status-select');
    const donePhotoGroup = document.getElementById('done-photo-group');
    const donePhotoInput = document.getElementById('done-photo-input');
    const saveUpdateBtn = document.getElementById('save-update-btn');
    const newCommentInput = document.getElementById('new-comment-input');
    const addCommentBtn = document.getElementById('add-comment-btn');

    // --- DASHBOARD RENDER & FILTERING ---
    let masterDefectList = [];

    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading lifecycle data...</p></div>';
        let projectConfig = { syncedDefects: [] };
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
            const matchSearch = (d.unit || '').toLowerCase().includes(query) || 
                              (d.description || '').toLowerCase().includes(query);
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
                            const photo = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : 
                                        (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png'));
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

    searchInput.oninput = applyFilters;
    filterStatus.onchange = applyFilters;
    resetFilterBtn.onclick = () => {
        searchInput.value = '';
        filterStatus.value = 'all';
        applyFilters();
    };

    // --- COMMENT LOGIC ---
    addCommentBtn.onclick = () => {
        const msg = newCommentInput.value.trim();
        if (!msg || !currentUpdatingDefect) return;
        
        if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
        currentUpdatingDefect.history.push({
            time: new Date().toISOString(),
            msg: `Note: ${msg}`
        });
        
        newCommentInput.value = '';
        renderTimeline(currentUpdatingDefect, document.getElementById('defect-timeline'));
    };

    saveUpdateBtn.onclick = async () => {
        const newStatus = updateStatusSelect.value;
        if (newStatus === 'Done' && !updatedDonePhotoBase64 && !currentUpdatingDefect.donePhotoUrl) {
            return alert('Completion photo is required.');
        }

        if (newStatus !== currentUpdatingDefect.status) {
            if (!currentUpdatingDefect.history) currentUpdatingDefect.history = [];
            currentUpdatingDefect.history.push({
                time: new Date().toISOString(),
                msg: `Status changed to ${newStatus}`
            });
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

    // Standard buttons
    closeDetailBtn.onclick = () => detailModal.style.display = 'none';
    logoutBtn.onclick = () => { localStorage.clear(); window.location.href = 'index.html'; };
    newReportBtn.onclick = () => { window.location.href = 'defect.html'; };
    
    // --- AUTH & SYNC ---
    async function authorizedPost(action, payload) {
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', 
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify({
                    action,
                    auth: { username: session.username, deviceId: session.deviceId, deviceToken: session.deviceToken },
                    ...payload
                })
            });
            return res;
        } catch (err) { return null; }
    }

    async function syncAllPending() {
        if (isSyncing || !navigator.onLine) return;
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) return;

        isSyncing = true;
        for (const d of pending) {
            try {
                const res = await authorizedPost('sync_defects', { defect: d });
                if (res && (await res.json()).status === 'success') {
                    await db.delete('pending_defects', d.id);
                }
            } catch (e) {}
        }
        isSyncing = false;
        await refreshConfig();
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
