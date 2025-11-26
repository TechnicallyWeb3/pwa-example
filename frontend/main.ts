// Use runtime hostname when available (for network access from other devices)
// Fallback to environment variable or localhost
function getApiBaseUrl(): string {
  const port = import.meta.env.VITE_PORT || 3001;

  if (typeof window !== 'undefined' && window.location && window.location.hostname) {
    const hostname = window.location.hostname;
    const protocol = window.location.protocol;
    
    if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '') {
      return import.meta.env.VITE_API_URL || `http://localhost:${port}`;
    }
    
    return `${protocol}//${hostname}:${port}`;
  }
  
  return import.meta.env.VITE_API_URL || `http://localhost:${port}`;
}

const API_BASE_URL = getApiBaseUrl();

interface User {
  id: number;
  email: string;
  name?: string;
  profileImageUrl?: string;
}

interface Chat {
  chat_id: string;
  title: string;
  updated_at: string;
  message_count: number;
}

interface Message {
  message_id: string;
  reply_to?: string | null;
  reply_source?: string | null;
  chat_id: string;
  user_id?: number;
  from: 'user' | 'assistant';
  timestamp: Date | string;
  relatedEvents: any[];
  trigger?: string | null;
  trigger_source?: string | null;
  notify: any[];
  message: string;
}

let currentUser: User | null = null;
let authToken: string | null = null;
let currentChatId: string | null = null;
let chats: Chat[] = [];
let messages: Message[] = [];
let isWaitingForResponse = false;

// Helper function to handle 401 responses
function handleAuthError(response: Response): boolean {
  if (response.status === 401) {
    console.warn('Unauthorized - clearing token and redirecting to login');
    logout();
    return true;
  }
  return false;
}

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
    verifyTokenAndShowApp();
  } else {
    showAuth();
  }

  // Setup install prompt
  setupInstallPrompt();

  // Setup service worker for push notifications
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').then(_registration => {
      console.log('Service Worker registered');
    });
  }

  // Setup Google Sign-In
  setupGoogleSignIn();
  setupChatForm();
  
  // Check for OAuth callback
  handleOAuthCallback();
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

