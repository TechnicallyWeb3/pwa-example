import webpush from 'web-push';
import { db } from '../db/connection.js';

export async function sendPushNotification(userId, notification) {
  try {
    // Get user's push subscriptions
    const subscriptions = await db.query(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = $1',
      [userId]
    );

    if (subscriptions.rows.length === 0) {
      console.log(`⚠️ No push subscriptions found for user ${userId} - notification will not be sent`);
      // Still log this as a failed attempt
      await db.query(
        `INSERT INTO notification_logs (notification_id, user_id, status, error_message)
         VALUES ($1, $2, 'failed', $3)`,
        [notification.id, userId, 'No push subscription found for user']
      ).catch(err => console.error('Error logging missing subscription:', err));
      return { sent: 0, failed: 0 };
    }
    
    console.log(`📱 Found ${subscriptions.rows.length} push subscription(s) for user ${userId}`);

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png'
    });

    let sent = 0;
    let failed = 0;

    // Send to all subscriptions
    for (const sub of subscriptions.rows) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint,
          keys: {
            p256dh: sub.p256dh,
            auth: sub.auth
          }
        };

        await webpush.sendNotification(pushSubscription, payload);
        sent++;

        // Log success
        await db.query(
          `INSERT INTO notification_logs (notification_id, user_id, status)
           VALUES ($1, $2, 'sent')`,
          [notification.id, userId]
        );
      } catch (error) {
        failed++;
        console.error('Push notification error:', error);

        // Log failure
        await db.query(
          `INSERT INTO notification_logs (notification_id, user_id, status, error_message)
           VALUES ($1, $2, 'failed', $3)`,
          [notification.id, userId, error.message]
        );

        // Remove invalid subscription
        if (error.statusCode === 410 || error.statusCode === 404) {
          await db.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1',
            [sub.endpoint]
          );
        }
      }
    }

    return { sent, failed };
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
}

