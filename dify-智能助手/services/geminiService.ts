import { GoogleGenAI, Chat, GenerateContentResponse } from "@google/genai";
import { Message, Role } from "../types";

// Initialize the client. API Key is injected via process.env
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

// Convert internal message format to Gemini's history format
const formatHistory = (messages: Message[]) => {
  return messages.map((msg) => ({
    role: msg.role === Role.User ? 'user' : 'model',
    parts: [{ text: msg.content }],
  }));
};

/**
 * Sends a message to the Gemini API and streams the response.
 * 
 * @param modelName The model to use for generation
 * @param history Previous chat history
 * @param newMessage The new message from the user
 * @param onChunk Callback function for each streaming chunk
 * @returns The full generated text
 */
export const streamGeminiResponse = async (
  modelName: string,
  history: Message[],
  newMessage: string,
  onChunk: (text: string) => void
): Promise<string> => {
  try {
    const chat: Chat = ai.chats.create({
      model: modelName,
      config: {
        systemInstruction: `You are a helpful, witty, and knowledgeable AI assistant embedded in a mobile H5 application. 
        - Keep your responses concise and easy to read on mobile screens.
        - You can formatting using Markdown (bold, lists, code blocks).
        - If the user asks for images, you can display them using Markdown image syntax: ![Alt Text](https://picsum.photos/400/300?random=1).
        - Be friendly and engaging.`,
      },
      history: formatHistory(history),
    });

    const result = await chat.sendMessageStream({ message: newMessage });
    
    let fullText = '';
    
    for await (const chunk of result) {
      const c = chunk as GenerateContentResponse;
      const text = c.text;
      if (text) {
        fullText += text;
        onChunk(fullText);
      }
    }
    
    return fullText;
  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};
