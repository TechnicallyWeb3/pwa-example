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

/**
 * Generate a chat title from the first message
 */
export async function generateChatTitle(firstMessage: string): Promise<string> {
  try {
    if (!genAI) {
      throw new Error('Gemini API key not configured');
    }

    const model = genAI.getGenerativeModel({ 
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 500, // Increased to avoid MAX_TOKENS truncation
      },
    } as any);

    const prompt = `This is the first message in an AI chat window: "${firstMessage}"

Please create a concise, descriptive title for this conversation. The title should be 10-50 characters long. Return only the title, nothing else.`;

    const result = await model.generateContent(prompt);
    const response = await result.response;
    
    // Check for blocked responses
    if (response.candidates && response.candidates.length > 0) {
      const candidate = response.candidates[0];
      if (candidate.finishReason && candidate.finishReason !== 'STOP') {
        console.error('Response blocked. Finish reason:', candidate.finishReason);
        console.error('Safety ratings:', candidate.safetyRatings);
      }
    }
    
    // Try to get text using the text() method first (same as chat function)
    let text: string;
    try {
      text = response.text().trim();
    } catch (textError: any) {
      // If text() method fails, try accessing candidates directly
      console.log('text() method failed, trying candidates:', textError.message);
      
      if (!response.candidates || response.candidates.length === 0) {
        console.error('No candidates in Gemini response');
        console.error('Full response:', JSON.stringify(response, null, 2));
        throw new Error('No response candidates from Gemini');
      }

      const candidate = response.candidates[0];
      if (!candidate.content || !candidate.content.parts || candidate.content.parts.length === 0) {
        console.error('No content parts in Gemini response candidate');
        console.error('Candidate:', JSON.stringify(candidate, null, 2));
        throw new Error('No content in Gemini response');
      }

      // Get text from the first part
      text = candidate.content.parts[0].text?.trim() || '';
    }
    
    if (!text) {
      console.error('Empty text in Gemini response.');
      console.error('Response structure:', JSON.stringify({
        candidates: response.candidates,
        promptFeedback: (response as any).promptFeedback,
      }, null, 2));
      throw new Error('No title generated from Gemini');
    }

    console.log('Generated title from Gemini:', text);

    // Ensure title is within 10-50 characters
    let title = text;
    if (title.length > 50) {
      title = title.substring(0, 47) + '...';
    } else if (title.length < 10) {
      // If too short, use a truncated version of the original message
      title = firstMessage.substring(0, Math.min(50, firstMessage.length));
      if (title.length > 50) {
        title = title.substring(0, 47) + '...';
      }
    }

    return title;
  } catch (error: any) {
    console.error('❌ Title generation error:', error.message || error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    // Re-throw the error so the caller can handle it
    throw error;
  }
}

