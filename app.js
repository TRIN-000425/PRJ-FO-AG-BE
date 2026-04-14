document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const messageDiv = document.getElementById('message');
    const otpGroup = document.getElementById('otp-group');
    const passwordGroup = document.getElementById('password-group');
    const otpInput = document.getElementById('otp');
    const changeUsernameLink = document.getElementById('change-username-link');
    const APP_VERSION = "1.7.1";

    // GA_BACKEND_URL is defined in config.js

    function getDeviceId() {
        let id = localStorage.getItem('device_id');
        if (!id) {
            id = 'dev-' + Math.random().toString(36).substr(2, 9);
            localStorage.setItem('device_id', id);
        }
        return id;
    }

    async function checkAppVersion() {
        if (!navigator.onLine) return;
        try {
            const res = await fetch('version.json?t=' + Date.now());
            const data = await res.json();
            if (data.version && data.version !== APP_VERSION) {
                if (!localStorage.getItem('user_session')) window.location.reload();
            }
        } catch (e) {}
    }
    setInterval(checkAppVersion, 300000);
    checkAppVersion();

    const session = JSON.parse(localStorage.getItem('user_session'));
    if (session) { 
        showLoader('Welcome back! Redirecting...');
        setTimeout(() => { window.location.href = 'home.html'; }, 500);
        return; 
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const otp = otpInput.value.trim();
        const deviceId = getDeviceId();

        // Determine action: if OTP field is showing, we are verifying OTP
        const isOtpStep = otpGroup.style.display === 'block';
        const action = isOtpStep ? 'verify_otp' : 'login';
        
        showLoader(isOtpStep ? 'Verifying Authentication Code...' : 'Authenticating with Cloud...');
        
        try {
            const payload = { action, username, password, otp, deviceId };
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            hideLoader();

            if (result.status === 'requires_otp') {
                passwordGroup.style.display = 'none';
                otpGroup.style.display = 'block';
                document.getElementById('username').readOnly = true;
                showMessage(`Device not recognized. Device ID: ${deviceId}. Please enter OTP from Admin.`, 'info');
            } else if (result.status === 'success') {
                showLoader('Authorization confirmed! Loading dashboard...');
                localStorage.setItem('user_session', JSON.stringify(result.session || result.user)); // result.session usually from login, result.user from verify_otp
                
                // If backend sent session object inside result.session, keep it. 
                // If it sent user and deviceToken separately (like handleVerifyOtp), reconstruct it.
                if (result.user && result.deviceToken) {
                    localStorage.setItem('user_session', JSON.stringify({
                        ...result.user,
                        deviceId: deviceId,
                        deviceToken: result.deviceToken
                    }));
                }

                setTimeout(() => { window.location.href = 'home.html'; }, 800);
            } else {
                showMessage(result.message || 'Authentication failed', 'error');
            }
        } catch (err) {
            hideLoader();
            showMessage('Connection error to backend.', 'error');
        }
    });

    changeUsernameLink.onclick = (e) => {
        e.preventDefault();
        otpGroup.style.display = 'none';
        passwordGroup.style.display = 'block';
        document.getElementById('username').readOnly = false;
        otpInput.value = "";
        messageDiv.style.display = 'none';
    };

    function showLoader(text) {
        const loaderText = document.getElementById('loader-text');
        if (loaderText) loaderText.textContent = text;
        document.getElementById('global-loader').style.display = 'flex';
    }
    function hideLoader() { document.getElementById('global-loader').style.display = 'none'; }
    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = 'message ' + type;
        messageDiv.style.display = 'block';
    }
});
