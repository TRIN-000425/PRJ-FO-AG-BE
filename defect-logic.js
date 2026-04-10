let currentPinPos = null;
let compressedPhotoData = null;

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    const mapContainer = document.getElementById('map-container');
    const floorplanImg = document.getElementById('floorplan-img');
    const unitSelect = document.getElementById('unit-type-select');
    const storySelect = document.getElementById('story-select');
    const unitDisplay = document.getElementById('current-unit-display');
    const floorDisplay = document.getElementById('current-floor-display');
    const pinsContainer = document.getElementById('pins-container');
    
    const backBtn = document.getElementById('back-btn');
    backBtn.onclick = () => window.location.href = 'index.html';

    // Handle selection changes
    function updateSelection() {
        const unit = unitSelect.value;
        const story = storySelect.value;
        
        unitDisplay.textContent = unit;
        floorDisplay.textContent = story;
        
        // Clear pins when switching maps
        pinsContainer.innerHTML = '';
        
        // Update floorplan image path based on selection
        // Logic: assets/Type-A_L1.png
        // For now, it will fallback to the placeholder if the file doesn't exist
        floorplanImg.src = `assets/${unit}_${story}.png`;
        floorplanImg.onerror = () => {
            floorplanImg.src = 'assets/floorplan-placeholder.png';
        };

        // Reload existing pins for this specific unit/story combo
        loadPinsForCurrentView(unit, story);
    }

    unitSelect.addEventListener('change', updateSelection);
    storySelect.addEventListener('change', updateSelection);

    // Initial load
    updateSelection();

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
