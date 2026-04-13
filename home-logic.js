let dbPromise = null;
let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;

// GLOBAL STORE for defects to avoid passing large Base64 in onclick
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

// Global functions for modal access
window.showDefectDetailById = (id) => {
    const defect = window.allRenderedDefects[id];
    if (!defect) return;
    
    currentUpdatingDefect = defect;
    updatedDonePhotoBase64 = null;
    
    const detailStatusText = document.getElementById('detail-status-text');
    const detailDesc = document.getElementById('detail-desc');
    const detailImg = document.getElementById('detail-img');
    const updateStatusSelect = document.getElementById('update-status-select');
    const donePhotoGroup = document.getElementById('done-photo-group');
    const detailModal = document.getElementById('detail-modal');

    if (detailStatusText) detailStatusText.textContent = defect.status || 'Open';
    if (detailDesc) detailDesc.textContent = defect.description;
    
    // Use fixMapUrl for URLs, fallback to Base64 photo
    const mainPhoto = defect.photo || (defect.photoUrl ? fixMapUrl(defect.photoUrl) : '');
    if (detailImg) {
        detailImg.src = mainPhoto;
        detailImg.style.display = mainPhoto ? 'block' : 'none';
    }
    
    if (updateStatusSelect) updateStatusSelect.value = defect.status || 'Open';
    if (donePhotoGroup) donePhotoGroup.style.display = (updateStatusSelect.value === 'Done') ? 'block' : 'none';
    if (detailModal) detailModal.style.display = 'block';
};

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

    // Global Loader helpers
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

    // Admin UI Initialization
    if (session.role === 'Admin') adminBtn.style.display = 'block';
    adminBtn.onclick = () => adminModal.style.display = 'block';
    closeAdminBtn.onclick = () => adminModal.style.display = 'none';

    document.getElementById('refresh-admin-table-btn').onclick = async () => {
        showLoader('Refreshing project configuration...');
        try {
            await refreshConfig();
        } catch (e) {
            alert('Refresh failed: ' + e.toString());
        } finally {
            hideLoader();
        }
    };

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
                if (res) {
                    const data = await res.json();
                    if (data.status === 'success') {
                        await db.delete('pending_defects', d.id);
                        successCount++;
                    }
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
        showLoader('Syncing data & checking for app updates...');
        try {
            // 1. Sync data to Google Apps Script
            await syncAllPending();
            await refreshConfig(); // Force fetch latest synced data from GA
            
            // 2. Check for latest version on GitHub Pages
            if ('serviceWorker' in navigator) {
                const registration = await navigator.serviceWorker.getRegistration();
                if (registration) {
                    await registration.update();
                    console.log('App update check triggered');
                }
            }

            alert('Sync complete. Data updated and checked for the latest version.');
        } catch (e) {
            alert('Sync error: ' + e.toString());
        } finally {
            hideLoader();
        }
    };

    // --- CONFIG & ADMIN ---
    await loadAdminSelectors();

    async function loadAdminSelectors() {
        const cached = localStorage.getItem('project_config');
        if (!cached) return;
        try {
            const config = JSON.parse(cached);
            const unitSelect = document.getElementById('admin-unit-select');
            const storySelect = document.getElementById('admin-story-select');
            const newUnitTypeSelect = document.getElementById('new-unit-number-type');

            if (config.unitTypes) {
                const options = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
                if (unitSelect) unitSelect.innerHTML = options;
                if (newUnitTypeSelect) newUnitTypeSelect.innerHTML = '<option value="">Select Type...</option>' + options;
            }
            if (config.stories && storySelect) {
                storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
            }

            // Populate Data Table
            const tbody = document.getElementById('admin-data-table-body');
            if (tbody) {
                if (config.unitNumbers && config.unitNumbers.length > 0) {
                    let html = '';
                    config.unitNumbers.forEach(un => {
                        const matchingMaps = (config.maps || []).filter(m => m.unit === un.type);
                        const floors = matchingMaps.map(m => m.story).join(', ') || '<span style="color: var(--text-muted); opacity: 0.5;">No maps</span>';
                        html += `
                            <tr style="border-bottom: 1px solid var(--border-color);">
                                <td style="padding: 10px;">${un.number}</td>
                                <td style="padding: 10px;">${un.type}</td>
                                <td style="padding: 10px;">${floors}</td>
                            </tr>
                        `;
                    });
                    tbody.innerHTML = html;
                } else {
                    tbody.innerHTML = '<tr><td colspan="3" style="padding: 20px; text-align: center; color: var(--text-muted);">No unit numbers defined yet.</td></tr>';
                }
            }
        } catch (e) { console.error('Error parsing config for UI:', e); }
    }

    document.getElementById('add-unit-btn').onclick = async () => {
        const val = document.getElementById('new-unit-val').value.trim();
        const label = document.getElementById('new-unit-label').value.trim();
        if (!val || !label) return alert('Enter both ID and Name');
        
        showLoader('Adding unit type...');
        try {
            const res = await authorizedPost('add_unit', { value: val, label: label });
            if (res) {
                const data = await res.json();
                if (data.status === 'success') { 
                    await refreshConfig(); 
                    document.getElementById('new-unit-val').value = '';
                    document.getElementById('new-unit-label').value = '';
                    alert('Unit type added!');
                } else { alert('Error: ' + data.message); }
            }
        } catch (e) { alert('Add Unit failed: ' + e.toString()); }
        finally { hideLoader(); }
    };

    document.getElementById('add-story-btn').onclick = async () => {
        const val = document.getElementById('new-story-val').value.trim();
        const label = document.getElementById('new-story-label').value.trim();
        if (!val || !label) return alert('Enter both ID and Name');
        
        showLoader('Adding story...');
        try {
            const res = await authorizedPost('add_story', { value: val, label: label });
            if (res) {
                const data = await res.json();
                if (data.status === 'success') { 
                    await refreshConfig(); 
                    document.getElementById('new-story-val').value = '';
                    document.getElementById('new-story-label').value = '';
                    alert('Story added!');
                } else { alert('Error: ' + data.message); }
            }
        } catch (e) { alert('Add Story failed: ' + e.toString()); }
        finally { hideLoader(); }
    };

    document.getElementById('add-single-unit-btn').onclick = async () => {
        const num = document.getElementById('new-unit-number-val').value.trim();
        const typ = document.getElementById('new-unit-number-type').value;
        if (!num || !typ) return alert('Enter Unit Number and Select Type');

        showLoader(`Adding unit ${num}...`);
        try {
            const res = await authorizedPost('add_unit_numbers', { units: [{ number: num, type: typ }] });
            if (res) {
                const data = await res.json();
                if (data.status === 'success') {
                    document.getElementById('new-unit-number-val').value = '';
                    await refreshConfig();
                    alert(`Unit ${num} added!`);
                } else { alert('Backend Error: ' + (data.message || 'Unknown error')); }
            } else { alert('Connection error. Please try again.'); }
        } catch (e) { alert('App Error: ' + e.toString()); }
        finally { hideLoader(); }
    };

    document.getElementById('upload-map-btn').onclick = async () => {
        const file = document.getElementById('map-upload-input').files[0];
        if (!file) return alert('Select PNG');
        
        showLoader('Uploading floor plan to Google Drive...');
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const res = await authorizedPost('upload_map', { 
                    unit: document.getElementById('admin-unit-select').value, 
                    story: document.getElementById('admin-story-select').value, 
                    imageBlob: e.target.result 
                });
                if (res) {
                    const data = await res.json();
                    if (data.status === 'success') { 
                        await refreshConfig(); 
                        alert('Map uploaded successfully!');
                    } else { alert('Upload error: ' + data.message); }
                }
            } catch (err) { alert('Upload failed: ' + err.toString()); }
            finally { hideLoader(); }
        };
        reader.readAsDataURL(file);
    };

    document.getElementById('add-map-url-btn').onclick = async () => {
        const url = document.getElementById('map-url-input').value.trim();
        if (!url) return alert('Enter URL');
        
        showLoader('Saving Map URL...');
        try {
            const res = await authorizedPost('add_map_url', { 
                unit: document.getElementById('admin-unit-select').value, 
                story: document.getElementById('admin-story-select').value, 
                mapUrl: url 
            });
            if (res) {
                const data = await res.json();
                if (data.status === 'success') { 
                    await refreshConfig(); 
                    document.getElementById('map-url-input').value = '';
                    alert('Map URL saved!');
                } else { alert('Error: ' + data.message); }
            }
        } catch (e) { alert('Save Map URL failed: ' + e.toString()); }
        finally { hideLoader(); }
    };

    async function refreshConfig() {
        try {
            const res = await authorizedPost('get_config', {});
            if (res) {
                const result = await res.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    await loadAdminSelectors();
                    await renderDashboard();
                    
                    // PROACTIVE OFFLINE STORAGE
                    warmCache(result.config);
                } else {
                    console.error('Config refresh backend error:', result.message);
                }
            }
        } catch (e) {
            console.error('Refresh Config Exception:', e);
        }
    }

    // --- PROACTIVE CACHING FOR FULL OFFLINE ---
    function warmCache(config) {
        if (!config || !navigator.onLine) return;
        const urls = new Set();
        
        // 1. Collect Map URLs
        if (config.maps) {
            config.maps.forEach(m => {
                if (m.mapUrl) urls.add(fixMapUrl(m.mapUrl));
                // Also cache local assets if any
                if (m.unit && m.story) urls.add(`assets/${m.unit}_${m.story}.png`);
            });
        }
        
        // 2. Collect Synced Defect Photos
        if (config.syncedDefects) {
            config.syncedDefects.forEach(d => {
                if (d.photoUrl) urls.add(d.photoUrl);
                if (d.donePhotoUrl) urls.add(d.donePhotoUrl);
                if (d.photo) urls.add(d.photo);
            });
        }

        console.log(`Warming cache with ${urls.size} external assets...`);
        urls.forEach(url => {
            if (url && (url.startsWith('http') || url.startsWith('assets/'))) {
                fetch(url, { mode: 'no-cors' }).catch(() => {});
            }
        });
    }

    // --- DASHBOARD RENDER ---
    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading lifecycle data...</p></div>';
        let projectConfig = { syncedDefects: [] };
        const cached = localStorage.getItem('project_config');
        if (cached) {
            projectConfig = JSON.parse(cached);
            // Proactively warm cache even for existing config
            warmCache(projectConfig);
        }

        const pendingDefects = await db.getAll('pending_defects');
        const allDefects = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, isSynced: true })),
            ...pendingDefects.map(d => ({ ...d, isSynced: false }))
        ];

        // Clear and Repopulate Global Store
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
            html += `
                <div class="unit-section">
                    <h3 class="unit-header">${unit}</h3>
                    <div class="defect-grid">
                        ${defects.map(d => {
                            const displayPhoto = d.donePhotoUrl ? fixMapUrl(d.donePhotoUrl) : 
                                               (d.photo || (d.photoUrl ? fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png'));
                            return `
                                <div class="defect-card neu-raised" onclick="window.showDefectDetailById('${d.id}')">
                                    <span class="badge ${d.status || 'Open'}">${d.status || 'Open'}</span>
                                    ${!d.isSynced ? '<span class="badge pending" style="top: auto; bottom: 10px;">Pending Sync</span>' : ''}
                                    <img src="${displayPhoto}" class="defect-card-img" onerror="this.src='assets/floorplan-placeholder.png'">
                                    <h4>${d.story || 'N/A'}</h4>
                                    <p class="desc">${d.description || 'No description'}</p>
                                    <p class="date">${new Date(d.timestamp).toLocaleDateString()}</p>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `;
        }
        dashboardContent.innerHTML = html;
    }

    await renderDashboard();

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
        try {
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST', 
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' }, // Critical GAS workaround
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
        } catch (err) {
            console.error('API Post failed:', err);
            return null;
        }
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
