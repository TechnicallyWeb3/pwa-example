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
  parent_message_id?: string | null;
  branch_index?: number;
}

/**
 * Get branch information for a chat
 * Returns which messages have branches and how many branches each has
 */
async function getBranchInfo(chatId: string, userId: number): Promise<Record<string, { branchCount: number; currentBranch: number }>> {
  try {
    // Get all user messages and count how many branches each has
    // A branch is created when a message is edited (parent_message_id points to original)
    const result = await db.query(
      `SELECT 
        m1.message_id,
        COUNT(DISTINCT COALESCE(m2.branch_index, 1)) as branch_count,
        MAX(COALESCE(m2.branch_index, 1)) as max_branch
       FROM messages m1
       LEFT JOIN messages m2 ON m2.parent_message_id = m1.message_id
       WHERE m1.chat_id = $1 
         AND m1."from" = 'user'
       GROUP BY m1.message_id
       HAVING COUNT(DISTINCT COALESCE(m2.branch_index, 1)) > 0`,
      [chatId]
    );

    const branchInfo: Record<string, { branchCount: number; currentBranch: number }> = {};
    
    for (const row of result.rows) {
      const branchCount = parseInt(row.branch_count, 10);
      // If branch_count is 0, it means no branches (just the original), so count = 1
      // Otherwise, count includes the original (branch_index 1) + edits
      const totalBranches = branchCount === 0 ? 1 : branchCount;
      branchInfo[row.message_id] = {
        branchCount: totalBranches,
        currentBranch: parseInt(row.max_branch, 10) || 1,
      };
    }

    return branchInfo;
  } catch (error) {
    console.error('Error getting branch info:', error);
    return {};
  }
}

/**
 * Load conversation by following reply chain from latest message
 * This loads all messages in a chat, optionally filtered by branch
 */
