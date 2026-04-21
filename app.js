document.addEventListener('DOMContentLoaded', () => {
    console.log("Login page initialized...");
    
    try {
        const loginForm = document.getElementById('login-form');
        const messageDiv = document.getElementById('message');
        const otpGroup = document.getElementById('otp-group');
        const passwordGroup = document.getElementById('password-group');
        const otpInput = document.getElementById('otp');
        const changeUsernameLink = document.getElementById('change-username-link');

        function getDeviceId() {
            let id = localStorage.getItem('device_id');
            if (!id) {
                id = window.generateId('dev');
                localStorage.setItem('device_id', id);
            }
            return id;
        }

        setInterval(window.checkAppVersion, 300000);
        window.checkAppVersion();

        const session = JSON.parse(localStorage.getItem('user_session'));
        if (session) { 
            window.showLoader('Welcome back...');
            setTimeout(() => { window.location.href = 'home.html'; }, 500);
            return; 
        }

        if (loginForm) {
            loginForm.addEventListener('submit', async (e) => {
                e.preventDefault();
                
                const username = document.getElementById('username').value.trim();
                const password = document.getElementById('password').value;
                const otp = otpInput ? otpInput.value.trim() : '';
                const deviceId = getDeviceId();

                const isOtpStep = otpGroup && otpGroup.style.display === 'block';
                const action = isOtpStep ? 'verify_otp' : 'login';
                
                window.showLoader(isOtpStep ? 'Verifying Code...' : 'Authenticating...');
                
                try {
                    const payload = { username, password, otp, deviceId };
                    const res = await window.authorizedPost(action, payload);

                    if (!res) {
                        window.hideLoader();
                        showMessage('Connection error. Please try again.', 'error');
                        return;
                    }

                    const result = await res.json();
                    window.hideLoader();

                    if (result.status === 'requires_otp') {
                        if (passwordGroup) passwordGroup.style.display = 'none';
                        if (otpGroup) otpGroup.style.display = 'block';
                        document.getElementById('username').readOnly = true;
                        showMessage(`Device not recognized. Enter OTP.`, 'info');
                    } else if (result.status === 'success') {
                        window.showLoader('Confirmed! Loading...');
                        const userData = result.session || result.user;
                        const sessionData = {
                            ...userData,
                            deviceId: deviceId,
                            deviceToken: result.deviceToken || userData.deviceToken
                        };
                        localStorage.setItem('user_session', JSON.stringify(sessionData));
                        setTimeout(() => { window.location.href = 'home.html'; }, 800);
                    } else {
                        showMessage(result.message || 'Login failed. Check your credentials.', 'error');
                    }
                } catch (err) {
                    console.error("Login error:", err);
                    window.hideLoader();
                    showMessage('An unexpected error occurred.', 'error');
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
