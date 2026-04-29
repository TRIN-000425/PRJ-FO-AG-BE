/**
 * Shared Utilities for Punch List PWA
 */

window.APP_VERSION = "2.1.1";

// --- UI HELPERS ---
let progressInterval = null;

// --- NOTIFICATION MODAL ---
const ensureNotifModal = () => {
    if (document.getElementById('notification-modal')) return;
    const modal = document.createElement('div');
    modal.id = 'notification-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
        <div class="notif-card">
            <div id="notif-icon" class="notif-icon info"></div>
            <h3 id="notif-title" class="notif-title">Notification</h3>
            <p id="notif-message" class="notif-message"></p>
            <div id="notif-actions" class="notif-actions"></div>
        </div>
    `;
    document.body.appendChild(modal);
};

window.showAlert = (msg, title = 'Notification', type = 'info') => {
    ensureNotifModal();
    const modal = document.getElementById('notification-modal');
    const icon = document.getElementById('notif-icon');
    const titleEl = document.getElementById('notif-title');
    const msgEl = document.getElementById('notif-message');
    const actions = document.getElementById('notif-actions');

    const icons = {
        info: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
        error: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>',
        success: '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>'
    };

    icon.className = `notif-icon ${type}`;
    icon.innerHTML = icons[type] || icons.info;
    titleEl.textContent = title;
    msgEl.textContent = msg;
    actions.innerHTML = '<button class="primary" id="notif-ok-btn">OK</button>';
    
    modal.style.display = 'flex';
    document.getElementById('notif-ok-btn').onclick = () => { modal.style.display = 'none'; };
};

window.showConfirm = (msg, onConfirm, onCancel = null, title = 'Confirm Action') => {
    ensureNotifModal();
    const modal = document.getElementById('notification-modal');
    const icon = document.getElementById('notif-icon');
    const titleEl = document.getElementById('notif-title');
    const msgEl = document.getElementById('notif-message');
    const actions = document.getElementById('notif-actions');

    icon.className = 'notif-icon confirm';
    icon.innerHTML = '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>';
    titleEl.textContent = title;
    msgEl.textContent = msg;
    actions.innerHTML = `
        <button class="outline" id="notif-cancel-btn">Cancel</button>
        <button class="primary" id="notif-confirm-btn">Confirm</button>
    `;

    modal.style.display = 'flex';
    document.getElementById('notif-cancel-btn').onclick = () => {
        modal.style.display = 'none';
        if (onCancel) onCancel();
    };
    document.getElementById('notif-confirm-btn').onclick = () => {
        modal.style.display = 'none';
        if (onConfirm) onConfirm();
    };
};

window.showLoader = (text = 'Loading...', duration = 15000) => {
    const loader = document.getElementById('global-loader');
    const loaderText = document.getElementById('loader-text');
    const progressContainer = document.getElementById('loader-progress-container');
    const progressFill = document.getElementById('loader-progress-fill');

    if (loader) {
        if (loaderText) loaderText.textContent = text;
        loader.style.display = 'flex';
        
        if (progressContainer && progressFill) {
            progressContainer.style.display = 'block';
            progressFill.style.width = '0%';
            
            let startTime = Date.now();
            if (progressInterval) clearInterval(progressInterval);
            
            progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                let timeRatio = elapsed / duration;
                if (timeRatio > 1) timeRatio = 1;
                
                let progress = 0;
                // Non-linear: Fast to 80% (in 20% of time), then slow to 100%
                const fastTimeRatio = 0.2;
                const fastProgressLimit = 0.8;
                
                if (timeRatio <= fastTimeRatio) {
                    progress = (timeRatio / fastTimeRatio) * fastProgressLimit;
                } else {
                    const slowTimeRatio = (timeRatio - fastTimeRatio) / (1 - fastTimeRatio);
                    progress = fastProgressLimit + (slowTimeRatio * (1 - fastProgressLimit));
                }
                
                progressFill.style.width = (progress * 100) + '%';
                
                if (timeRatio >= 1) {
                    clearInterval(progressInterval);
                    setTimeout(() => {
                        if (loader.style.display === 'flex') {
                            window.showAlert('The request is taking longer than expected. Please check your connection and try again.', 'Request Timeout', 'error');
                            window.hideLoader();
                        }
                    }, 500);
                }
            }, 50);
        }
    }
};

window.hideLoader = () => {
    const loader = document.getElementById('global-loader');
    const progressContainer = document.getElementById('loader-progress-container');
    if (loader) loader.style.display = 'none';
    if (progressContainer) progressContainer.style.display = 'none';
    if (progressInterval) clearInterval(progressInterval);
};

// --- DATA & API ---
let dbPromise = null;
window.initDB = async () => {
    if (dbPromise) return dbPromise;
    dbPromise = idb.openDB('defects-db', 1, {
        upgrade(db) {
            if (!db.objectStoreNames.contains('pending_defects')) {
                db.createObjectStore('pending_defects', { keyPath: 'id' });
            }
        },
    });
    return dbPromise;
};

window.authorizedPost = async (action, payload) => {
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (!session && action !== 'login' && action !== 'verify_otp') {
        window.location.href = 'index.html';
        return null;
    }

    try {
        const body = {
            action,
            ...payload
        };

        // Inject auth if session exists
        if (session) {
            body.auth = {
                username: session.username,
                deviceId: session.deviceId,
                deviceToken: session.deviceToken
            };
        }

        const res = await fetch(GA_BACKEND_URL, {
            method: 'POST',
            mode: 'cors',
            headers: { 'Content-Type': 'text/plain' },
            body: JSON.stringify(body)
        });

        if (res.status === 401) {
            localStorage.clear();
            window.location.href = 'index.html';
            return null;
        }
        return res;
    } catch (e) {
        console.error("API Error:", e);
        return null;
    }
};

window.fixMapUrl = (url) => {
    if (!url) return url;
    const trimmed = url.trim();
    if (trimmed.includes('drive.google.com') || trimmed.includes('googledrive.com')) {
        const idMatch = trimmed.match(/\/d\/([^/?]+)/) || trimmed.match(/id=([^&?]+)/);
        if (idMatch && idMatch[1]) return `https://drive.google.com/thumbnail?id=${idMatch[1]}&sz=w1600`;
    }
    return trimmed;
};

// --- SECURITY HELPERS ---
window.sanitize = (str) => {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
};

window.generateId = (prefix = 'id') => {
    if (window.crypto && window.crypto.randomUUID) {
        return `${prefix}-${window.crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// --- VERSION CHECK ---
window.checkAppVersion = async () => {
    const localTag = document.getElementById('local-version-tag');
    if (localTag) localTag.textContent = 'v' + window.APP_VERSION;
    
    const updateBtn = document.getElementById('force-update-btn');
    if (updateBtn && !updateBtn.dataset.listener) {
        updateBtn.onclick = () => window.location.reload();
        updateBtn.dataset.listener = "true";
    }

    if (!navigator.onLine) return;
    try {
        const res = await fetch('version.json?t=' + Date.now());
        const data = await res.json();
        if (data.version && data.version !== window.APP_VERSION) {
            const banner = document.getElementById('update-banner');
            if (banner) banner.style.display = 'flex';
            // Only auto-reload if on login page
            if (window.location.pathname.endsWith('index.html') || window.location.pathname.endsWith('/')) {
                if (!localStorage.getItem('user_session')) window.location.reload();
            }
        }
    } catch (e) {}
};
