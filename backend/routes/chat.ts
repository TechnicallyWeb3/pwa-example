import express, { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { db } from '../db/connection.js';
import { authenticateToken, AuthRequest } from './auth.js';
import { chatWithGemini, generateChatTitle, ChatMessage } from '../services/gemini.js';

const router = express.Router();

export interface Message {
  message_id: string;
  reply_to?: string | null;
  reply_source?: string | null;
  chat_id: string;
  from: 'user' | 'assistant';
  timestamp: Date;
  relatedEvents: any[];
  trigger?: string | null;
  trigger_source?: string | null;
  notify: any[];
  message: string;
}

/**
 * Load conversation by following reply chain from latest message
 * This loads all messages in a chat by following the reply chain backwards
 */
async function loadConversationChain(chatId: string, userId: number): Promise<Message[]> {
  try {
    // Get all messages in the chat ordered by timestamp
    // This is simpler and ensures we get all messages in chronological order
    const result = await db.query(
      `SELECT message_id, reply_to, reply_source, chat_id, "from", 
              timestamp, related_events, trigger, trigger_source, notify, message
       FROM messages 
       WHERE chat_id = $1
       ORDER BY timestamp ASC`,
      [chatId]
    );

    if (result.rows.length === 0) {
      return [];
    }

    // Map rows to Message objects
    const messages: Message[] = result.rows.map(row => ({
      message_id: row.message_id,
      reply_to: row.reply_to,
      reply_source: row.reply_source,
      chat_id: row.chat_id,
      from: row.from,
      timestamp: row.timestamp,
      relatedEvents: row.related_events || [],
      trigger: row.trigger,
      trigger_source: row.trigger_source,
      notify: row.notify || [],
      message: row.message,
    }));

    return messages;
  } catch (error) {
    console.error('Error loading conversation chain:', error);
    throw error;
  }
}

/**
 * Get all chats for a user
 */
router.get('/chats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const result = await db.query(
      `SELECT chat_id, title, updated_at, 
              (SELECT COUNT(*) FROM messages WHERE messages.chat_id = chats.chat_id) as message_count
       FROM chats 
       WHERE user_id = $1 
       ORDER BY updated_at DESC`,
      [req.user.userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching chats:', error);
    res.status(500).json({ error: 'Failed to fetch chats' });
  }
});

/**
 * Get conversation for a specific chat
 */
router.get('/chats/:chatId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { chatId } = req.params;

    // Verify chat belongs to user
    const chatCheck = await db.query(
      'SELECT chat_id FROM chats WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.userId]
    );

    if (chatCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = await loadConversationChain(chatId, req.user.userId);
    res.json({ chatId, messages });
  } catch (error) {
    console.error('Error loading conversation:', error);
    res.status(500).json({ error: 'Failed to load conversation' });
  }
});

/**
 * Send a message and get AI response
 */
