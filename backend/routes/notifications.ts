import express, { Request, Response } from 'express';
import { db } from '../db/connection.js';
import { authenticateToken, AuthRequest } from './auth.js';
import webpush from 'web-push';

const router = express.Router();

// Initialize VAPID keys (should be set via environment variables)
const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY || '';
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY || '';
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

// Get VAPID public key
router.get('/vapid-public-key', (req: Request, res: Response) => {
  res.json({ publicKey: VAPID_PUBLIC_KEY });
});

// Save push subscription
router.post('/subscribe', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { subscription } = req.body;
    const userId = req.user!.userId;

    if (!subscription || !subscription.endpoint || !subscription.keys) {
      return res.status(400).json({ error: 'Invalid subscription object' });
    }

    await db.query(
      `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, endpoint) DO UPDATE
       SET p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
      [userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth]
    );

    res.json({ success: true });
  } catch (error) {
    console.error('Subscribe error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create notification
router.post('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { title, body, scheduled_time, repeat_daily } = req.body;
    const userId = req.user!.userId;

    if (!title || !body || !scheduled_time) {
      return res.status(400).json({ error: 'Title, body, and scheduled_time are required' });
    }

    const result = await db.query(
      `INSERT INTO notifications (user_id, title, body, scheduled_time, repeat_daily)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, title, body, scheduled_time, repeat_daily || false]
    );

    const notification = result.rows[0];
    console.log(`📅 Notification created - ID: ${notification.id}, User: ${userId}, Title: "${notification.title}", Scheduled: ${notification.scheduled_time}, Repeat Daily: ${notification.repeat_daily}`);

    res.status(201).json(notification);
  } catch (error) {
    console.error('Create notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get user's notifications
router.get('/', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const result = await db.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY scheduled_time DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get notifications error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update notification
router.put('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { title, body, scheduled_time, repeat_daily, is_active } = req.body;
    const userId = req.user!.userId;

    const result = await db.query(
      `UPDATE notifications
       SET title = COALESCE($1, title),
           body = COALESCE($2, body),
           scheduled_time = COALESCE($3, scheduled_time),
           repeat_daily = COALESCE($4, repeat_daily),
           is_active = COALESCE($5, is_active)
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [title, body, scheduled_time, repeat_daily, is_active, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    const notification = result.rows[0];
    if (is_active !== undefined) {
      console.log(`🔄 Notification ${is_active ? 'activated' : 'deactivated'} - ID: ${notification.id}, User: ${userId}, Title: "${notification.title}"`);
    } else {
      console.log(`✏️ Notification updated - ID: ${notification.id}, User: ${userId}, Title: "${notification.title}"`);
    }

    res.json(notification);
  } catch (error) {
    console.error('Update notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete notification
router.delete('/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user!.userId;

    const result = await db.query(
      'DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Notification not found' });
    }

    res.json({ success: true });
  } catch (error) {
    console.error('Delete notification error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get notification logs
router.get('/logs', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    const result = await db.query(
      `SELECT nl.*, n.title, n.body
       FROM notification_logs nl
       JOIN notifications n ON nl.notification_id = n.id
       WHERE nl.user_id = $1
       ORDER BY nl.sent_at DESC
       LIMIT 100`,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;


