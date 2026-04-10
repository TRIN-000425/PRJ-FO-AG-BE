let currentPinPos = null;
let compressedPhotoData = null;

// Initial setup
document.addEventListener('DOMContentLoaded', () => {
    const mapContainer = document.getElementById('map-container');
    const modal = document.getElementById('defect-modal');
    const photoInput = document.getElementById('defect-photo');
    const previewImg = document.getElementById('preview-img');
    const saveBtn = document.getElementById('save-defect-btn');
    const cancelBtn = document.getElementById('cancel-defect-btn');

    // Handle map click to drop a pin and open modal
    mapContainer.addEventListener('click', (e) => {
        const rect = mapContainer.getBoundingClientRect();
        const xPercent = ((e.clientX - rect.left) / rect.width) * 100;
        const yPercent = ((e.clientY - rect.top) / rect.height) * 100;
        
        currentPinPos = { x: xPercent, y: yPercent };
        modal.style.display = 'block';
    });

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

function saveDefectLocally(defect) {
    // Basic local storage for now (IndexedDB is better for production)
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
