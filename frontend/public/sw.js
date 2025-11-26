self.addEventListener('push', event => {
  console.log('📬 Push event received');
  const data = event.data ? event.data.json() : {};
  console.log('📬 Push data:', data);
  
  const options = {
    body: data.body,
    icon: data.icon || '/icon-192x192.png',
    badge: data.badge || '/icon-192x192.png',
    vibrate: [200, 100, 200],
    tag: 'notification',
    requireInteraction: data.requireInteraction || false,
    data: data.data || {},
    actions: data.actions || []
  };

  console.log('📬 Notification options:', options);
  console.log('📬 Actions:', options.actions);

  event.waitUntil(
    self.registration.showNotification(data.title || 'Notification', options).then(() => {
      console.log('✅ Notification shown successfully');
    }).catch(err => {
      console.error('❌ Error showing notification:', err);
    })
  );
});

self.addEventListener('notificationclick', event => {
  console.log('🖱️ Notification click event received');
  console.log('🖱️ Action:', event.action);
  console.log('🖱️ Notification data:', event.notification.data);
  console.log('🖱️ Reply text (if any):', event.reply);
  
  event.notification.close();
  
  // If the action is 'reply', we need to handle it
  // Note: The notificationreply event should fire for text replies, but if it doesn't,
  // we can try to get the reply from event.reply (though this might not be available in notificationclick)
  if (event.action === 'reply') {
    console.log('💬 Reply action detected in notificationclick');
    const notificationData = event.notification.data || {};
    
    // Check if reply text is available in notificationclick (might not be in all browsers)
    const replyText = event.reply;
    
    console.log('💬 Reply text from notificationclick:', replyText);
    console.log('💬 Notification data:', notificationData);
    
    if (replyText && notificationData.notificationId) {
      console.log('💬 Processing reply from notificationclick (fallback):', { 
        notificationId: notificationData.notificationId, 
        replyText 
      });
      // Handle reply here as fallback
      event.waitUntil(
        handleReply(notificationData.notificationId, notificationData.notificationLogId, replyText)
      );
    } else {
      console.warn('⚠️ Reply action clicked but no reply text available in notificationclick event');
      console.warn('⚠️ This might mean notificationreply event should be used instead');
      // Open app so user can reply there as fallback
      event.waitUntil(
        clients.openWindow(`/?replyTo=${notificationData.notificationId}`)
      );
    }
  } else {
    // If the action is not 'reply', open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
});

// Helper function to handle replies (used by both notificationreply and notificationclick)
async function handleReply(notificationId, notificationLogId, replyText) {
  console.log('💬 handleReply called:', { notificationId, notificationLogId, replyText });
  
  if (!notificationId || !replyText) {
    console.error('❌ Missing notification ID or reply text', { notificationId, replyText });
    return;
  }

  try {
    // Try to send message to any open client to handle the reply
    const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
    
    if (clients.length > 0) {
      console.log(`📤 Found ${clients.length} client(s), sending reply to focused client first`);
      
      // Try to find a focused client first
      let targetClient = null;
      for (const client of clients) {
        if (client.focused) {
          targetClient = client;
          break;
        }
      }
      
      // If no focused client, use the first one
      if (!targetClient) {
        targetClient = clients[0];
      }
      
      console.log('📤 Posting message to client:', { type: 'NOTIFICATION_REPLY', notificationId, notificationLogId });
      targetClient.postMessage({
        type: 'NOTIFICATION_REPLY',
        notificationId: notificationId,
        notificationLogId: notificationLogId,
        replyText: replyText
      });
    } else {
      console.log('💾 No clients open, storing reply in IndexedDB');
      // No client open, store reply in IndexedDB for later processing
      try {
        const db = await openDB();
        const transaction = db.transaction('pendingReplies', 'readwrite');
        const store = transaction.objectStore('pendingReplies');
        await store.add({
          notificationId: notificationId,
          notificationLogId: notificationLogId,
          replyText: replyText,
          timestamp: Date.now()
        });
        db.close();
        console.log('✅ Reply stored for later processing');
      } catch (dbError) {
        console.error('❌ Error storing reply:', dbError);
      }
    }
  } catch (error) {
    console.error('❌ Error handling notification reply:', error);
  }
}

self.addEventListener('notificationreply', event => {
  console.log('🔔 Notification reply event received (this is the preferred event)');
  const notificationData = event.notification.data || {};
  const replyText = event.reply;
  const notificationId = notificationData.notificationId;
  const notificationLogId = notificationData.notificationLogId;

  console.log('📋 Reply data:', { notificationId, notificationLogId, replyText, notificationData });

  event.waitUntil(
    handleReply(notificationId, notificationLogId, replyText)
  );
});

// Helper function to open IndexedDB
function openDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('pwa-notifications', 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('pendingReplies')) {
        const objectStore = db.createObjectStore('pendingReplies', { keyPath: 'timestamp' });
        objectStore.createIndex('notificationId', 'notificationId', { unique: false });
      }
    };
  });
}

// Log available notification APIs
console.log('🔍 Service Worker initialized');
console.log('🔍 NotificationReplyEvent support:', typeof NotificationReplyEvent !== 'undefined');
console.log('🔍 ServiceWorkerRegistration.showNotification support:', typeof self.registration.showNotification === 'function');

self.addEventListener('install', event => {
  console.log('🔧 Service Worker installing');
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  console.log('🔧 Service Worker activating');
  event.waitUntil(clients.claim());
});

