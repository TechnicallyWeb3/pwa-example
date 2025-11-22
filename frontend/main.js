// Use environment variable or fallback to localhost
// In Docker, VITE_API_URL should be set to http://localhost:3030
// But in browser, we need to use the host where backend is accessible
const API_BASE_URL = import.meta.env.VITE_API_URL || (typeof window !== 'undefined' 
  ? `${window.location.protocol}//${window.location.hostname}:3030`
  : 'http://localhost:3030');

let currentUser = null;
let authToken = null;
let vapidPublicKey = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check for saved auth token
  authToken = localStorage.getItem('authToken');
  currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');

  if (authToken && currentUser) {
    showApp();
  } else {
    showAuth();
  }

  // Setup install prompt
  setupInstallPrompt();

  // Setup service worker for push notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(registration => {
      console.log('Service Worker registered');
      initializePushNotifications(registration);
    });
  }

  // Setup forms
  setupAuthForms();
  setupNotificationForm();
});

function setupInstallPrompt() {
  let deferredPrompt;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const installPrompt = document.getElementById('installPrompt');
    if (installPrompt) {
      installPrompt.classList.remove('hidden');
    }
  });

  document.getElementById('installBtn').addEventListener('click', async () => {
    if (!deferredPrompt) return;

    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    
    if (outcome === 'accepted') {
      console.log('User accepted install');
    }
    
    deferredPrompt = null;
    document.getElementById('installPrompt').classList.add('hidden');
  });
}

async function initializePushNotifications(registration) {
  try {
    // Get VAPID public key
    const response = await fetch(`${API_BASE_URL}/api/notifications/vapid-public-key`);
    const data = await response.json();
    vapidPublicKey = data.publicKey;

    if (!vapidPublicKey) {
      console.warn('VAPID public key not available');
      return;
    }

    // Request notification permission
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      console.warn('Notification permission not granted');
      return;
    }

    // Subscribe to push notifications
    const subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    });

    // Send subscription to server
    if (authToken) {
      await fetch(`${API_BASE_URL}/api/notifications/subscribe`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ subscription })
      });
    }
  } catch (error) {
    console.error('Push notification setup error:', error);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding)
    .replace(/\-/g, '+')
    .replace(/_/g, '/');

  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

function setupAuthForms() {
  // Login form
  document.getElementById('loginFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });

      const data = await response.json();

      if (response.ok) {
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        showApp();
        
        // Setup push notifications after login
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          initializePushNotifications(registration);
        }
      } else {
        showError('authError', data.error || 'Login failed');
      }
    } catch (error) {
      showError('authError', 'Network error. Please try again.');
    }
  });

  // Register form
  document.getElementById('registerFormElement').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('registerUsername').value;
    const email = document.getElementById('registerEmail').value;
    const password = document.getElementById('registerPassword').value;

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, email, password })
      });

      const data = await response.json();

      if (response.ok) {
        authToken = data.token;
        currentUser = data.user;
        localStorage.setItem('authToken', authToken);
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
        showApp();
        
        // Setup push notifications after registration
        if ('serviceWorker' in navigator) {
          const registration = await navigator.serviceWorker.ready;
          initializePushNotifications(registration);
        }
      } else {
        showError('authError', data.error || 'Registration failed');
      }
    } catch (error) {
      showError('authError', 'Network error. Please try again.');
    }
  });
}

function setupNotificationForm() {
  document.getElementById('notificationForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const title = document.getElementById('notificationTitle').value;
    const body = document.getElementById('notificationBody').value;
    const scheduled_time = document.getElementById('notificationTime').value;
    const repeat_daily = document.getElementById('repeatDaily').checked;

    try {
      const response = await fetch(`${API_BASE_URL}/api/notifications`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({
          title,
          body,
          scheduled_time: new Date(scheduled_time).toISOString(),
          repeat_daily: repeat_daily
        })
      });

      const data = await response.json();

      if (response.ok) {
        showSuccess('notificationSuccess', 'Notification scheduled successfully!');
        document.getElementById('notificationForm').reset();
        loadNotifications();
      } else {
        showError('notificationError', data.error || 'Failed to schedule notification');
      }
    } catch (error) {
      showError('notificationError', 'Network error. Please try again.');
    }
  });
}

async function loadNotifications() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const notifications = await response.json();
    displayNotifications(notifications);
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

function displayNotifications(notifications) {
  const list = document.getElementById('notificationsList');
  
  if (notifications.length === 0) {
    list.innerHTML = '<p>No scheduled notifications</p>';
    return;
  }

  list.innerHTML = notifications.map(notif => `
    <div class="notification-item">
      <h3>${escapeHtml(notif.title)}</h3>
      <p>${escapeHtml(notif.body)}</p>
      <div class="meta">
        Scheduled: ${new Date(notif.scheduled_time).toLocaleString()}<br>
        ${notif.repeat_daily ? 'Repeats daily' : 'One-time'}
        ${notif.is_active ? '' : ' (Inactive)'}
      </div>
      <div class="actions">
        <button class="btn btn-danger" onclick="deleteNotification(${notif.id})">Delete</button>
      </div>
    </div>
  `).join('');
}

async function deleteNotification(id) {
  if (!confirm('Delete this notification?')) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications/${id}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (response.ok) {
      loadNotifications();
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
  }
}

async function loadLogs() {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications/logs`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const logs = await response.json();
    displayLogs(logs);
  } catch (error) {
    console.error('Error loading logs:', error);
  }
}

function displayLogs(logs) {
  const list = document.getElementById('logsList');
  
  if (logs.length === 0) {
    list.innerHTML = '<p>No logs yet</p>';
    return;
  }

  list.innerHTML = logs.map(log => `
    <div class="log-item ${log.status === 'failed' ? 'failed' : ''}">
      <h4>${escapeHtml(log.title)}</h4>
      <p>${escapeHtml(log.body)}</p>
      <div class="meta">
        Status: ${log.status}<br>
        Sent: ${new Date(log.sent_at).toLocaleString()}
        ${log.error_message ? `<br>Error: ${escapeHtml(log.error_message)}` : ''}
      </div>
    </div>
  `).join('');
}

function showAuth() {
  document.getElementById('authSection').classList.add('active');
  document.getElementById('appSection').classList.remove('active');
}

function showApp() {
  document.getElementById('authSection').classList.remove('active');
  document.getElementById('appSection').classList.add('active');
  
  if (currentUser) {
    document.getElementById('userInfo').textContent = `Logged in as ${currentUser.username}`;
  }
  
  loadNotifications();
}

function showLogin() {
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('registerForm').style.display = 'none';
}

function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
}

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  event.target.classList.add('active');

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  if (tabName === 'notifications') {
    document.getElementById('notificationsTab').classList.add('active');
    loadNotifications();
  } else if (tabName === 'logs') {
    document.getElementById('logsTab').classList.add('active');
    loadLogs();
  }
}

function logout() {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  showAuth();
  showLogin();
}

function showError(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 5000);
  }
}

function showSuccess(elementId, message) {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 5000);
  }
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// Make functions globally available
window.showLogin = showLogin;
window.showRegister = showRegister;
window.switchTab = switchTab;
window.logout = logout;
window.deleteNotification = deleteNotification;

