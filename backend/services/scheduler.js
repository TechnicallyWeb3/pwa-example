import cron from 'node-cron';
import { db } from '../db/connection.js';
import { sendPushNotification } from './pushNotification.js';

export function initializeCronJobs() {
  // Check for notifications to send every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const oneMinuteFromNow = new Date(now.getTime() + 60000);

      // Find notifications scheduled within the next minute
      const notifications = await db.query(
        `SELECT * FROM notifications
         WHERE is_active = true
         AND scheduled_time >= $1
         AND scheduled_time <= $2`,
        [now, oneMinuteFromNow]
      );

      for (const notification of notifications.rows) {
        await sendPushNotification(notification.user_id, notification);

        // If it's a daily repeat, update the scheduled time for next day
        if (notification.repeat_daily) {
          const nextDay = new Date(notification.scheduled_time);
          nextDay.setDate(nextDay.getDate() + 1);
          
          await db.query(
            'UPDATE notifications SET scheduled_time = $1 WHERE id = $2',
            [nextDay, notification.id]
          );
        } else {
          // Mark as inactive if not repeating
          await db.query(
            'UPDATE notifications SET is_active = false WHERE id = $1',
            [notification.id]
          );
        }
      }
    } catch (error) {
      console.error('Cron job error:', error);
    }
  });

  console.log('Cron jobs initialized');
}

