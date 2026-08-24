export interface Message {
  id: string;
  role: 'user' | 'agent' | 'tool';
  content: string;
  toolName?: string;
  isStreaming?: boolean;
}

export interface Thread {
  thread_id: string;
  updated_at?: string;
  metadata?: {
    title?: string;
    [key: string]: any;
  };
  values?: {
    messages?: any[];
  } | null;
  [key: string]: any;
}
