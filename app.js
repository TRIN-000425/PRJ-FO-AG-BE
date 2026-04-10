document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const loginBtn = document.getElementById('login-btn');
    const messageDiv = document.getElementById('message');

    // REPLACE this with your actual Google Apps Script Web App URL
    const GA_BACKEND_URL = 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE';

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;

        // Visual feedback
        loginBtn.disabled = true;
        loginBtn.textContent = 'Logging in...';
        messageDiv.className = 'message';
        messageDiv.style.display = 'none';

        try {
            if (GA_BACKEND_URL === 'YOUR_GOOGLE_APPS_SCRIPT_URL_HERE') {
                // Mock response for development if no URL is provided
                console.log('Mock login attempt:', { username, password });
                await new Promise(resolve => setTimeout(resolve, 1500));
                
                // For demo: success if username is 'admin'
                if (username === 'admin') {
                    showMessage('Login successful! (Mock Mode)', 'success');
                } else {
                    showMessage('Invalid credentials. (Mock Mode: use "admin")', 'error');
                }
            } else {
                // Actual connection to Google Apps Script
                const response = await fetch(GA_BACKEND_URL, {
                    method: 'POST',
                    mode: 'cors', // Crucial for cross-origin requests
                    cache: 'no-cache',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        action: 'login',
                        username: username,
                        password: password
                    }),
                });

                const result = await response.json();

                if (result.status === 'success') {
                    showMessage('Login successful!', 'success');
                    // Redirect or handle success
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

    function showMessage(text, type) {
        messageDiv.textContent = text;
        messageDiv.className = `message ${type}`;
        messageDiv.style.display = 'block';
    }
});