function setupGoogleSignIn(): void {
  const googleSignInBtn = document.getElementById('googleSignInBtn');
  if (googleSignInBtn) {
    googleSignInBtn.addEventListener('click', async () => {
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/google`);
        const data = await response.json();

        if (response.ok && data.authUrl) {
          window.location.href = data.authUrl;
        } else {
          showError('authError', data.error || 'Failed to initiate Google Sign-In');
        }
      } catch (error) {
        console.error('Google Sign-In error:', error);
        showError('authError', 'Network error. Please try again.');
      }
    });
  }
}

function handleOAuthCallback(): void {
  const urlParams = new URLSearchParams(window.location.search);
  const token = urlParams.get('token');
  const userParam = urlParams.get('user');
  const error = urlParams.get('error');

  if (error) {
    showError('authError', 'Authentication failed. Please try again.');
    window.history.replaceState({}, document.title, window.location.pathname);
    return;
  }

  if (token && userParam) {
    try {
      authToken = token;
      currentUser = JSON.parse(decodeURIComponent(userParam));
      
      if (authToken) {
        localStorage.setItem('authToken', authToken);
      }
      if (currentUser) {
        localStorage.setItem('currentUser', JSON.stringify(currentUser));
      }

      window.history.replaceState({}, document.title, window.location.pathname);
      showApp();
    } catch (error) {
      console.error('Error parsing OAuth callback:', error);
      showError('authError', 'Failed to process authentication');
    }
  }
}

function setupChatForm(): void {
  const form = document.getElementById('chatForm');
  const input = document.getElementById('messageInput') as HTMLInputElement;
  
  if (form) {
    form.addEventListener('submit', async (e: Event) => {
      e.preventDefault();
      
      if (!input || !input.value.trim()) {
        return;
      }

      const messageText = input.value.trim();
      input.value = '';
      
      await sendMessage(messageText);
    });
  }
}

async function sendMessage(messageText: string): Promise<void> {
  if (!authToken || isWaitingForResponse) {
    console.log('Cannot send message:', { hasAuth: !!authToken, isWaiting: isWaitingForResponse });
    return;
  }

  // Create a new chat if we don't have one
  if (!currentChatId) {
    console.log('No current chat, creating new chat...');
    try {
      const createResponse = await fetch(`${API_BASE_URL}/api/chat/chats`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${authToken}`
        },
        body: JSON.stringify({ title: messageText.substring(0, 50) || 'New Chat' })
      });

      console.log('Chat creation response status:', createResponse.status);

      if (handleAuthError(createResponse)) {
        console.error('Auth error during chat creation');
        // Clean up - auth error will have logged out, so we're done
        return;
      }

      if (!createResponse.ok) {
        const errorText = await createResponse.text();
        let errorData;
        try {
          errorData = JSON.parse(errorText);
        } catch {
          errorData = { error: errorText || 'Failed to create chat' };
        }
        console.error('Chat creation failed:', errorData);
        throw new Error(errorData.error || 'Failed to create chat');
      }

      const chatData = await createResponse.json();
      console.log('Chat created successfully:', chatData);
      
      if (!chatData.chatId) {
        console.error('Chat creation succeeded but no chatId in response:', chatData);
        alert('Failed to create chat: No chat ID returned');
        return;
      }
      
      currentChatId = chatData.chatId;
      messages = [];
      
      // Load chats in background (don't wait for it)
      loadChats().catch(err => console.error('Error loading chats:', err));
      
      console.log('Current chat ID set to:', currentChatId);
    } catch (error: any) {
      console.error('Error creating chat:', error);
      alert(`Failed to create chat: ${error.message || 'Unknown error'}`);
      return;
    }
  }

  // Double check we have a chat ID before proceeding
  if (!currentChatId) {
    console.error('No chat ID available after creation attempt');
    alert('Failed to start chat. Please try again.');
    return;
  }

  // Add user message to UI immediately
  const userMessage: Message = {
    message_id: 'temp-' + Date.now(),
    chat_id: currentChatId!,
    from: 'user',
    timestamp: new Date(),
    relatedEvents: [],
    notify: [],
    message: messageText,
  };
  messages.push(userMessage);
  renderMessages();
  
  // Show typing indicator and disable input
  isWaitingForResponse = true;
  showTypingIndicator();
  const input = document.getElementById('messageInput') as HTMLInputElement;
  const sendBtn = document.querySelector('.send-btn') as HTMLButtonElement;
  if (input) input.disabled = true;
  if (sendBtn) sendBtn.disabled = true;

  try {
    console.log('Sending message to chat:', currentChatId);
    const response = await fetch(`${API_BASE_URL}/api/chat/chats/${currentChatId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ message: messageText })
    });

    console.log('Message send response status:', response.status);

    if (handleAuthError(response)) {
      // Clean up on auth error (logout was called)
      isWaitingForResponse = false;
      hideTypingIndicator();
      const input = document.getElementById('messageInput') as HTMLInputElement;
      const sendBtn = document.querySelector('.send-btn') as HTMLButtonElement;
      if (input) input.disabled = false;
      if (sendBtn) sendBtn.disabled = false;
      return;
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to send message');
    }

    const data = await response.json();
    
    // Remove temp message and add real ones
    messages = messages.filter(m => !m.message_id.startsWith('temp-'));
    
    // Add user message
    const newUserMessage: Message = {
      message_id: data.userMessage.message_id,
      chat_id: currentChatId,
      from: 'user',
      timestamp: data.userMessage.timestamp,
      relatedEvents: [],
      notify: [],
      message: messageText,
    };
    messages.push(newUserMessage);

    // Add assistant message
    const assistantMessage: Message = {
      message_id: data.assistantMessage.message_id,
      chat_id: currentChatId,
      from: 'assistant',
      timestamp: data.assistantMessage.timestamp,
      relatedEvents: [],
      notify: [],
      message: data.assistantMessage.message,
      reply_to: data.userMessage.message_id,
    };
    messages.push(assistantMessage);

    renderMessages();
    await loadChats(); // Refresh chat list
  } catch (error: any) {
    console.error('Error sending message:', error);
    // Remove temp message on error
    messages = messages.filter(m => !m.message_id.startsWith('temp-'));
    renderMessages();
    hideTypingIndicator();
    alert(`Failed to send message: ${error.message}`);
  } finally {
    isWaitingForResponse = false;
    hideTypingIndicator();
    const input = document.getElementById('messageInput') as HTMLInputElement;
    const sendBtn = document.querySelector('.send-btn') as HTMLButtonElement;
    if (input) {
      input.disabled = false;
      input.focus();
    }
    if (sendBtn) sendBtn.disabled = false;
  }
}

async function loadChats(): Promise<void> {
  if (!authToken) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/chats`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (handleAuthError(response)) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to load chats: ${response.status}`);
    }

    chats = await response.json();
    renderChatSidebar();
  } catch (error) {
    console.error('Error loading chats:', error);
  }
}

async function loadChat(chatId: string): Promise<void> {
  if (!authToken) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/chats/${chatId}`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (handleAuthError(response)) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to load chat: ${response.status}`);
    }

    const data = await response.json();
    currentChatId = chatId;
    messages = data.messages || [];
    renderMessages();
    renderChatSidebar();
  } catch (error) {
    console.error('Error loading chat:', error);
  }
}

async function createNewChat(): Promise<void> {
  if (!authToken) return;

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/chats`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`
      },
      body: JSON.stringify({ title: 'New Chat' })
    });

    if (handleAuthError(response)) {
      return;
    }

    if (!response.ok) {
      throw new Error(`Failed to create chat: ${response.status}`);
    }

    const data = await response.json();
    currentChatId = data.chatId;
    messages = [];
    renderMessages();
    await loadChats();
  } catch (error) {
    console.error('Error creating chat:', error);
  }
}

function renderChatSidebar(): void {
  const sidebar = document.getElementById('chatSidebar');
  if (!sidebar) return;

  // Only render the chat list, not the header (header is in HTML)
  sidebar.innerHTML = `
    ${chats.map(chat => `
      <div class="chat-item ${chat.chat_id === currentChatId ? 'active' : ''}" 
           onclick="loadChat('${chat.chat_id}')">
        <div class="chat-title">${escapeHtml(chat.title || 'Untitled')}</div>
        <div class="chat-meta">
          ${new Date(chat.updated_at).toLocaleDateString()} • ${chat.message_count || 0} messages
        </div>
      </div>
    `).join('')}
    ${chats.length === 0 ? '<div class="empty-state">No chats yet. Send a message to get started!</div>' : ''}
  `;
}

function renderMessages(): void {
  const messagesContainer = document.getElementById('messagesContainer');
  if (!messagesContainer) return;

  if (messages.length === 0) {
    messagesContainer.innerHTML = `
      <div class="empty-chat">
        <h3>Start a conversation</h3>
        <p>Send a message to begin chatting with the AI assistant.</p>
      </div>
    `;
    return;
  }

  messagesContainer.innerHTML = messages.map(msg => {
    const isUser = msg.from === 'user';
    const timestamp = new Date(msg.timestamp).toLocaleTimeString();
    const messageHtml = isUser ? escapeHtml(msg.message) : markdownToHtml(msg.message);
    
    return `
      <div class="message ${isUser ? 'user' : 'assistant'}">
        <div class="message-content">
          ${messageHtml}
        </div>
        <div class="message-time">${timestamp}</div>
      </div>
    `;
  }).join('');

  // Scroll to bottom
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function showAuth(): void {
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  if (authSection) authSection.classList.add('active');
  if (appSection) appSection.classList.remove('active');
}

async function verifyTokenAndShowApp(): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/chats`, {
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    if (response.status === 401) {
      logout();
      return;
    }

    showApp();
  } catch (error) {
    console.error('Error verifying token:', error);
    logout();
  }
}

function showApp(): void {
  const authSection = document.getElementById('authSection');
  const appSection = document.getElementById('appSection');
  if (authSection) authSection.classList.remove('active');
  if (appSection) appSection.classList.add('active');
  
  if (currentUser) {
    const userInfo = document.getElementById('userInfo');
    if (userInfo) {
      const displayName = currentUser.name || currentUser.email;
      userInfo.textContent = `Logged in as ${displayName}`;
    }
  }
  
  loadChats();
  
  // Load the most recent chat if one exists, otherwise show empty state
  if (chats.length > 0 && !currentChatId) {
    loadChat(chats[0].chat_id);
  } else {
    // No chats exist - show empty state, chat will be created on first message
    currentChatId = null;
    messages = [];
    renderMessages();
  }
}

function logout(): void {
  authToken = null;
  currentUser = null;
  currentChatId = null;
  chats = [];
  messages = [];
  localStorage.removeItem('authToken');
  localStorage.removeItem('currentUser');
  showAuth();
}

function showError(elementId: string, message: string): void {
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

// Simple markdown to HTML converter
function markdownToHtml(text: string): string {
  // Escape HTML first
  let html = escapeHtml(text);
  
  // Convert markdown patterns
  // Bold: **text** or __text__
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/__(.+?)__/g, '<strong>$1</strong>');
  
  // Italic: *text* or _text_
  html = html.replace(/\*(.+?)\*/g, '<em>$1</em>');
  html = html.replace(/_(.+?)_/g, '<em>$1</em>');
  
  // Code blocks: ```code```
  html = html.replace(/```([\s\S]*?)```/g, '<pre><code>$1</code></pre>');
  
  // Inline code: `code`
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  
  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  
  // Headers: # Header, ## Header, etc.
  html = html.replace(/^### (.+)$/gm, '<h3>$1</h3>');
  html = html.replace(/^## (.+)$/gm, '<h2>$1</h2>');
  html = html.replace(/^# (.+)$/gm, '<h1>$1</h1>');
  
  // Lists: Process line by line to handle nested lists
  const lines = html.split('\n');
  let inList = false;
  let listType = '';
  const processedLines: string[] = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const listMatch = line.match(/^(\d+\.|\*|\-|\+)\s+(.+)$/);
    
    if (listMatch) {
      const currentListType = listMatch[1].match(/^\d+\./) ? 'ol' : 'ul';
      
      if (!inList) {
        inList = true;
        listType = currentListType;
        processedLines.push(`<${listType}>`);
      } else if (listType !== currentListType) {
        processedLines.push(`</${listType}>`);
        listType = currentListType;
        processedLines.push(`<${listType}>`);
      }
      
      processedLines.push(`<li>${listMatch[2]}</li>`);
    } else {
      if (inList) {
        processedLines.push(`</${listType}>`);
        inList = false;
      }
      processedLines.push(line);
    }
  }
  
  if (inList) {
    processedLines.push(`</${listType}>`);
  }
  
  html = processedLines.join('\n');
  
  // Line breaks: double newline = paragraph break
  html = html.split('\n\n').map(para => {
    para = para.trim();
    if (!para) return '';
    // Don't wrap if it's already a block element
    if (para.match(/^<(h[1-6]|pre|ul|ol|li)/)) {
      return para;
    }
    return `<p>${para}</p>`;
  }).join('');
  
  // Clean up empty paragraphs and fix nested structures
  html = html.replace(/<p><\/p>/g, '');
  html = html.replace(/<p>(<[^>]+>)/g, '$1');
  html = html.replace(/(<\/[^>]+>)<\/p>/g, '$1');
  
  return html;
}

function showTypingIndicator(): void {
  const messagesContainer = document.getElementById('messagesContainer');
  if (!messagesContainer) return;
  
  const typingIndicator = document.createElement('div');
  typingIndicator.id = 'typingIndicator';
  typingIndicator.className = 'message assistant typing-indicator';
  typingIndicator.innerHTML = `
    <div class="message-content">
      <span class="typing-dots">
        <span></span>
        <span></span>
        <span></span>
      </span>
    </div>
  `;
  messagesContainer.appendChild(typingIndicator);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function hideTypingIndicator(): void {
  const typingIndicator = document.getElementById('typingIndicator');
  if (typingIndicator) {
    typingIndicator.remove();
  }
}

// Debug page (simplified)
function showDebugPage(): void {
  const container = document.querySelector('.container');
  if (!container) return;

  container.innerHTML = `
    <div class="header">
      <h1>🔧 Debug Information</h1>
      <p style="margin-top: 10px;"><a href="/" style="color: white; text-decoration: underline;">← Back to App</a></p>
    </div>
    <div class="content">
      <h2>Configuration</h2>
      <div class="debug-section">
        <div class="debug-item">
          <strong>API Base URL:</strong>
          <code>${escapeHtml(API_BASE_URL)}</code>
        </div>
        <div class="debug-item">
          <strong>Current URL:</strong>
          <code>${escapeHtml(window.location.href)}</code>
        </div>
      </div>
    </div>
  `;
}

// Make functions globally available
(window as any).createNewChat = createNewChat;
(window as any).loadChat = loadChat;
(window as any).logout = logout;
