import webpush from 'web-push';
import { db } from '../db/connection.js';

interface Notification {
  id: number;
  title: string;
  body: string;
}

export async function sendPushNotification(
  userId: number,
  notification: Notification
): Promise<{ sent: number; failed: number }> {
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
      ).catch((err: Error) => console.error('Error logging missing subscription:', err));
      return { sent: 0, failed: 0 };
    }
    
    console.log(`📱 Found ${subscriptions.rows.length} push subscription(s) for user ${userId}`);

    // Create a log entry first to get the log ID
    const logResult = await db.query(
      `INSERT INTO notification_logs (notification_id, user_id, status)
       VALUES ($1, $2, 'pending')
       RETURNING id`,
      [notification.id, userId]
    );
    const logId = logResult.rows[0].id;

    const payload = JSON.stringify({
      title: notification.title,
      body: notification.body,
      icon: '/icon-192x192.png',
      badge: '/icon-192x192.png',
      data: {
        notificationId: notification.id,
        notificationLogId: logId,
        userId: userId
      },
      actions: [
        {
          action: 'reply',
          title: 'Reply',
          type: 'text',
          placeholder: 'Type your reply...'
        },
        {
          action: 'view',
          title: 'View'
        }
      ],
      requireInteraction: false,
      // Add tag to help identify notifications
      tag: `notification-${notification.id}`
    });
    
    console.log('📤 Sending notification payload:', payload);

    let sent = 0;
    let failed = 0;

    // Send to all subscriptions
    for (const sub of subscriptions.rows) {
      try {
        const pushSubscription = {
          endpoint: sub.endpoint as string,
          keys: {
            p256dh: sub.p256dh as string,
            auth: sub.auth as string
          }
        };

        await webpush.sendNotification(pushSubscription, payload);
        sent++;
      } catch (error) {
        failed++;
        const err = error as any;
        console.error('Push notification error:', err);

        // Remove invalid subscription
        if (err.statusCode === 410 || err.statusCode === 404) {
          await db.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1',
            [sub.endpoint]
          );
        }
      }
    }

    // Update log entry with final status
    if (sent > 0) {
      await db.query(
        `UPDATE notification_logs SET status = 'sent' WHERE id = $1`,
        [logId]
      );
    } else if (failed > 0) {
      await db.query(
        `UPDATE notification_logs SET status = 'failed', error_message = $1 WHERE id = $2`,
        ['All subscription attempts failed', logId]
      );
    }

    return { sent, failed };
  } catch (error) {
    console.error('Error sending push notification:', error);
    throw error;
  }
}

