import { Message, Role } from "../types";

/**
 * Sends a message to the OpenAI API (or compatible) and streams the response.
 * 
 * @param modelName The model to use (e.g., 'gpt-3.5-turbo')
 * @param history Previous chat history
 * @param newMessage The new message from the user
 * @param onChunk Callback function for each streaming chunk
 * @returns The full generated text
 */
export const streamOpenAIResponse = async (
  modelName: string,
  history: Message[],
  newMessage: string,
  onChunk: (text: string) => void
): Promise<string> => {
  const apiKey = process.env.OPENAI_API_KEY;
  
  // Map internal message format to OpenAI format
  const messages = history.map(msg => ({
    role: msg.role === Role.User ? 'user' : 'assistant',
    content: msg.content
  }));
  
  // Add the new message
  messages.push({ role: 'user', content: newMessage });

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey || ''}`
    },
    body: JSON.stringify({
      model: modelName,
      messages: messages,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenAI API Error: ${response.status} - ${errText}`);
  }

  if (!response.body) throw new Error("ReadableStream not supported in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let fullText = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || ''; // Keep the last incomplete line in the buffer

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      
      const data = trimmed.slice(6);
      if (data === '[DONE]') break;

      try {
        const parsed = JSON.parse(data);
        const content = parsed.choices[0]?.delta?.content || '';
        if (content) {
          fullText += content;
          onChunk(fullText);
        }
      } catch (e) {
        console.warn('Error parsing OpenAI stream chunk:', e);
      }
    }
  }

  return fullText;
};