async function loadConversationChain(chatId: string, userId: number, branchIndex: number | null = null): Promise<Message[]> {
  try {
    // Get all messages in the chat ordered by timestamp
    // Filter by branch if branchIndex is provided (for branch navigation)
    // If no branch specified, get messages in the main branch (branch_index = 1 or NULL)
    let query = `
      SELECT message_id, reply_to, reply_source, chat_id, "from", 
             timestamp, related_events, trigger, trigger_source, notify, message,
             parent_message_id, branch_index
      FROM messages 
      WHERE chat_id = $1
    `;
    
    const params: any[] = [chatId];
    
    // If branchIndex is specified, filter to show only messages in that branch
    // A message is in a branch if:
    // 1. It has no parent_message_id (it's before any branch point)
    // 2. It's in the specified branch (all messages after a branch point follow the branch)
    if (branchIndex !== null && branchIndex !== 1) {
      // For now, we'll load all messages and filter in code
      // This is simpler - we'll filter messages that belong to the specified branch
    }
    
    query += ' ORDER BY timestamp ASC';
    
    const result = await db.query(query, params);

    if (result.rows.length === 0) {
      return [];
    }

    // Map rows to Message objects
    let allMessages: Message[] = result.rows.map(row => ({
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
      parent_message_id: row.parent_message_id,
      branch_index: row.branch_index || 1,
    }));

    // Filter by branch if specified
    // If branchIndex is null, default to main branch (1)
    const effectiveBranchIndex = branchIndex === null ? 1 : branchIndex;
    
    if (effectiveBranchIndex === 1) {
      // For main branch, exclude all edited messages (messages with parent_message_id)
      // Only show original messages
      return allMessages.filter(msg => !msg.parent_message_id);
    } else {
      // Find all messages that belong to this branch
      // A message belongs to a branch if:
      // 1. It has no parent_message_id (it's before any branch point) - always include
      // 2. It has parent_message_id and branch_index matching the requested branch
      // 3. It's part of the reply chain after a message in this branch (recursively)
      
      const messagesInBranch: Message[] = [];
      const branchMessageIds = new Set<string>();
      
      // First pass: identify all messages that are directly in this branch
      for (const msg of allMessages) {
        if (!msg.parent_message_id) {
          // Messages before any branch point are always included
          messagesInBranch.push(msg);
          branchMessageIds.add(msg.message_id);
        } else if (msg.branch_index === effectiveBranchIndex) {
          // This message is directly in the requested branch
          messagesInBranch.push(msg);
          branchMessageIds.add(msg.message_id);
        }
      }
      
      // Recursively follow reply chains to include all messages in this branch
      let changed = true;
      while (changed) {
        changed = false;
        for (const msg of allMessages) {
          // Skip if already included
          if (branchMessageIds.has(msg.message_id)) {
            continue;
          }
          
          // Include if it replies to a message in our branch
          // Check both reply_to and branch_index to ensure it's in the right branch
          if (msg.reply_to && branchMessageIds.has(msg.reply_to)) {
            // If it has a parent_message_id, it must match the branch
            // If it doesn't have a parent_message_id, it's before any branch (shouldn't happen here)
            if (!msg.parent_message_id || msg.branch_index === effectiveBranchIndex) {
              messagesInBranch.push(msg);
              branchMessageIds.add(msg.message_id);
              changed = true;
            }
          }
        }
      }
      
      // Sort by timestamp to maintain chronological order
      messagesInBranch.sort((a, b) => 
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
      );
      
      return messagesInBranch;
    }

    return allMessages;
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
 * Optional query param: branchIndex - filter by branch index (default: main branch)
 */
router.get('/chats/:chatId', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { chatId } = req.params;
    const branchIndex = req.query.branchIndex ? parseInt(req.query.branchIndex as string, 10) : null;

    // Verify chat belongs to user
    const chatCheck = await db.query(
      'SELECT chat_id FROM chats WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.userId]
    );

    if (chatCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = await loadConversationChain(chatId, req.user.userId, branchIndex);
    
    // Get branch information for user messages
    const branchInfo = await getBranchInfo(chatId, req.user.userId);
    
    res.json({ chatId, messages, branchInfo });
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

    // Save user message (default branch_index is 1 for main branch)
    const userMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to, related_events, trigger, trigger_source, branch_index)
       VALUES ($1, $2, 'user', $3, $4, $5::jsonb, $6, $7, 1)
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

    // Save assistant message (same branch as the user message)
    const assistantMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to, branch_index)
       VALUES ($1, $2, 'assistant', $3, $4, 1)
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

/**
 * Edit a message and create a new branch
 */
router.post('/chats/:chatId/messages/:messageId/edit', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    const { chatId, messageId } = req.params;
    const { newMessage } = req.body;

    if (!newMessage || typeof newMessage !== 'string') {
      return res.status(400).json({ error: 'newMessage is required' });
    }

    // Verify chat belongs to user
    const chatCheck = await db.query(
      'SELECT chat_id FROM chats WHERE chat_id = $1 AND user_id = $2',
      [chatId, req.user.userId]
    );

    if (chatCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    // Verify the message exists and belongs to the user
    const messageCheck = await db.query(
      'SELECT message_id, "from" FROM messages WHERE message_id = $1 AND chat_id = $2 AND user_id = $3',
      [messageId, chatId, req.user.userId]
    );

    if (messageCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }

    if (messageCheck.rows[0].from !== 'user') {
      return res.status(400).json({ error: 'Only user messages can be edited' });
    }

    // Get the current branch index for this message
    const branchResult = await db.query(
      `SELECT COALESCE(MAX(branch_index), 0) + 1 as next_branch_index
       FROM messages 
       WHERE parent_message_id = $1 OR message_id = $1`,
      [messageId]
    );

    const nextBranchIndex = parseInt(branchResult.rows[0]?.next_branch_index || '2', 10);

    // Get the original message to find what it was replying to
    const originalMessage = await db.query(
      'SELECT reply_to FROM messages WHERE message_id = $1',
      [messageId]
    );
    const originalReplyTo = originalMessage.rows[0]?.reply_to || null;

    // Create new user message with edited content
    const editedMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to, parent_message_id, branch_index)
       VALUES ($1, $2, 'user', $3, $4, $5, $6)
       RETURNING message_id, timestamp`,
      [chatId, req.user.userId, newMessage, originalReplyTo, messageId, nextBranchIndex]
    );

    const editedMessageId = editedMessageResult.rows[0].message_id;

    // Load conversation history up to the edited message in the same branch
    // We need to get messages before the branch point, then the edited message
    const conversationHistory = await loadConversationChain(chatId, req.user.userId, nextBranchIndex);
    
    // Get messages before the edited message (for context)
    const messagesBeforeEdit = conversationHistory.filter(msg => 
      msg.message_id !== editedMessageId
    );
    
    const chatHistory: ChatMessage[] = messagesBeforeEdit.map(msg => ({
      role: msg.from,
      content: msg.message,
    }));

    // Get AI response to the edited message
    let aiResponse: string;
    try {
      aiResponse = await chatWithGemini(newMessage, chatHistory);
    } catch (error: any) {
      console.error('Error getting AI response:', error);
      throw new Error(`Failed to get AI response: ${error.message || 'Unknown error'}`);
    }

    // Save assistant response in the same branch
    const assistantMessageResult = await db.query(
      `INSERT INTO messages (chat_id, user_id, "from", message, reply_to, parent_message_id, branch_index)
       VALUES ($1, $2, 'assistant', $3, $4, $5, $6)
       RETURNING message_id, timestamp`,
      [chatId, req.user.userId, aiResponse, editedMessageId, messageId, nextBranchIndex]
    );

    // Update chat updated_at
    await db.query(
      'UPDATE chats SET updated_at = CURRENT_TIMESTAMP WHERE chat_id = $1',
      [chatId]
    );

    res.json({
      editedMessage: {
        message_id: editedMessageId,
        timestamp: editedMessageResult.rows[0].timestamp,
      },
      assistantMessage: {
        message_id: assistantMessageResult.rows[0].message_id,
        message: aiResponse,
        timestamp: assistantMessageResult.rows[0].timestamp,
      },
      branchIndex: nextBranchIndex,
    });
  } catch (error: any) {
    console.error('Error editing message:', error);
    res.status(500).json({ 
      error: 'Failed to edit message',
      message: error.message 
    });
  }
});

export default router;