router.post('/chats/:chatId/messages', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { chatId } = req.params;
    const { message, replyTo, relatedEvents, trigger, triggerSource } = req.body;

    if (!message || typeof message !== 'string') {
      return res.status(400).json({ error: 'Message is required' });
    }

    // Verify or create chat
    let chatResult = await db.query(
      'SELECT chat_id, title FROM chats WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.userId]
    );

    let isFirstMessage = false;
    let chatTitle = 'New Chat';
    
    if (chatResult.rows.length === 0) {
      // This is a new chat - generate title BEFORE creating it
      isFirstMessage = true;
      try {
        console.log('🔄 Generating title for new chat before creation...');
        chatTitle = await generateChatTitle(message);
        console.log(`✅ Title generated before chat creation: "${chatTitle}"`);
      } catch (error: any) {
        console.error('❌ Error generating title before chat creation, using fallback:', error.message || error);
        chatTitle = message.substring(0, 50);
        console.log(`📝 Using fallback title: "${chatTitle}"`);
      }
      
      // Create new chat with generated title
      await db.query(
        'INSERT INTO chats (chat_id, user_id, title) VALUES ($1, $2, $3)',
        [chatId, req.user.userId, chatTitle]
      );
      console.log(`💾 Created new chat with title: "${chatTitle}"`);
    } else {
      // Check if this is the first message
      const existingTitle = chatResult.rows[0].title;
      const messageCountResult = await db.query(
        'SELECT COUNT(*) as count FROM messages WHERE chat_id = $1 AND "from" = $2',
        [chatId, 'user']
      );
      const userMessageCount = parseInt(messageCountResult.rows[0].count, 10);
      
      // If this is the first user message and title is "New Chat", generate a proper title
      isFirstMessage = userMessageCount === 0;
      
      if (isFirstMessage && (existingTitle === 'New Chat' || !existingTitle || existingTitle.trim() === '')) {
        // Generate title for existing chat that needs title update
        try {
          console.log('🔄 Generating title for existing chat (first message)...');
          chatTitle = await generateChatTitle(message);
          console.log(`✅ Title generated: "${chatTitle}"`);
        } catch (error: any) {
          console.error('❌ Error generating title, using fallback:', error.message || error);
          chatTitle = message.substring(0, 50);
          console.log(`📝 Using fallback title: "${chatTitle}"`);
        }
        
        // Update title
        await db.query(
          'UPDATE chats SET title = $1 WHERE chat_id = $2',
          [chatTitle, chatId]
        );
        console.log(`💾 Updated chat title to: "${chatTitle}"`);
      }
    }

    // Save user message
    const userMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to, related_events, trigger, trigger_source)
       VALUES ($1, $2, 'user', $3, $4, $5::jsonb, $6, $7)
       RETURNING message_id, timestamp`,
      [
        chatId,
        req.user.userId,
        message,
        replyTo || null,
        JSON.stringify(relatedEvents || []),
        trigger || null,
        triggerSource || null,
      ]
    );

    const userMessageId = userMessageResult.rows[0].message_id;

    // Load conversation history for context (excluding the message we just saved)
    const conversationHistory = await loadConversationChain(chatId, req.user.userId);
    // Filter out the message we just saved to avoid duplication
    const previousMessages = conversationHistory.filter(msg => msg.message_id !== userMessageId);
    const chatHistory: ChatMessage[] = previousMessages.map(msg => ({
      role: msg.from,
      content: msg.message,
    }));

    // Get AI response
    let aiResponse: string;
    try {
      aiResponse = await chatWithGemini(message, chatHistory);
    } catch (error: any) {
      console.error('Error getting AI response:', error);
      throw new Error(`Failed to get AI response: ${error.message || 'Unknown error'}`);
    }

    // Save assistant message
    const assistantMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to)
       VALUES ($1, $2, 'assistant', $3, $4)
       RETURNING message_id, timestamp`,
      [chatId, req.user.userId, aiResponse, userMessageId]
    );

    // Update chat updated_at
    await db.query(
      'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE chat_id = $1',
      [chatId]
    );

    res.json({
      userMessage: {
        message_id: userMessageId,
        timestamp: userMessageResult.rows[0].timestamp,
      },
      assistantMessage: {
        message_id: assistantMessageResult.rows[0].message_id,
        message: aiResponse,
        timestamp: assistantMessageResult.rows[0].timestamp,
      },
    });
  } catch (error: any) {
    console.error('Error sending message:', error);
    res.status(500).json({ 
      error: 'Failed to send message',
      message: error.message 
    });
  }
});

/**
 * Create a new chat
 */
router.post('/chats', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { title, chat_id } = req.body;
    // Use provided chat_id or generate new one
    const chatId = chat_id || randomUUID();

    await db.query(
      'INSERT INTO chats (chat_id, user_id, title) VALUES ($1, $2, $3)',
      [chatId, req.user.userId, title || 'New Chat']
    );

    res.json({ chatId, title: title || 'New Chat' });
  } catch (error) {
    console.error('Error creating chat:', error);
    res.status(500).json({ error: 'Failed to create chat' });
  }
});

export default router;

