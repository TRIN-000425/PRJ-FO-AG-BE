document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const messageDiv = document.getElementById('message');
    const userDisplay = document.getElementById('user-display');
    const otpGroup = document.getElementById('otp-group');
    const otpInput = document.getElementById('otp');
    const passwordGroup = document.getElementById('password-group');
    const changeUsernameLink = document.getElementById('change-username-link');

    // GA_BACKEND_URL is loaded from config.js
    
    let isOtpStep = false;

    checkLoginState();

    function resetLoginState() {
        isOtpStep = false;
        otpGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        document.getElementById('username').readOnly = false;
        otpInput.value = '';
        loginBtn.textContent = 'Login';
        messageDiv.style.display = 'none';
    }

    changeUsernameLink.onclick = (e) => {
        e.preventDefault();
        resetLoginState();
    };

    // 1. Permanent Device Fingerprint
    function getDeviceId() {
        let deviceId = localStorage.getItem('device_id');
        if (!deviceId) {
            // Generate a random UUID-like string for this device
            deviceId = 'dev-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }

    function checkLoginState() {
        const user = JSON.parse(localStorage.getItem('user_session'));
        if (user && user.deviceToken) { // Verify we have the secure token, not just an old session
            showDashboard(user);
        } else {
            showLogin();
        }
    }

    function showDashboard(user) {
        window.location.href = 'home.html';
    }

    function showLogin() {
        loginContainer.style.display = 'block';
        dashboardContainer.style.display = 'none';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const deviceId = getDeviceId();

        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
        messageDiv.style.display = 'none';

        // 2. Multi-Step Payload
        const payload = { action: 'login', username, password, deviceId };
        if (isOtpStep) {
            payload.action = 'verify_otp';
            payload.otp = otpInput.value;
            if (!payload.otp) {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Verify OTP';
                return showMessage('Please enter the OTP provided by your administrator.', 'error');
            }
        }

        try {
            const response = await fetch(GA_BACKEND_URL, {
                method: 'POST', mode: 'cors',
                body: JSON.stringify(payload),
            });

            const result = await response.json();
            
            // 3. Handle Backend States
            if (result.status === 'requires_otp') {
                isOtpStep = true;
                otpGroup.style.display = 'block';
                passwordGroup.style.display = 'none'; // Hide password input
                document.getElementById('username').readOnly = true; // Lock username
                loginBtn.textContent = 'Verify OTP';
                
                // Show the message which contains the deviceId to send to the admin
                showMessage(result.message, 'error'); 
                document.getElementById('otp-instruction').innerText = `Device ID: ${deviceId}`;
                
            } else if (result.status === 'success') {
                // SECURITY AUDIT FIX: NO PLAINTEXT PASSWORDS!
                // We only store the server-generated deviceToken.
                const session = { 
                    username: result.user.username, 
                    deviceId: deviceId,
                    deviceToken: result.deviceToken,
                    name: result.user.name,
                    role: result.user.role 
                };
                localStorage.setItem('user_session', JSON.stringify(session));
                showDashboard(session);
                
            } else {
                showMessage(result.message || 'Login failed.', 'error');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            showMessage('Connection error. Is GA_BACKEND_URL correct?', 'error');
        } finally {
            if (!isOtpStep || (isOtpStep && loginBtn.disabled)) {
                loginBtn.disabled = false;
                loginBtn.textContent = isOtpStep ? 'Verify OTP' : 'Login';
            }
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('user_session'); // Does NOT remove device_id
        localStorage.removeItem('project_config'); // Clear project config on logout
        isOtpStep = false;
        otpGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        document.getElementById('username').readOnly = false;
        otpInput.value = '';
        document.getElementById('password').value = '';
        loginBtn.textContent = 'Login';
        showLogin();
    });

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = 'message'; // Reset classes
        if (type) messageDiv.classList.add(type);
        messageDiv.style.display = 'block';
    }
});
