export type MessageRole = 'user' | 'agent';

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
}

export interface ChatThread {
  thread_id: string;
  updated_at?: string;
  created_at?: string;
}
