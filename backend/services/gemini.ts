import { GoogleGenerativeAI } from '@google/generative-ai';
import { googleConfig } from '../app.config.js';

const genAI = googleConfig.geminiApiKey 
  ? new GoogleGenerativeAI(googleConfig.geminiApiKey) 
  : null;

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export async function chatWithGemini(
  message: string,
  conversationHistory: ChatMessage[] = []
): Promise<string> {
  try {
    if (!genAI) {
      throw new Error('Gemini API key not configured');
    }

    const systemInstruction = `You are a helpful AI assistant. Be friendly, concise, and helpful.`;

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      systemInstruction: systemInstruction,
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 2000,
      },
    } as any);

    // Build conversation history
    const history = conversationHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.content }],
    }));

    // Start chat session with history
    const chat = model.startChat({
      history: history.length > 0 ? history : undefined,
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    const text = response.text();

    if (!text) {
      throw new Error('No response from Gemini');
    }

    return text;
  } catch (error: any) {
    console.error('Chat error:', error.message || error);
    throw new Error(`Failed to get response from AI: ${error.message || 'Unknown error'}`);
  }
}

