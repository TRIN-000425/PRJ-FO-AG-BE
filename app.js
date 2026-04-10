document.addEventListener('DOMContentLoaded', () => {
    const loginContainer = document.getElementById('login-container');
    const dashboardContainer = document.getElementById('dashboard-container');
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const messageDiv = document.getElementById('message');
    const userDisplay = document.getElementById('user-display');

    // REPLACE this with your actual Google Apps Script Web App URL
    const GA_BACKEND_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

    checkLoginState();

    function checkLoginState() {
        const user = JSON.parse(localStorage.getItem('user_session'));
        if (user) {
            showDashboard(user);
        } else {
            showLogin();
        }
    }

    function showDashboard(user) {
        loginContainer.style.display = 'none';
        dashboardContainer.style.display = 'block';
        userDisplay.textContent = user.name || user.username;
        
        // Add Start button if it doesn't exist
        if (!document.getElementById('start-tracking-btn')) {
            const startBtn = document.createElement('button');
            startBtn.id = 'start-tracking-btn';
            startBtn.textContent = 'Start Defect Tracking';
            startBtn.style.marginTop = '10px';
            startBtn.onclick = () => window.location.href = 'defect.html';
            dashboardContainer.querySelector('.login-card').insertBefore(startBtn, logoutBtn);
        }
    }

    function showLogin() {
        loginContainer.style.display = 'block';
        dashboardContainer.style.display = 'none';
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in...';
        messageDiv.style.display = 'none';

        try {
            const response = await fetch(GA_BACKEND_URL, {
                method: 'POST',
                mode: 'cors',
                body: JSON.stringify({ action: 'login', username, password }),
            });

            const result = await response.json();
            if (result.status === 'success') {
                // Security: Store session info (including password for API auth)
                const session = { 
                    username: result.user.username, 
                    password: password, // Required for subsequent authorized requests
                    name: result.user.name,
                    role: result.user.role 
                };
                localStorage.setItem('user_session', JSON.stringify(session));
                showDashboard(session);
            } else {
                showMessage(result.message || 'Login failed.', 'error');
            }
        } catch (error) {
            showMessage('Connection error.', 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('user_session');
        showLogin();
    });

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
        messageDiv.style.display = 'block';
    }
});
