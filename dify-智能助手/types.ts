
export enum Role {
  User = 'user',
  Model = 'assistant', // Dify 通常称 AI 为 assistant
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  timestamp: number;
  isStreaming?: boolean;
}

export interface ChatState {
  messages: Message[];
  isLoading: boolean;
  error: string | null;
}
