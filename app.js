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

    // Check for existing login state on load
    checkLoginState();

    function checkLoginState() {
        const loggedInUser = localStorage.getItem('isLoggedIn');
        if (loggedInUser) {
            showDashboard(loggedInUser);
        } else {
            showLogin();
        }
    }

    function showDashboard(username) {
        loginContainer.style.display = 'none';
        dashboardContainer.style.display = 'block';
        userDisplay.textContent = username;
        
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
        messageDiv.className = 'message';
        messageDiv.style.display = 'none';

        try {
            if (GA_BACKEND_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
                // Mock response
                console.log('Mock login attempt:', { username, password });
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                if (username === 'admin') {
                    handleLoginSuccess(username);
                } else {
                    showMessage('Invalid credentials. (Mock Mode: use "admin")', 'error');
                }
            } else {
                // Actual GA connection
                const response = await fetch(GA_BACKEND_URL, {
                    method: 'POST',
                    mode: 'cors',
                    cache: 'no-cache',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ action: 'login', username, password }),
                });

                const result = await response.json();
                if (result.status === 'success') {
                    handleLoginSuccess(username);
                } else {
                    showMessage(result.message || 'Login failed.', 'error');
                }
            }
        } catch (error) {
            console.error('Login error:', error);
            showMessage('Connection error. Please try again.', 'error');
        } finally {
            loginBtn.disabled = false;
            loginBtn.textContent = 'Login';
        }
    });

    logoutBtn.addEventListener('click', () => {
        localStorage.removeItem('isLoggedIn');
        showLogin();
    });

    function handleLoginSuccess(username) {
        localStorage.setItem('isLoggedIn', username);
        showDashboard(username);
    }

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
        messageDiv.style.display = 'block';
    }
});
