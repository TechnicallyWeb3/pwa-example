import { db } from './connection.js';

export async function initializeDatabase(): Promise<void> {
  try {
    // Create users table
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        password_hash VARCHAR(255),
        google_id VARCHAR(255) UNIQUE,
        name VARCHAR(255),
        profile_image_url TEXT,
        google_access_token TEXT,
        google_refresh_token TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Add indexes for Google OAuth
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id)
    `);

    // Create notifications table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        body TEXT NOT NULL,
        scheduled_time TIMESTAMP NOT NULL,
        repeat_daily BOOLEAN DEFAULT FALSE,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create notification_logs table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_logs (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        status VARCHAR(50) NOT NULL,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        error_message TEXT
      )
    `);

    // Create push_subscriptions table
    await db.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        endpoint TEXT NOT NULL,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, endpoint)
      )
    `);

    // Create notification_replies table
    await db.query(`
      CREATE TABLE IF NOT EXISTS notification_replies (
        id SERIAL PRIMARY KEY,
        notification_id INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
        notification_log_id INTEGER REFERENCES notification_logs(id) ON DELETE SET NULL,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        reply_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create chats table
    await db.query(`
      CREATE TABLE IF NOT EXISTS chats (
        chat_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create messages table
    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        reply_to UUID REFERENCES messages(message_id) ON DELETE SET NULL,
        reply_source VARCHAR(255),
        chat_id UUID REFERENCES chats(chat_id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        "from" VARCHAR(20) NOT NULL CHECK ("from" IN ('user', 'assistant')),
        timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        related_events JSONB DEFAULT '[]'::jsonb,
        trigger VARCHAR(255),
        trigger_source VARCHAR(255),
        notify JSONB DEFAULT '[]'::jsonb,
        message TEXT NOT NULL
      )
    `);

    // Add user_id column if it doesn't exist (migration for existing tables)
    await db.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'messages' AND column_name = 'user_id'
        ) THEN
          ALTER TABLE messages ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
        END IF;
        
        -- Update any NULL user_id values (shouldn't happen, but safety check)
        -- Get user_id from the chat if message doesn't have one
        UPDATE messages m
        SET user_id = c.user_id
        FROM chats c
        WHERE m.chat_id = c.chat_id
        AND m.user_id IS NULL;
        
        -- Now make it required
        ALTER TABLE messages ALTER COLUMN user_id SET NOT NULL;
      EXCEPTION
        WHEN OTHERS THEN
          -- If setting NOT NULL fails, log but don't crash
          RAISE NOTICE 'Could not set user_id to NOT NULL: %', SQLERRM;
      END $$;
    `);

    // Add branch tracking columns for message editing/branching
    await db.query(`
      DO $$ 
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'messages' AND column_name = 'parent_message_id'
        ) THEN
          ALTER TABLE messages ADD COLUMN parent_message_id UUID REFERENCES messages(message_id) ON DELETE SET NULL;
        END IF;
        
        IF NOT EXISTS (
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = 'messages' AND column_name = 'branch_index'
        ) THEN
          ALTER TABLE messages ADD COLUMN branch_index INTEGER DEFAULT 1;
        END IF;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE NOTICE 'Could not add branch columns: %', SQLERRM;
      END $$;
    `);

    // Add indexes for better query performance
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_chat_id ON messages(chat_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_reply_to ON messages(reply_to)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_messages_parent_message_id ON messages(parent_message_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_user_id ON chats(user_id)
    `);
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_chats_updated_at ON chats(updated_at)
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
  }
}


