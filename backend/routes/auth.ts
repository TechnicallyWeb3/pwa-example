import express, { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { google } from 'googleapis';
import { db } from '../db/connection.js';
import { googleConfig, serverConfig } from '../app.config.js';

const router = express.Router();

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    email: string;
    name?: string;
  };
}

// Initialize Google OAuth2 client
const oauth2Client = new google.auth.OAuth2(
  googleConfig.clientId,
  googleConfig.clientSecret,
  googleConfig.redirectUri
);

// Generate Google OAuth URL
router.get('/google', (req: Request, res: Response) => {
  if (!googleConfig.clientId || !googleConfig.clientSecret) {
    return res.status(500).json({ 
      error: 'Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.' 
    });
  }

  const scopes = [
    'https://www.googleapis.com/auth/userinfo.profile',
    'https://www.googleapis.com/auth/userinfo.email',
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events',
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent', // Force consent screen to get refresh token
  });

  res.json({ authUrl });
});

// Google OAuth callback
router.get('/google/callback', async (req: Request, res: Response) => {
  try {
    if (!googleConfig.clientId || !googleConfig.clientSecret) {
      const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
      return res.redirect(`${frontendUrl}?error=oauth_not_configured`);
    }

    const { code } = req.query;

    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Authorization code is required' });
    }

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    
    if (!tokens.access_token) {
      return res.status(400).json({ error: 'Failed to get access token' });
    }

    // Set credentials to get user info
    oauth2Client.setCredentials(tokens);

    // Get user profile
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const { data: profile } = await oauth2.userinfo.get();

    if (!profile.email) {
      return res.status(400).json({ error: 'Email not provided by Google' });
    }

    const googleId = profile.id || '';
    const email = profile.email;
    const name = profile.name || '';
    const profileImageUrl = profile.picture || null;

    // Find or create user
    let userResult = await db.query(
      'SELECT id, email, name, profile_image_url FROM users WHERE google_id = $1 OR email = $2',
      [googleId, email]
    );

    let user;
    if (userResult.rows.length > 0) {
      // User exists, update their info
      user = userResult.rows[0];
      await db.query(
        `UPDATE users 
         SET google_id = $1, name = $2, profile_image_url = $3, 
             google_access_token = $4, google_refresh_token = $5
         WHERE id = $6`,
        [
          googleId,
          name,
          profileImageUrl,
          tokens.access_token,
          tokens.refresh_token || null,
          user.id,
        ]
      );
    } else {
      // Create new user
      const insertResult = await db.query(
        `INSERT INTO users (google_id, email, name, profile_image_url, google_access_token, google_refresh_token)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, email, name, profile_image_url`,
        [
          googleId,
          email,
          name,
          profileImageUrl,
          tokens.access_token,
          tokens.refresh_token || null,
        ]
      );
      user = insertResult.rows[0];
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, name: user.name },
      serverConfig.jwtSecret,
      { expiresIn: '7d' }
    );

    // Redirect to frontend with token
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?token=${token}&user=${encodeURIComponent(JSON.stringify({
      id: user.id,
      email: user.email,
      name: user.name,
      profileImageUrl: user.profile_image_url,
    }))}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    res.redirect(`${frontendUrl}?error=authentication_failed`);
  }
});

// Get current user info
router.get('/me', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await db.query(
      'SELECT id, email, name, profile_image_url, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];
    res.json({
      id: user.id,
      email: user.email,
      name: user.name,
      profileImageUrl: user.profile_image_url,
      createdAt: user.created_at,
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Logout (client-side token removal, but we can invalidate refresh tokens here if needed)
router.post('/logout', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    // Optionally revoke Google tokens
    if (req.user) {
      const userResult = await db.query(
        'SELECT google_refresh_token FROM users WHERE id = $1',
        [req.user.userId]
      );

      if (userResult.rows.length > 0 && userResult.rows[0].google_refresh_token) {
        try {
          oauth2Client.setCredentials({
            refresh_token: userResult.rows[0].google_refresh_token,
          });
          await oauth2Client.revokeCredentials();
        } catch (error) {
          console.error('Error revoking Google tokens:', error);
        }
      }
    }

    res.json({ message: 'Logged out successfully' });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Middleware to verify token
export async function authenticateToken(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  jwt.verify(token, serverConfig.jwtSecret, async (err, decoded) => {
    if (err) {
      res.status(403).json({ error: 'Invalid or expired token' });
      return;
    }

    const decodedUser = decoded as { userId: number; email: string; name?: string };

    // Verify user still exists in database
    try {
      const userCheck = await db.query('SELECT id, email, name FROM users WHERE id = $1', [
        decodedUser.userId,
      ]);
      if (userCheck.rows.length === 0) {
        res.status(401).json({ error: 'User not found. Please log in again.' });
        return;
      }
      req.user = {
        userId: userCheck.rows[0].id,
        email: userCheck.rows[0].email,
        name: userCheck.rows[0].name,
      };
      next();
    } catch (error) {
      console.error('Error verifying user:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}

// Helper function to get Google OAuth client for a user (for calendar operations)
export async function getGoogleAuthClient(userId: number) {
  const result = await db.query(
    'SELECT google_access_token, google_refresh_token FROM users WHERE id = $1',
    [userId]
  );

  if (result.rows.length === 0 || !result.rows[0].google_access_token) {
    throw new Error('User not authenticated with Google');
  }

  const userTokens = result.rows[0];
  const client = new google.auth.OAuth2(
    googleConfig.clientId,
    googleConfig.clientSecret,
    googleConfig.redirectUri
  );

  client.setCredentials({
    access_token: userTokens.google_access_token,
    refresh_token: userTokens.google_refresh_token,
  });

  return client;
}

export default router;
