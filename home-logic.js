let dbPromise = null;

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
    const dashboardContent = document.getElementById('dashboard-content');

    logoutBtn.onclick = () => {
        localStorage.removeItem('user_session');
        localStorage.removeItem('project_config');
        window.location.href = 'index.html';
    };

    newReportBtn.onclick = () => {
        window.location.href = 'defect.html';
    };

    await renderDashboard();

    async function renderDashboard() {
        dashboardContent.innerHTML = '<div style="text-align: center; padding: 50px;"><p>Loading and grouping defects...</p></div>';

        // 1. Get synced defects from config (local cache or backend)
        let projectConfig = { syncedDefects: [] };
        const cached = localStorage.getItem('project_config');
        if (cached) projectConfig = JSON.parse(cached);

        // 2. Get pending defects from IndexedDB
        const pendingDefects = await db.getAll('pending_defects');

        // 3. Combine all defects
        const allDefects = [
            ...projectConfig.syncedDefects.map(d => ({ ...d, status: 'synced' })),
            ...pendingDefects.map(d => ({ ...d, status: 'pending' }))
        ];

        if (allDefects.length === 0) {
            dashboardContent.innerHTML = '<div class="neu-inset" style="text-align: center; padding: 50px; border-radius: 20px;"><p>No defect reports found yet.</p></div>';
            return;
        }

        // 4. Group by Unit
        const grouped = allDefects.reduce((acc, d) => {
            const unit = d.unit || 'Unknown Unit';
            if (!acc[unit]) acc[unit] = [];
            acc[unit].push(d);
            return acc;
        }, {});

        // 5. Render
        let html = '';
        for (const [unit, defects] of Object.entries(grouped)) {
            html += `
                <div class="unit-section">
                    <h3 class="unit-header">${sanitizeHTML(unit)}</h3>
                    <div class="defect-grid">
                        ${defects.map(d => renderDefectCard(d)).join('')}
                    </div>
                </div>
            `;
        }
        dashboardContent.innerHTML = html;
    }

    function renderDefectCard(d) {
        const photo = d.photo || d.photoUrl || 'assets/floorplan-placeholder.png';
        const date = d.timestamp ? new Date(d.timestamp).toLocaleString() : 'Date unknown';
        
        return `
            <div class="defect-card neu-raised">
                <span class="badge ${d.status}">${d.status}</span>
                <img src="${photo}" class="defect-card-img" alt="Defect Photo" onerror="this.src='assets/floorplan-placeholder.png'">
                <h4>${sanitizeHTML(d.story || 'N/A')}</h4>
                <p class="desc">${sanitizeHTML(d.description || 'No description provided.')}</p>
                <p class="date">${date}</p>
            </div>
        `;
    }

    function sanitizeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }
});
