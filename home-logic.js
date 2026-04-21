let currentUpdatingDefect = null;
let updatedDonePhotoBase64 = null;
let isSyncing = false;
let currentView = 'grid';
let currentStatusFilter = 'all';
let currentUnitFilter = 'all';
let masterDefectList = [];
let projectConfig = { syncedDefects: [], unitNumbers: [], stories: [], unitTypes: [], maps: [] };

window.allRenderedDefects = {};

// --- PIN HIGHLIGHT HELPERS ---
window.highlightPin = (id, active) => {
    const pin = document.getElementById(`pin-${id}`);
    if (pin) {
        if (active) {
            pin.style.width = '30px';
            pin.style.height = '30px';
            pin.style.zIndex = '1000';
            pin.style.boxShadow = '0 0 20px rgba(26, 115, 232, 0.8)';
        } else {
            pin.style.width = '16px';
            pin.style.height = '16px';
            pin.style.zIndex = '10';
            pin.style.boxShadow = '0 2px 4px rgba(0,0,0,0.3)';
        }
    }
};

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
        const photoUrl = d.donePhotoUrl ? window.fixMapUrl(d.donePhotoUrl) : (d.photo || (d.photoUrl ? window.fixMapUrl(d.photoUrl) : ''));
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

// --- GLOBAL MODAL ACCESS ---
window.showDefectDetailById = (id) => {
    const defect = window.allRenderedDefects[id];
    if (!defect) return;
    
    currentUpdatingDefect = JSON.parse(JSON.stringify(defect));
    updatedDonePhotoBase64 = null;
    
    const statusText = document.getElementById('detail-status-text');
    if (statusText) {
        statusText.textContent = defect.status || 'Open';
        statusText.className = `badge ${defect.status || 'Open'}`;
    }
    
    const descText = document.getElementById('detail-desc');
    if (descText) descText.textContent = defect.description;
    
    const img = document.getElementById('detail-img');
    if (img) {
        img.src = defect.photo || (defect.photoUrl ? window.fixMapUrl(defect.photoUrl) : 'assets/floorplan-placeholder.png');
    }

    // --- MINI MAP LOGIC ---
    const miniMap = document.getElementById('detail-location-map');
    if (miniMap && defect.position) {
        console.log("Rendering mini-map for defect:", defect.id, "at", defect.position);
        
        // Find map from global projectConfig
        const unitMapping = (projectConfig.unitNumbers || []).find(u => u.number === defect.unit);
        const unitType = unitMapping ? unitMapping.type : defect.unit;
        let mapUrl = 'assets/floorplan-placeholder.png';
        
        if (projectConfig.maps) {
            const m = projectConfig.maps.find(map => map.unit === unitType && map.story === defect.story);
            if (m) {
                mapUrl = window.fixMapUrl(m.mapUrl);
                console.log("Found map URL:", mapUrl);
            } else {
                console.warn("No map found for unitType:", unitType, "story:", defect.story);
            }
        }
        
        miniMap.src = mapUrl;

        // Correct Zoom Math: 
        // We are using a 4x zoom (400% width/height).
        // translateX/Y are as a percentage of the image itself.
        // Formula to center a point (p) in normalized 0-1 range:
        // Trans = (0.5/Scale - p) * 100
        const scale = 4;
        const translateX = (0.5 / scale - (defect.position.x / 100)) * 100;
        const translateY = (0.5 / scale - (defect.position.y / 100)) * 100;
        
        miniMap.style.width = (scale * 100) + '%';
        miniMap.style.height = (scale * 100) + '%';
        miniMap.style.transform = `translate(${translateX}%, ${translateY}%)`; 
        miniMap.style.position = 'absolute';
        miniMap.style.top = '0';
        miniMap.style.left = '0';
    }

    const locationPreview = document.getElementById('detail-location-preview');
    if (locationPreview) {
        locationPreview.onclick = () => {
            document.getElementById('detail-modal').style.display = 'none';
            currentView = 'list';
            const gridBtn = document.getElementById('view-grid-btn');
            const listBtn = document.getElementById('view-list-btn');
            if (gridBtn) gridBtn.className = 'outline';
            if (listBtn) listBtn.className = 'primary';
            applyFilters();
            
            setTimeout(() => {
                const pin = document.getElementById(`pin-${defect.id}`);
                if (pin) {
                    pin.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    window.highlightPin(defect.id, true);
                    setTimeout(() => window.highlightPin(defect.id, false), 3000);
                }
            }, 500);
        };
    }
    
    const updateSelect = document.getElementById('update-status-select');
    if (updateSelect) updateSelect.value = defect.status || 'Open';
    
    const doneGroup = document.getElementById('done-photo-group');
    if (doneGroup) doneGroup.style.display = (defect.status === 'Done') ? 'block' : 'none';
    
    renderTimeline(defect, document.getElementById('defect-timeline'));
    const modal = document.getElementById('detail-modal');
    if (modal) modal.style.display = 'flex';
};

