// Use runtime hostname when available (for network access from other devices)
// Fallback to environment variable or localhost
// This ensures the API URL works when accessing from different IP addresses
function getApiBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    // Use the current hostname so it works from any IP address on the network
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    // Only use localhost if we're actually on localhost/127.0.0.1
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
      return import.meta.env.VITE_API_URL || 'http://localhost:3000';
    }
    
    // Use the actual hostname (e.g., 192.168.1.98) with port 3030
    // This allows the app to work when accessed from other devices on the network
    return `${protocol}//${hostname}:3000`;
  }
  
  // Fallback for SSR or before window is available
  return import.meta.env.VITE_API_URL || 'http://localhost:3000';
}

// Compute API_BASE_URL at runtime to ensure we have the correct hostname
const API_BASE_URL = getApiBaseUrl();

interface User {
  id: number;
  username: string;
  email: string;
}

interface Notification {
  id: number;
  user_id: number;
  title: string;
  body: string;
  scheduled_time: string;
  repeat_daily: boolean;
  is_active: boolean;
  created_at: string;
}

interface Log {
  id: number;
  notification_id: number;
  user_id: number;
  status: string;
  sent_at: string;
  error_message?: string;
  title: string;
  body: string;
}

let currentUser: User | null = null;
let authToken: string | null = null;
let vapidPublicKey: string | null = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  // Check for debug route
  if (window.location.pathname === '/debug') {
    showDebugPage();
    return;
  }

  // Check for saved auth token
  authToken = localStorage.getItem('authToken');
  const userStr = localStorage.getItem('currentUser');
  currentUser = userStr ? JSON.parse(userStr) : null;

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

function setupInstallPrompt(): void {
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  interface BeforeInstallPromptEvent extends Event {
    prompt(): Promise<void>;
    userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
  }

  window.addEventListener('beforeinstallprompt', (e: Event) => {
    e.preventDefault();
    deferredPrompt = e as BeforeInstallPromptEvent;
    const installPrompt = document.getElementById('installPrompt');
    if (installPrompt) {
      installPrompt.classList.remove('hidden');
    }
  });

  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.addEventListener('click', async () => {
      if (!deferredPrompt) return;

      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      
      if (outcome === 'accepted') {
        console.log('User accepted install');
      }
      
      deferredPrompt = null;
      const prompt = document.getElementById('installPrompt');
      if (prompt) {
        prompt.classList.add('hidden');
      }
    });
  }
}

async function initializePushNotifications(registration: ServiceWorkerRegistration): Promise<void> {
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
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource
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

function urlBase64ToUint8Array(base64String: string): Uint8Array {
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

function setupAuthForms(): void {
  // Login form
  const loginForm = document.getElementById('loginFormElement');
  if (loginForm) {
    loginForm.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      const usernameInput = document.getElementById('loginUsername') as HTMLInputElement;
      const passwordInput = document.getElementById('loginPassword') as HTMLInputElement;
      const username = usernameInput?.value;
      const password = passwordInput?.value;

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
          if (authToken) {
            localStorage.setItem('authToken', authToken);
          }
          if (currentUser) {
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
          }
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
  }

  // Register form
  const registerForm = document.getElementById('registerFormElement');
  if (registerForm) {
    registerForm.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      const usernameInput = document.getElementById('registerUsername') as HTMLInputElement;
      const emailInput = document.getElementById('registerEmail') as HTMLInputElement;
      const passwordInput = document.getElementById('registerPassword') as HTMLInputElement;
      const username = usernameInput?.value;
      const email = emailInput?.value;
      const password = passwordInput?.value;

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
          if (authToken) {
            localStorage.setItem('authToken', authToken);
          }
          if (currentUser) {
            localStorage.setItem('currentUser', JSON.stringify(currentUser));
          }
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
}

function setupNotificationForm(): void {
  const form = document.getElementById('notificationForm');
  if (form) {
    form.addEventListener('submit', async (e: Event) => {
      e.preventDefault();

      const titleInput = document.getElementById('notificationTitle') as HTMLInputElement;
      const bodyInput = document.getElementById('notificationBody') as HTMLInputElement;
      const timeInput = document.getElementById('notificationTime') as HTMLInputElement;
      const repeatInput = document.getElementById('repeatDaily') as HTMLInputElement;
      
      const title = titleInput?.value;
      const body = bodyInput?.value;
      const scheduled_time = timeInput?.value;
      const repeat_daily = repeatInput?.checked;

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
          (form as HTMLFormElement).reset();
          loadNotifications();
        } else {
          showError('notificationError', data.error || 'Failed to schedule notification');
        }
      } catch (error) {
        showError('notificationError', 'Network error. Please try again.');
      }
    });
  }
}

async function loadNotifications(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const notifications: Notification[] = await response.json();
    displayNotifications(notifications);
  } catch (error) {
    console.error('Error loading notifications:', error);
  }
}

