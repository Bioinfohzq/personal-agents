import { useState, useRef, useEffect } from 'react';
import { client } from './api/client';
import { clearStoredSession, readStoredSession, type AuthSession } from './api/auth';
import type { Message, Thread } from './types/chat';

// Components
import { Sidebar } from './components/Sidebar/Sidebar';
import { Header } from './components/Header/Header';
import { MessageList } from './components/Chat/MessageList';
import { InputArea } from './components/Chat/InputArea';
import { LoginPage } from './components/Auth/LoginPage';

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession());
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // 历史会话管理状态
  const [threadId, setThreadId] = useState<string | null>(null);
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 拉取历史会话列表
  const fetchThreads = async () => {
    try {
      const results = await client.threads.search({ limit: 50 });
      setThreads(results as Thread[]);
      return results;
    } catch (err) {
      console.error('Failed to fetch threads:', err);
      return [];
    }
  };

  // 加载指定会话的历史消息
  const loadThread = async (id: string) => {
    setThreadId(id);
    setIsLoading(true);
    try {
      const state = await client.threads.getState(id);
      const stateValues = state.values as any;
      const historyMessages = stateValues?.messages || [];
      
      const formattedMessages: Message[] = historyMessages.map((m: any, idx: number) => ({
        id: m.id || idx.toString(),
        role: (m.type === 'human' || m.role === 'user') ? 'user' : 'agent',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
      }));

      if (formattedMessages.length === 0) {
        setMessages([{
          id: Date.now().toString(),
          role: 'agent',
          content: '你好！我是你的AI助理。这是一个空白的历史会话，请问有什么可以帮您？',
        }]);
      } else {
        setMessages(formattedMessages);
      }
    } catch (err) {
      console.error('Failed to load thread state:', err);
      setMessages([{
        id: Date.now().toString(),
        role: 'agent',
        content: '你好！我是你的AI助理。开启了一个新的会话，今天我能为您做些什么？',
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  // 创建新会话
  const createNewThread = async () => {
    try {
      setIsLoading(true);
      const thread = await client.threads.create();
      setThreadId(thread.thread_id);
      
      setMessages([
        {
          id: Date.now().toString(),
          role: 'agent',
          content: '你好！我是你的AI助理。开启了一个新的会话，今天我能为您做些什么？',
        }
      ]);

      await fetchThreads();
    } catch (err) {
      console.error('Failed to create thread:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (!session) {
      return;
    }

    const initApp = async () => {
      const existingThreads = await fetchThreads();
      if (existingThreads.length > 0) {
        await loadThread(existingThreads[0].thread_id);
      } else {
        await createNewThread();
      }
    };
    initApp();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  const handleLogout = () => {
    clearStoredSession();
    setSession(null);
    setMessages([]);
    setThreads([]);
    setThreadId(null);
  };

  const handleSend = async () => {
    if (!input.trim() || isLoading || !threadId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    };

    const agentMessageId = (Date.now() + 1).toString();

    setMessages(prev => [
      ...prev, 
      userMessage,
      { id: agentMessageId, role: 'agent', content: '' }
    ]);
    
    setInput('');
    setIsLoading(true);

    try {
      const streamResponse = client.runs.stream(
        threadId,
        'lead_agent',
        {
          input: {
            messages: [{ role: 'user', content: userMessage.content }]
          },
          streamMode: 'messages',
        }
      );

      let finalContent = '';
      
      for await (const chunk of streamResponse) {
        const c = chunk as any;
        
        if (c.event === 'messages/partial') {
          if (Array.isArray(c.data) && c.data.length > 0) {
            const msgChunk = c.data[0];
            if (msgChunk && (msgChunk.type === 'AIMessageChunk' || msgChunk.type === 'ai' || msgChunk.role === 'assistant')) {
              const currentText = typeof msgChunk.content === 'string' ? msgChunk.content : '';
              
              if (currentText && currentText !== finalContent) {
                finalContent = currentText;
                
                setMessages(prev => 
                  prev.map(m => m.id === agentMessageId ? { ...m, content: finalContent } : m)
                );
              }
            }
          }
        }
      }

      if (!finalContent) {
        setMessages(prev => 
          prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，没有收到回复。' } : m)
        );
      }

      await fetchThreads();

    } catch (error) {
      console.error('发送消息失败:', error);
      setMessages(prev => 
        prev.map(m => m.id === agentMessageId ? { ...m, content: '抱歉，服务似乎出现了一些问题，请稍后再试。' } : m)
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!session) {
    return <LoginPage onLogin={setSession} />;
  }

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden w-full">
      <Sidebar 
        isOpen={isSidebarOpen}
        threads={threads}
        currentThreadId={threadId}
        isLoading={isLoading}
        onSelectThread={loadThread}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <Header 
          isSidebarOpen={isSidebarOpen}
          isLoading={isLoading}
          currentUser={session.user}
          onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
          onCreateThread={createNewThread}
          onLogout={handleLogout}
        />

        <MessageList 
          messages={messages}
          isLoading={isLoading}
          messagesEndRef={messagesEndRef}
        />

        <InputArea 
          input={input}
          isLoading={isLoading}
          onInputChange={setInput}
          onSend={handleSend}
          onKeyDown={handleKeyDown}
        />
      </div>
    </div>
  );
}

export default App;