function renderTimeline(defect, container) {
    if (!container) return;
    container.innerHTML = '';
    
    const reportedDiv = document.createElement('div');
    reportedDiv.style.marginBottom = '8px';
    reportedDiv.innerHTML = `<strong>Reported:</strong> ${new Date(defect.timestamp).toLocaleString()}`;
    container.appendChild(reportedDiv);

    if (defect.history && defect.history.length > 0) {
        defect.history.forEach(h => {
            const histDiv = document.createElement('div');
            histDiv.style.marginTop = '4px';
            histDiv.style.paddingTop = '4px';
            histDiv.style.borderTop = '1px solid #ddd';
            
            const timeSpan = document.createElement('span');
            timeSpan.style.fontSize = '0.75rem';
            timeSpan.style.color = '#666';
            timeSpan.textContent = new Date(h.time).toLocaleString();
            
            histDiv.appendChild(timeSpan);
            histDiv.appendChild(document.createElement('br'));
            histDiv.appendChild(document.createTextNode(h.msg));
            container.appendChild(histDiv);
        });
    }
}

document.addEventListener('DOMContentLoaded', async () => {
    console.log("Dashboard initializing...");

    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session) { window.location.href = 'index.html'; return; }

    const db = await window.initDB();
    const dashboardContent = document.getElementById('dashboard-content');

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

    document.getElementById('banner-sync-btn').onclick = () => document.getElementById('sync-label').click();

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

    const unitFilterSelect = document.getElementById('unit-filter-select');
    if (unitFilterSelect) {
        unitFilterSelect.onchange = () => {
            currentUnitFilter = unitFilterSelect.value;
            applyFilters();
        };
    }

    if (session.role === 'Admin') {
        const adminNavItem = document.getElementById('admin-nav-item');
        if (adminNavItem) {
            adminNavItem.style.display = 'flex';
            adminNavItem.onclick = (e) => {
                e.preventDefault();
                document.getElementById('admin-modal').style.display = 'flex';
                loadAdminSelectors();
            };
        }
    }

    document.getElementById('close-admin-btn').onclick = () => document.getElementById('admin-modal').style.display = 'none';
    document.getElementById('refresh-admin-table-btn').onclick = () => refreshConfig(false);
    document.getElementById('force-purge-btn').onclick = async () => {
        if (confirm('Force purge local cache and re-download?')) {
            window.showLoader('Clearing Cache...');
            localStorage.removeItem('project_config');
            await refreshConfig(false);
        }
    };

    async function syncAllPending(silent = false) {
        if (isSyncing || !navigator.onLine) return;
        const pending = await db.getAll('pending_defects');
        if (pending.length === 0) return;
        isSyncing = true;
        for (const d of pending) {
            try {
                const res = await window.authorizedPost('sync_defects', { defect: d });
                if (res && (await res.json()).status === 'success') await db.delete('pending_defects', d.id);
            } catch (e) {}
        }
        isSyncing = false;
        await refreshConfig(silent);
    }

    async function refreshConfig(silent = true) {
        if (!navigator.onLine) { await renderDashboard(); return; }
        try {
            const res = await window.authorizedPost('get_config', {});
            if (res) {
                const result = await res.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    projectConfig = result.config;
                    updateUnitDropdown(projectConfig.unitNumbers);
                    loadAdminSelectors();
                    await renderDashboard();
                }
            }
        } catch (e) { await renderDashboard(); }
    }

    function updateUnitDropdown(units) {
        if (!unitFilterSelect || !units) return;
        const current = unitFilterSelect.value;
        unitFilterSelect.innerHTML = '<option value="all">All Units</option>';
        const sortedUnits = [...units].sort((a, b) => a.number.localeCompare(b.number));
        sortedUnits.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.number;
            opt.textContent = u.number;
            unitFilterSelect.appendChild(opt);
        });
        unitFilterSelect.value = current;
    }

    async function renderDashboard() {
        const cached = localStorage.getItem('project_config');
        if (cached) {
            projectConfig = JSON.parse(cached);
            updateUnitDropdown(projectConfig.unitNumbers);
        }
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
            const matchSearch = (d.description || '').toLowerCase().includes(query);
            const matchStatus = (currentStatusFilter === 'all') || (d.status === currentStatusFilter);
            const matchUnit = (currentUnitFilter === 'all') || (d.unit === currentUnitFilter);
            return matchSearch && matchStatus && matchUnit;
        });
        
        if (currentView === 'grid') renderGridView(filtered);
        else renderMapView(filtered);
    }

    function renderGridView(filtered) {
        if (!dashboardContent) return;
        dashboardContent.innerHTML = '';
        if (filtered.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align:center; padding:40px; color:#666;';
            p.textContent = 'No defects found.';
            dashboardContent.appendChild(p);
            return;
        }
        
        const grid = document.createElement('div');
        grid.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px;';
        
        filtered.forEach(d => {
            const card = document.createElement('div');
            card.className = 'card defect-card';
            card.style.cssText = 'padding:0; overflow:hidden; cursor:pointer;';
            card.onclick = () => window.showDefectDetailById(d.id);
            
            const img = document.createElement('img');
            img.className = 'defect-card-img';
            img.style.cssText = 'height: 120px; width:100%; object-fit:cover;';
            img.src = d.photo || (d.photoUrl ? window.fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png');
            
            const content = document.createElement('div');
            content.style.padding = '10px';
            
            const header = document.createElement('div');
            header.style.cssText = 'display:flex; justify-content:space-between; align-items:start; margin-bottom:4px;';
            
            const unit = document.createElement('span');
            unit.style.cssText = 'font-weight:600; font-size:0.875rem;';
            unit.textContent = d.unit;
            
            const status = document.createElement('span');
            status.className = `badge ${d.status}`;
            status.style.cssText = 'font-size:0.6rem; padding:2px 6px;';
            status.textContent = d.status;
            
            header.appendChild(unit);
            header.appendChild(status);
            
            const desc = document.createElement('p');
            desc.style.cssText = 'font-size:0.75rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; color:#666;';
            desc.textContent = d.description;
            
            content.appendChild(header);
            content.appendChild(desc);
            card.appendChild(img);
            card.appendChild(content);
            grid.appendChild(card);
        });
        dashboardContent.appendChild(grid);
    }

    function renderMapView(filtered) {
        if (!dashboardContent) return;
        dashboardContent.innerHTML = '';
        if (filtered.length === 0) {
            const p = document.createElement('p');
            p.style.cssText = 'text-align:center; padding:40px; color:#666;';
            p.textContent = 'No defects found.';
            dashboardContent.appendChild(p);
            return;
        }
        
        const groupedByFloor = filtered.reduce((acc, d) => {
            const key = `${d.unit} - ${d.story}`;
            if (!acc[key]) acc[key] = [];
            acc[key].push(d);
            return acc;
        }, {});

        const sortedFloorKeys = Object.keys(groupedByFloor).sort((a, b) => a.localeCompare(b, undefined, {numeric: true, sensitivity: 'base'}));

        sortedFloorKeys.forEach(title => {
            const defects = groupedByFloor[title];
            const [unitNo, story] = title.split(' - ');
            const unitMapping = projectConfig.unitNumbers.find(u => u.number === unitNo);
            const unitType = unitMapping ? unitMapping.type : unitNo;
            let mapUrl = 'assets/floorplan-placeholder.png';
            if (projectConfig.maps) {
                const m = projectConfig.maps.find(map => map.unit === unitType && map.story === story);
                if (m) mapUrl = window.fixMapUrl(m.mapUrl);
            }

            const clusters = [];
            defects.forEach(d => {
                const cluster = clusters.find(c => Math.abs(c.x - d.position.x) < 2 && Math.abs(c.y - d.position.y) < 2);
                if (cluster) cluster.defects.push(d);
                else clusters.push({ x: d.position.x, y: d.position.y, defects: [d] });
            });

            const floorCard = document.createElement('div');
            floorCard.className = 'card';
            floorCard.style.padding = '16px';
            floorCard.style.marginBottom = '24px';
            
            const h3 = document.createElement('h3');
            h3.style.cssText = 'font-size:1.1rem; margin-bottom:16px; border-bottom: 1px solid #eee; padding-bottom: 8px;';
            h3.textContent = title;
            floorCard.appendChild(h3);

            const container = document.createElement('div');
            container.className = 'map-view-container';
            container.style.cssText = 'display: grid; grid-template-columns: 1fr 1fr; gap: 20px; align-items: start;';

            // Map Side
            const mapWrapper = document.createElement('div');
            mapWrapper.className = 'floor-map-wrapper';
            mapWrapper.style.cssText = 'position:relative; width:100%; border-radius:12px; overflow:hidden; background:#eee; box-shadow: var(--shadow-soft);';
            
            const mapImg = document.createElement('img');
            mapImg.src = mapUrl;
            mapImg.style.width = '100%';
            mapImg.style.display = 'block';
            mapWrapper.appendChild(mapImg);

            clusters.forEach(c => {
                const count = c.defects.length;
                const mainDefect = c.defects[0];
                const colors = { Open: '#f9ab00', Onprogress: '#1a73e8', Done: '#188038' };
                const bgColor = count > 1 ? '#333' : (colors[mainDefect.status] || 'red');
                
                const pin = document.createElement('div');
                pin.id = `pin-${mainDefect.id}`;
                pin.style.cssText = `position:absolute; left:${c.x}%; top:${c.y}%; width:20px; height:20px; background:${bgColor}; border:2px solid #fff; border-radius:50%; transform:translate(-50%,-50%); cursor:pointer; box-shadow:0 2px 4px rgba(0,0,0,0.3); display:flex; align-items:center; justify-content:center; color:white; font-size:10px; font-weight:bold; z-index:10; transition: all 0.2s;`;
                pin.textContent = count > 1 ? count : '';
                pin.onclick = (e) => handlePinClick(c.defects, e);
                mapWrapper.appendChild(pin);
            });

            // List Side
            const listSide = document.createElement('div');
            listSide.style.cssText = 'max-height: 400px; overflow-y: auto; padding-right: 8px;';
            
            defects.forEach(d => {
                const row = document.createElement('div');
                row.id = `row-${d.id}`;
                row.style.cssText = 'font-size:0.875rem; padding:12px; border-radius: 8px; margin-bottom: 8px; border: 1px solid #eee; display:flex; align-items:center; justify-content:space-between; cursor:pointer; transition: all 0.2s;';
                row.onclick = () => window.showDefectDetailById(d.id);
                row.onmouseenter = () => window.highlightPin(d.id, true);
                row.onmouseleave = () => window.highlightPin(d.id, false);
                
                const info = document.createElement('div');
                info.style.cssText = 'flex: 1; min-width: 0;';
                const desc = document.createElement('div');
                desc.style.cssText = 'color:#333; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
                desc.textContent = d.description;
                const date = document.createElement('div');
                date.style.cssText = 'font-size: 0.7rem; color: #888; margin-top: 2px;';
                date.textContent = `Reported: ${new Date(d.timestamp).toLocaleDateString()}`;
                info.appendChild(desc);
                info.appendChild(date);
                
                const badge = document.createElement('span');
                badge.className = `badge ${d.status}`;
                badge.style.cssText = 'font-size:0.6rem; padding:2px 8px; margin-left: 10px;';
                badge.textContent = d.status;
                
                row.appendChild(info);
                row.appendChild(badge);
                listSide.appendChild(row);
            });

            container.appendChild(mapWrapper);
            container.appendChild(listSide);
            floorCard.appendChild(container);
            dashboardContent.appendChild(floorCard);
        });
    }

    function handlePinClick(defects, event) {
        if (event) event.stopPropagation();
        const pinElement = event.currentTarget;
        const mainDefect = defects[0];
        const rowId = `row-${mainDefect.id}`;
        const rowElement = document.getElementById(rowId);
        if (rowElement) {
            rowElement.scrollIntoView({ behavior: 'smooth', block: 'center' });
            rowElement.classList.add('row-highlight');
            setTimeout(() => rowElement.classList.remove('row-highlight'), 2000);
        }
        showQuickViewPopover(defects, mainDefect.position, pinElement.closest('.floor-map-wrapper'));
    }

    function showQuickViewPopover(defects, pos, container) {
        const existing = document.querySelector('.pin-popover');
        if (existing) existing.remove();

        const popover = document.createElement('div');
        popover.className = 'pin-popover';
        popover.style.left = pos.x + '%';
        popover.style.top = pos.y + '%';

        if (defects.length === 1) {
            const d = defects[0];
            const img = document.createElement('img');
            img.style.cssText = 'width: 100%; height: 80px; object-fit: cover; border-radius: 8px; margin-bottom: 8px;';
            img.src = d.photo || (d.photoUrl ? window.fixMapUrl(d.photoUrl) : 'assets/floorplan-placeholder.png');
            popover.appendChild(img);

            const title = document.createElement('div');
            title.style.cssText = 'font-weight: 600; font-size: 0.85rem; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
            title.textContent = d.description;
            popover.appendChild(title);

            const badge = document.createElement('div');
            badge.className = `badge ${d.status}`;
            badge.style.cssText = 'font-size: 0.6rem; padding: 2px 8px; margin-bottom: 8px;';
            badge.textContent = d.status;
            popover.appendChild(badge);

            const btn = document.createElement('button');
            btn.className = 'primary';
            btn.style.cssText = 'width: 100%; height: 28px; font-size: 0.7rem; padding: 0;';
            btn.textContent = 'Full Details';
            btn.onclick = () => window.showDefectDetailById(d.id);
            popover.appendChild(btn);
        } else {
            const header = document.createElement('div');
            header.style.cssText = 'font-weight: 600; font-size: 0.85rem; margin-bottom: 8px; border-bottom: 1px solid #eee; padding-bottom: 4px;';
            header.textContent = `${defects.length} Defects here`;
            popover.appendChild(header);

            const list = document.createElement('div');
            list.style.cssText = 'max-height: 150px; overflow-y: auto;';
            defects.forEach(d => {
                const item = document.createElement('div');
                item.style.cssText = 'font-size: 0.75rem; padding: 6px; border-radius: 4px; cursor: pointer; border-bottom: 1px solid #f5f5f5;';
                item.innerHTML = `<strong>${window.sanitize(d.status)}:</strong> ${window.sanitize(d.description.substring(0, 20))}...`;
                item.onclick = () => window.showDefectDetailById(d.id);
                list.appendChild(item);
            });
            popover.appendChild(list);
        }

        if (container) container.appendChild(popover);
        const closeHandler = (e) => {
            if (!popover.contains(e.target)) { popover.remove(); document.removeEventListener('click', closeHandler); }
        };
        setTimeout(() => document.addEventListener('click', closeHandler), 10);
    }

    function loadAdminSelectors() {
        const cached = localStorage.getItem('project_config');
        if (!cached) return;
        const config = JSON.parse(cached);
        const unitSelect = document.getElementById('admin-unit-select');
        const storySelect = document.getElementById('admin-story-select');
        const tbody = document.getElementById('admin-data-table-body');

        if (config.unitTypes && unitSelect) {
            unitSelect.innerHTML = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
        }
        if (config.stories && storySelect) {
            storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
        }
        if (tbody && config.unitNumbers) {
            tbody.innerHTML = '';
            config.unitNumbers.forEach(un => {
                const tr = document.createElement('tr');
                tr.style.borderBottom = '1px solid #eee';
                const floors = (config.maps || []).filter(m => m.unit === un.type).map(m => m.story).join(', ') || 'No maps';
                tr.innerHTML = `<td style="padding: 10px;">${window.sanitize(un.number)}</td><td style="padding: 10px;">${window.sanitize(un.type)}</td><td style="padding: 10px;">${window.sanitize(floors)}</td>`;
                tbody.appendChild(tr);
            });
        }
    }

    // --- STARTUP ---
    window.checkAppVersion();
    window.showLoader('Connecting to server...');
    if (navigator.onLine) {
        window.showLoader('Syncing with Google Sheets...');
        await syncAllPending(true);
        await refreshConfig(true);
    } else {
        window.showLoader('Loading offline data...');
        await renderDashboard();
    }
    setTimeout(window.hideLoader, 1000);
});

document.getElementById('close-detail-btn').onclick = () => document.getElementById('detail-modal').style.display = 'none';
document.getElementById('update-status-select').onchange = (e) => {
    document.getElementById('done-photo-group').style.display = (e.target.value === 'Done') ? 'block' : 'none';
};

document.getElementById('save-update-btn').onclick = async () => {
    const newStatus = document.getElementById('update-status-select').value;
    window.showLoader('Saving...');
    const updated = { ...currentUpdatingDefect, status: newStatus };
    if (!updated.history) updated.history = [];
    const noteEl = document.getElementById('new-comment-input');
    const note = noteEl ? noteEl.value.trim() : '';
    if (note) updated.history.push({ time: new Date().toISOString(), msg: `Note: ${note}` });
    
    const db = await window.initDB();
    delete updated.isSynced;
    await db.put('pending_defects', updated);
    document.getElementById('detail-modal').style.display = 'none';
    // Instead of reload, just re-render
    window.location.reload(); 
};
