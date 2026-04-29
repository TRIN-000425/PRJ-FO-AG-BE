/**
 * Shared Utilities for Punch List PWA
 */

window.APP_VERSION = "2.0.1";

// --- UI HELPERS ---
let progressInterval = null;

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
                            alert('Request timed out. Please try again.');
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
