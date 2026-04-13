document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const messageDiv = document.getElementById('message');
    const otpGroup = document.getElementById('otp-group');
    const otpInput = document.getElementById('otp');
    const passwordGroup = document.getElementById('password-group');
    const changeUsernameLink = document.getElementById('change-username-link');

    // GA_BACKEND_URL is loaded from config.js
    console.log('Login logic initialized. Backend URL:', GA_BACKEND_URL);
    
    let isOtpStep = false;

    checkLoginState();

    function resetLoginState() {
        console.log('Resetting login state');
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
            deviceId = 'dev-' + Math.random().toString(36).substr(2, 9) + '-' + Date.now();
            localStorage.setItem('device_id', deviceId);
        }
        return deviceId;
    }

    function checkLoginState() {
        const user = JSON.parse(localStorage.getItem('user_session'));
        if (user && user.deviceToken) {
            console.log('Valid session found, redirecting to dashboard');
            showDashboard(user);
        } else {
            console.log('No valid session found');
        }
    }

    function showDashboard(user) {
        window.location.href = 'home.html';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        console.log('Login form submitted');
        
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const deviceId = getDeviceId();

        if (!username || (!isOtpStep && !password)) {
            return showMessage('Please fill in all fields.', 'error');
        }

        loginBtn.disabled = true;
        loginBtn.textContent = 'Connecting...';
        messageDiv.style.display = 'none';

        const payload = { action: 'login', username, password, deviceId };
        if (isOtpStep) {
            payload.action = 'verify_otp';
            payload.otp = otpInput.value.trim();
            if (!payload.otp) {
                loginBtn.disabled = false;
                loginBtn.textContent = 'Verify OTP';
                return showMessage('Please enter the OTP.', 'error');
            }
        }

        console.log('Sending payload:', { ...payload, password: '***' });

        try {
            const response = await fetch(GA_BACKEND_URL, {
                method: 'POST', 
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' }, // GAS workaround for CORS
                body: JSON.stringify(payload),
            });

            if (!response.ok) throw new Error('Network response was not ok');

            const result = await response.json();
            console.log('Received response:', result);
            
            if (result.status === 'requires_otp') {
                isOtpStep = true;
                otpGroup.style.display = 'block';
                passwordGroup.style.display = 'none';
                document.getElementById('username').readOnly = true;
                loginBtn.textContent = 'Verify OTP';
                showMessage(result.message, 'error'); 
                document.getElementById('otp-instruction').innerText = `Device ID: ${deviceId}`;
                
            } else if (result.status === 'success') {
                const session = { 
                    username: result.user.username, 
                    deviceId: deviceId,
                    deviceToken: result.deviceToken,
                    name: result.user.name,
                    role: result.user.role 
                };
                localStorage.setItem('user_session', JSON.stringify(session));
                console.log('Login success, redirecting...');
                showDashboard(session);
                
            } else {
                showMessage(result.message || 'Login failed.', 'error');
            }
        } catch (error) {
            console.error('Fetch error:', error);
            showMessage('Connection error. Check console for details.', 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = isOtpStep ? 'Verify OTP' : 'Login';
        }
    });

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = 'message';
        if (type) messageDiv.classList.add(type);
        messageDiv.style.display = 'block';
    }
});
