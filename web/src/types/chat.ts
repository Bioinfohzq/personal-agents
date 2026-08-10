export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  isStreaming?: boolean;
}

export interface Thread {
  thread_id: string;
  updated_at?: string;
  [key: string]: any;
}
