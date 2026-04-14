// Essential UI helpers defined at the top
window.showLoader = (text) => {
    const loaderText = document.getElementById('loader-text');
    if (loaderText) loaderText.textContent = text || 'Loading...';
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'flex';
};

window.hideLoader = () => { 
    const loader = document.getElementById('global-loader');
    if (loader) loader.style.display = 'none'; 
};

document.addEventListener('DOMContentLoaded', () => {
    console.log("Login page initialized...");
    
    try {
        const loginForm = document.getElementById('login-form');
        const messageDiv = document.getElementById('message');
        const otpGroup = document.getElementById('otp-group');
        const passwordGroup = document.getElementById('password-group');
        const otpInput = document.getElementById('otp');
        const changeUsernameLink = document.getElementById('change-username-link');

        // APP_VERSION is defined in config.js
        const version = (typeof APP_VERSION !== 'undefined') ? APP_VERSION : (window.APP_VERSION || "1.8.0");

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
                if (data.version && data.version !== version) {
                    if (!localStorage.getItem('user_session')) window.location.reload();
                }
            } catch (e) {}
        }
        setInterval(checkAppVersion, 300000);
        checkAppVersion();

        const session = JSON.parse(localStorage.getItem('user_session'));
        if (session) { 
            window.showLoader('Welcome back...');
            setTimeout(() => { window.location.href = 'home.html'; }, 500);
            return; 
        }

        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                console.log("Form submitted...");
                
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value;
                const otp = otpInput ? otpInput.value.trim() : '';
                const deviceId = getDeviceId();

                const isOtpStep = otpGroup && otpGroup.style.display === 'block';
                const action = isOtpStep ? 'verify_otp' : 'login';
                
                window.showLoader(isOtpStep ? 'Verifying Code...' : 'Authenticating...');
                
                try {
                    const payload = { action, username, password, otp, deviceId };
                    const res = await fetch(GA_BACKEND_URL, {
                        method: 'POST',
                        mode: 'cors',
                        headers: { 'Content-Type': 'text/plain' },
                        body: JSON.stringify(payload)
                    });

                    const result = await res.json();
                    window.hideLoader();

                    if (result.status === 'requires_otp') {
                        if (passwordGroup) passwordGroup.style.display = 'none';
                        if (otpGroup) otpGroup.style.display = 'block';
                        document.getElementById('username').readOnly = true;
                        showMessage(`Device not recognized. Enter OTP.`, 'info');
                    } else if (result.status === 'success') {
                        window.showLoader('Confirmed! Loading...');
                        localStorage.setItem('user_session', JSON.stringify(result.session || result.user));
                        if ((result.user || result.session) && result.deviceToken) {
                            const updatedSession = {
                                ...(result.user || result.session),
                                deviceId: deviceId,
                                deviceToken: result.deviceToken
                            };
                            localStorage.setItem('user_session', JSON.stringify(updatedSession));
                        }
                        setTimeout(() => { window.location.href = 'home.html'; }, 800);
                    } else {
                        showMessage(result.message || 'Login failed. Check your credentials.', 'error');
                    }
                } catch (err) {
                    console.error("Fetch error:", err);
                    window.hideLoader();
                    showMessage('Connection error. Please try again.', 'error');
                }
            });
        }

        if (changeUsernameLink) {
            changeUsernameLink.onclick = (e) => {
                e.preventDefault();
                if (otpGroup) otpGroup.style.display = 'none';
                if (passwordGroup) passwordGroup.style.display = 'block';
                document.getElementById('username').readOnly = false;
                if (otpInput) otpInput.value = "";
                if (messageDiv) messageDiv.style.display = 'none';
            };
        }

        function showMessage(text, type) {
            if (!messageDiv) return;
            messageDiv.textContent = text;
            messageDiv.style.display = 'block';
            messageDiv.style.backgroundColor = type === 'error' ? '#fce8e6' : '#e8f0fe';
            messageDiv.style.color = type === 'error' ? '#c5221f' : '#1967d2';
        }
    } catch (err) {
        console.error("Initialization Error:", err);
    }
});
