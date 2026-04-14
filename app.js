document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const messageDiv = document.getElementById('message');
    const otpGroup = document.getElementById('otp-group');
    const passwordGroup = document.getElementById('password-group');
    const otpInput = document.getElementById('otp');
    const changeUsernameLink = document.getElementById('change-username-link');
    const APP_VERSION = "1.6.1.b";

    const GA_BACKEND_URL = "https://script.google.com/macros/s/AKfycbyrv_Z6Zmqsh6PhIKOnit6On_vPh_MeInZof_ZpgZ_AnIsIDidsh_ZIdsz_idsz/exec";

    // Version Check
    async function checkAppVersion() {
        if (!navigator.onLine) return;
        try {
            const res = await fetch('version.json?t=' + Date.now());
            const data = await res.json();
            if (data.version && data.version !== APP_VERSION) {
                console.log("New version available:", data.version);
                // In login page, we can just reload automatically if no user is active
                if (!localStorage.getItem('user_session')) window.location.reload();
            }
        } catch (e) {}
    }
    setInterval(checkAppVersion, 300000);
    checkAppVersion();

    // Check existing session
    const session = JSON.parse(localStorage.getItem('user_session'));
    if (session) { window.location.href = 'home.html'; return; }

    let currentUsername = "";

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const otp = otpInput.value.trim();

        showLoader('Authenticating...');
        try {
            const payload = { action: 'login', username, password, otp };
            const res = await fetch(GA_BACKEND_URL, {
                method: 'POST',
                mode: 'cors',
                headers: { 'Content-Type': 'text/plain' },
                body: JSON.stringify(payload)
            });

            const result = await res.json();
            hideLoader();

            if (result.status === 'otp_required') {
                currentUsername = username;
                passwordGroup.style.display = 'none';
                otpGroup.style.display = 'block';
                document.getElementById('username').readOnly = true;
                showMessage('Device not recognized. Please enter OTP from Admin.', 'info');
            } else if (result.status === 'success') {
                localStorage.setItem('user_session', JSON.stringify(result.session));
                window.location.href = 'home.html';
            } else {
                showMessage(result.message || 'Login failed', 'error');
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
        document.getElementById('loader-text').textContent = text;
        document.getElementById('global-loader').style.display = 'flex';
    }
    function hideLoader() {
        document.getElementById('global-loader').style.display = 'none';
    }
    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = 'message ' + type;
        messageDiv.style.display = 'block';
    }
});
