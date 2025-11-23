import cron from 'node-cron';
import { db } from '../db/connection.js';
import { sendPushNotification } from './pushNotification.js';

export function initializeCronJobs() {
  // Check for notifications to send every minute
  cron.schedule('* * * * *', async () => {
    try {
      const now = new Date();
      const oneMinuteFromNow = new Date(now.getTime() + 60000);

      console.log(`⏰ Cron job running - Checking notifications between ${now.toISOString()} and ${oneMinuteFromNow.toISOString()}`);

      // Find notifications that are due now or coming up soon
      // Check for notifications scheduled up to 5 minutes in the past (to catch missed ones)
      // and up to 1 minute in the future
      const fiveMinutesAgo = new Date(now.getTime() - 5 * 60000);
      
      const notifications = await db.query(
        `SELECT * FROM notifications
         WHERE is_active = true
         AND scheduled_time >= $1
         AND scheduled_time <= $2
         ORDER BY scheduled_time ASC`,
        [fiveMinutesAgo, oneMinuteFromNow]
      );

      console.log(`🔍 Found ${notifications.rows.length} active notification(s) in range (${oneMinuteAgo.toISOString()} to ${oneMinuteFromNow.toISOString()})`);
      
      // Log details of found notifications
      if (notifications.rows.length > 0) {
        notifications.rows.forEach(n => {
          const timeDiff = Math.round((new Date(n.scheduled_time) - now) / 1000);
          console.log(`   - ID ${n.id}: "${n.title}" scheduled for ${n.scheduled_time} (${timeDiff > 0 ? `in ${timeDiff}s` : `${Math.abs(timeDiff)}s ago`})`);
        });
      }

      if (notifications.rows.length > 0) {
        console.log(`⏰ Cron job: Found ${notifications.rows.length} notification(s) to send`);
      }

      for (const notification of notifications.rows) {
        console.log(`🔔 Activating notification - ID: ${notification.id}, User: ${notification.user_id}, Title: "${notification.title}", Scheduled: ${notification.scheduled_time}`);
        
        const result = await sendPushNotification(notification.user_id, notification);
        console.log(`📤 Notification sent - ID: ${notification.id}, Sent: ${result.sent}, Failed: ${result.failed}`);

        // If it's a daily repeat, update the scheduled time for next day
        if (notification.repeat_daily) {
          const nextDay = new Date(notification.scheduled_time);
          nextDay.setDate(nextDay.getDate() + 1);
          
          await db.query(
            'UPDATE notifications SET scheduled_time = $1 WHERE id = $2',
            [nextDay, notification.id]
          );
          console.log(`🔄 Daily notification rescheduled - ID: ${notification.id}, Next: ${nextDay}`);
        } else {
          // Mark as inactive if not repeating
          await db.query(
            'UPDATE notifications SET is_active = false WHERE id = $1',
            [notification.id]
          );
          console.log(`✅ One-time notification completed - ID: ${notification.id}, marked inactive`);
        }
      }
    } catch (error) {
      console.error('Cron job error:', error);
    }
  });

  console.log('Cron jobs initialized - Will check every minute for notifications');
  
  // Log a test run immediately
  setTimeout(async () => {
    try {
      const activeCount = await db.query('SELECT COUNT(*) as count FROM notifications WHERE is_active = true');
      console.log(`📊 Currently ${activeCount.rows[0].count} active notification(s) in database`);
      
      const upcomingCount = await db.query(
        `SELECT COUNT(*) as count FROM notifications 
         WHERE is_active = true AND scheduled_time > NOW() 
         ORDER BY scheduled_time LIMIT 5`
      );
      if (upcomingCount.rows[0].count > 0) {
        const upcoming = await db.query(
          `SELECT id, title, scheduled_time FROM notifications 
           WHERE is_active = true AND scheduled_time > NOW() 
           ORDER BY scheduled_time LIMIT 5`
        );
        console.log('📅 Upcoming notifications:');
        upcoming.rows.forEach(n => {
          console.log(`   - ID ${n.id}: "${n.title}" at ${n.scheduled_time}`);
        });
      }
    } catch (error) {
      console.error('Error checking notifications:', error);
    }
  }, 2000);
}

