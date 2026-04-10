let currentPinPos = null;
let compressedPhotoData = null;

const GA_BACKEND_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

// Initial setup
document.addEventListener('DOMContentLoaded', async () => {
    const mapContainer = document.getElementById('map-container');
    const floorplanImg = document.getElementById('floorplan-img');
    const unitDisplay = document.getElementById('current-unit-display');
    const floorDisplay = document.getElementById('current-floor-display');
    const pinsContainer = document.getElementById('pins-container');
    const modal = document.getElementById('defect-modal');
    const photoInput = document.getElementById('defect-photo');
    const previewImg = document.getElementById('preview-img');
    const saveBtn = document.getElementById('save-defect-btn');
    const cancelBtn = document.getElementById('cancel-defect-btn');
    
    const backBtn = document.getElementById('back-btn');
    backBtn.onclick = () => window.location.href = 'index.html';

    // 1. Fetch Config (from cache first, then network)
    await loadProjectConfig();

    async function loadProjectConfig() {
        // Try to load from Cache first
        const cachedConfig = localStorage.getItem('project_config');
        if (cachedConfig) {
            renderSelectors(JSON.parse(cachedConfig));
        }

        // Then try to fetch fresh from Backend
        if (GA_BACKEND_URL !== 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
            try {
                const response = await fetch(GA_BACKEND_URL, {
                    method: 'POST',
                    mode: 'cors',
                    body: JSON.stringify({ action: 'get_config' })
                });
                const result = await response.json();
                if (result.status === 'success') {
                    localStorage.setItem('project_config', JSON.stringify(result.config));
                    renderSelectors(result.config);
                }
            } catch (err) {
                console.warn('Could not fetch fresh config, using cache:', err);
            }
        }
    }

    function renderSelectors(config) {
        if (config.unitTypes && config.unitTypes.length > 0) {
            unitSelect.innerHTML = config.unitTypes.map(u => `<option value="${u.value}">${u.label}</option>`).join('');
        }
        if (config.stories && config.stories.length > 0) {
            storySelect.innerHTML = config.stories.map(s => `<option value="${s.value}">${s.label}</option>`).join('');
        }
        updateSelection();
    }

    // Handle selection changes
    function updateSelection() {
        const unit = unitSelect.value;
        const story = storySelect.value;
        
        unitDisplay.textContent = unit;
        floorDisplay.textContent = story;
        
        pinsContainer.innerHTML = '';
        floorplanImg.src = `assets/${unit}_${story}.png`;
        floorplanImg.onerror = () => {
            floorplanImg.src = 'assets/floorplan-placeholder.png';
        };

        loadPinsForCurrentView(unit, story);
    }

    unitSelect.addEventListener('change', updateSelection);
    storySelect.addEventListener('change', updateSelection);

    // Handle map click
    mapContainer.addEventListener('click', (e) => {
        const rect = mapContainer.getBoundingClientRect();
        const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
        const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
        
        currentPinPos = { x: xPercent, y: yPercent };
        modal.style.display = 'block';
    });

    // ... rest of existing DOMContentLoaded logic ...

    // Handle image file selection & compression
    photoInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            compressImage(file, 1024, 0.7, (base64) => {
                compressedPhotoData = base64;
                previewImg.src = base64;
                previewImg.style.display = 'block';
            });
        }
    });

    saveBtn.addEventListener('click', () => {
        const desc = document.getElementById('defect-desc').value;
        if (!desc || !compressedPhotoData) {
            alert('Please add a description and a photo.');
            return;
        }

        saveDefectLocally({
            description: desc,
            photo: compressedPhotoData,
            position: currentPinPos,
            timestamp: new Date().toISOString()
        });

        // Add pin to UI
        addPinToUI(currentPinPos);
        
        // Reset and close
        closeModal();
    });

    cancelBtn.addEventListener('click', closeModal);
    
    function closeModal() {
        modal.style.display = 'none';
        document.getElementById('defect-desc').value = '';
        photoInput.value = '';
        previewImg.style.display = 'none';
        compressedPhotoData = null;
    }
});

// Helper: Resize and Compress Image using Canvas
function compressImage(file, maxDimension, quality, callback) {
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            let width = img.width;
            let height = img.height;

            if (width > height) {
                if (width > maxDimension) {
                    height *= maxDimension / width;
                    width = maxDimension;
                }
            } else {
                if (height > maxDimension) {
                    width *= maxDimension / height;
                    height = maxDimension;
                }
            }

            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);
            
            // Output as JPEG with specified quality
            callback(canvas.toDataURL('image/jpeg', quality));
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function loadPinsForCurrentView(unit, story) {
    const defects = JSON.parse(localStorage.getItem('pending_defects') || '[]');
    defects.forEach(defect => {
        if (defect.unit === unit && defect.story === story) {
            addPinToUI(defect.position);
        }
    });
}

function saveDefectLocally(defect) {
    // Include the current view info
    defect.unit = document.getElementById('unit-type-select').value;
    defect.story = document.getElementById('story-select').value;

    const defects = JSON.parse(localStorage.getItem('pending_defects') || '[]');
    defects.push(defect);
    localStorage.setItem('pending_defects', JSON.stringify(defects));
    console.log('Defect saved locally:', defect);
}

function addPinToUI(pos) {
    const pin = document.createElement('div');
    pin.className = 'pin';
    pin.style.left = pos.x + '%';
    pin.style.top = pos.y + '%';
    document.getElementById('pins-container').appendChild(pin);
}