function displayNotifications(notifications: Notification[]): void {
  const list = document.getElementById('notificationsList');
  if (!list) return;
  
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

async function deleteNotification(id: number): Promise<void> {
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

async function loadLogs(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/notifications/logs`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    const logs: Log[] = await response.json();
    displayLogs(logs);
  } catch (error) {
    console.error('Error loading logs:', error);
  }
}

function displayLogs(logs: Log[]): void {
  const list = document.getElementById('logsList');
  if (!list) return;
  
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

function showAuth(): void {
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  if (authSection) authSection.classList.add('active');
  if (appSection) appSection.classList.remove('active');
}

function showApp(): void {
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  if (authSection) authSection.classList.remove('active');
  if (appSection) appSection.classList.add('active');
  
  if (currentUser) {
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
      userInfo.textContent = `Logged in as ${currentUser.username}`;
    }
  }
  
  loadNotifications();
}

function showLogin(): void {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (loginForm) loginForm.style.display = 'block';
  if (registerForm) registerForm.style.display = 'none';
}

function showRegister(): void {
  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  if (loginForm) loginForm.style.display = 'none';
  if (registerForm) registerForm.style.display = 'block';
}

function switchTab(tabName: string, event: Event): void {
  // Update tab buttons
  document.querySelectorAll('.tab').forEach(tab => tab.classList.remove('active'));
  (event.target as HTMLElement).classList.add('active');

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
  
  if (tabName === 'notifications') {
    const tab = document.getElementById('notificationsTab');
    if (tab) tab.classList.add('active');
    loadNotifications();
  } else if (tabName === 'logs') {
    const tab = document.getElementById('logsTab');
    if (tab) tab.classList.add('active');
    loadLogs();
  }
}

function logout(): void {
  authToken = null;
  currentUser = null;
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  showAuth();
  showLogin();
}

function showError(elementId: string, message: string): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 5000);
  }
}

function showSuccess(elementId: string, message: string): void {
  const element = document.getElementById(elementId);
  if (element) {
    element.textContent = message;
    element.classList.remove('hidden');
    setTimeout(() => element.classList.add('hidden'), 5000);
  }
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

interface DebugInfo {
  apiBaseUrl: string;
  viteApiUrl: string;
  currentUrl: string;
  hostname: string;
  protocol: string;
  userAgent: string;
  serviceWorkerSupported: boolean;
  notificationSupported: boolean;
  pushManagerSupported: boolean;
  localStorageAvailable: boolean;
  currentUser: User | null;
  hasAuthToken: boolean;
  vapidPublicKey: string;
  timestamp: string;
}

function showDebugPage(): void {
  const container = document.querySelector('.container');
  if (!container) return;

  const debugInfo: DebugInfo = {
    apiBaseUrl: API_BASE_URL,
    viteApiUrl: import.meta.env.VITE_API_URL || 'not set',
    currentUrl: window.location.href,
    hostname: window.location.hostname,
    protocol: window.location.protocol,
    userAgent: navigator.userAgent,
    serviceWorkerSupported: 'serviceWorker' in navigator,
    notificationSupported: 'Notification' in window,
    pushManagerSupported: 'PushManager' in window,
    localStorageAvailable: typeof Storage !== 'undefined',
    currentUser: currentUser,
    hasAuthToken: !!authToken,
    vapidPublicKey: vapidPublicKey || 'not loaded',
    timestamp: new Date().toISOString()
  };

  container.innerHTML = `
    <div class="header">
      <h1>🔧 Debug Information</h1>
      <p style="margin-top: 10px;"><a href="/" style="color: white; text-decoration: underline;">← Back to App</a></p>
    </div>
    <div class="content">
      <h2 style="margin-bottom: 20px;">Configuration</h2>
      <div class="debug-section">
        <div class="debug-item">
          <strong>API Base URL (in use):</strong>
          <code style="background: #e3f2fd; color: #1976d2; font-weight: bold;">${escapeHtml(debugInfo.apiBaseUrl)}</code>
          <p style="font-size: 12px; color: #666; margin-top: 5px;">
            ${debugInfo.hostname === 'localhost' || debugInfo.hostname === '127.0.0.1' || !debugInfo.hostname
              ? 'Using env var or localhost (local access)'
              : `Built from runtime hostname: ${debugInfo.hostname}:3000`}
          </p>
        </div>
        <div class="debug-item">
          <strong>VITE_API_URL (env):</strong>
          <code>${escapeHtml(debugInfo.viteApiUrl)}</code>
          ${debugInfo.hostname !== 'localhost' && debugInfo.hostname !== '127.0.0.1' && debugInfo.hostname
            ? '<p style="font-size: 12px; color: #ff9800; margin-top: 5px;">⚠️ Ignored (using runtime hostname instead)</p>'
            : '<p style="font-size: 12px; color: #666; margin-top: 5px;">Used when hostname is localhost</p>'}
        </div>
        <div class="debug-item">
          <strong>Current URL:</strong>
          <code>${escapeHtml(debugInfo.currentUrl)}</code>
        </div>
        <div class="debug-item">
          <strong>Hostname:</strong>
          <code>${escapeHtml(debugInfo.hostname)}</code>
        </div>
        <div class="debug-item">
          <strong>Protocol:</strong>
          <code>${escapeHtml(debugInfo.protocol)}</code>
        </div>
        <div class="debug-item">
          <strong>Expected API URL:</strong>
          <code>${escapeHtml(`${debugInfo.protocol}//${debugInfo.hostname}:3000`)}</code>
        </div>
      </div>

      <h2 style="margin-top: 30px; margin-bottom: 20px;">Browser Capabilities</h2>
      <div class="debug-section">
        <div class="debug-item">
          <strong>Service Worker:</strong>
          <span class="badge ${debugInfo.serviceWorkerSupported ? 'success' : 'error'}">
            ${debugInfo.serviceWorkerSupported ? '✓ Supported' : '✗ Not Supported'}
          </span>
        </div>
        <div class="debug-item">
          <strong>Notifications:</strong>
          <span class="badge ${debugInfo.notificationSupported ? 'success' : 'error'}">
            ${debugInfo.notificationSupported ? '✓ Supported' : '✗ Not Supported'}
          </span>
        </div>
        <div class="debug-item">
          <strong>Push Manager:</strong>
          <span class="badge ${debugInfo.pushManagerSupported ? 'success' : 'error'}">
            ${debugInfo.pushManagerSupported ? '✓ Supported' : '✗ Not Supported'}
          </span>
        </div>
        <div class="debug-item">
          <strong>Local Storage:</strong>
          <span class="badge ${debugInfo.localStorageAvailable ? 'success' : 'error'}">
            ${debugInfo.localStorageAvailable ? '✓ Available' : '✗ Not Available'}
          </span>
        </div>
      </div>

      <h2 style="margin-top: 30px; margin-bottom: 20px;">Authentication</h2>
      <div class="debug-section">
        <div class="debug-item">
          <strong>Logged In:</strong>
          <span class="badge ${debugInfo.hasAuthToken ? 'success' : 'warning'}">
            ${debugInfo.hasAuthToken ? '✓ Yes' : '✗ No'}
          </span>
        </div>
        <div class="debug-item">
          <strong>User:</strong>
          <code>${debugInfo.currentUser ? JSON.stringify(debugInfo.currentUser, null, 2) : 'Not logged in'}</code>
        </div>
        <div class="debug-item">
          <strong>VAPID Public Key:</strong>
          <code style="word-break: break-all;">${escapeHtml(debugInfo.vapidPublicKey)}</code>
        </div>
      </div>

      <h2 style="margin-top: 30px; margin-bottom: 20px;">System Info</h2>
      <div class="debug-section">
        <div class="debug-item">
          <strong>User Agent:</strong>
          <code style="word-break: break-all; font-size: 12px;">${escapeHtml(debugInfo.userAgent)}</code>
        </div>
        <div class="debug-item">
          <strong>Timestamp:</strong>
          <code>${escapeHtml(debugInfo.timestamp)}</code>
        </div>
      </div>

      <div style="margin-top: 30px; padding: 15px; background: #f5f5f5; border-radius: 8px;">
        <h3 style="margin-bottom: 10px;">API Test</h3>
        <button class="btn btn-primary" onclick="testApiConnection()">Test API Connection</button>
        <div id="apiTestResult" style="margin-top: 10px;"></div>
      </div>
    </div>
  `;
}

async function testApiConnection(): Promise<void> {
  const resultDiv = document.getElementById('apiTestResult');
  if (!resultDiv) return;

  resultDiv.innerHTML = '<p style="color: #666;">Testing...</p>';

  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    const data = await response.json();
    resultDiv.innerHTML = `
      <div class="success" style="margin-top: 10px;">
        <strong>✓ Connection Successful!</strong><br>
        Status: ${response.status}<br>
        Response: ${JSON.stringify(data)}
      </div>
    `;
  } catch (error) {
    const err = error as Error;
    resultDiv.innerHTML = `
      <div class="error" style="margin-top: 10px;">
        <strong>✗ Connection Failed</strong><br>
        Error: ${escapeHtml(err.message)}
      </div>
    `;
  }
}

// Make functions globally available
(window as any).showLogin = showLogin;
(window as any).showRegister = showRegister;
(window as any).switchTab = (tabName: string) => switchTab(tabName, window.event!);
(window as any).logout = logout;
(window as any).deleteNotification = deleteNotification;
(window as any).testApiConnection = testApiConnection;


