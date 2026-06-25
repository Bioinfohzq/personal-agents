import { useState, useRef, useEffect } from 'react';
import { Send, User, Bot, Loader2 } from 'lucide-react';
import { Client } from '@langchain/langgraph-sdk';

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  isStreaming?: boolean;
}

// 初始化 LangGraph 官方 SDK 客户端，指向 langgraph dev 默认端口 2024
const client = new Client({ apiUrl: 'http://localhost:2024' });

function App() {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'agent',
      content: '你好！我是你的智能助理。今天我能为您做些什么？',
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // 初始化 Thread
  useEffect(() => {
    const initThread = async () => {
      try {
        const thread = await client.threads.create();
        setThreadId(thread.thread_id);
        console.log('LangGraph Thread created:', thread.thread_id);
      } catch (err) {
        console.error('Failed to create thread:', err);
      }
    };
    initThread();
  }, []);

  const handleSend = async () => {
    if (!input.trim() || isLoading || !threadId) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input.trim()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // 只需要发送最新消息，LangGraph 根据 threadId 维护状态
      const streamResponse = client.runs.stream(
        threadId,
        'lead_agent',
        {
          input: {
            messages: [{ role: 'user', content: userMessage.content }]
          },
          streamMode: 'values',
        }
      );

      let finalContent = '';
      
      // 监听流式返回
      for await (const chunk of streamResponse) {
        // chunk.data 在 streamMode='values' 时，包含整个状态
        const stateData = chunk.data as any;
        if (stateData && stateData.messages && Array.isArray(stateData.messages) && stateData.messages.length > 0) {
          const latestMessage = stateData.messages[stateData.messages.length - 1];
          if (latestMessage.type === 'ai' || latestMessage.role === 'assistant') {
            // 根据 langchain 的 Message 对象格式，可能是 type 或是 role
            finalContent = typeof latestMessage.content === 'string' ? latestMessage.content : JSON.stringify(latestMessage.content);
          }
        }
      }

      if (finalContent) {
        const agentMessage: Message = {
          id: (Date.now() + 1).toString(),
          role: 'agent',
          content: finalContent
        };
        setMessages(prev => [...prev, agentMessage]);
      } else {
        throw new Error('No AI message returned');
      }

    } catch (error) {
      console.error('发送消息失败:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'agent',
        content: '抱歉，服务似乎出现了一些问题，请稍后再试。'
      };
      setMessages(prev => [...prev, errorMessage]);
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

  return (
    <div className="flex flex-col h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b shadow-sm px-6 py-4 flex items-center justify-between shrink-0">
        <div className="flex items-center space-x-3">
          <div className="bg-blue-600 p-2 rounded-lg">
            <Bot className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-gray-800">个人智能体 (Personal Agent)</h1>
            <p className="text-sm text-gray-500">正在运行</p>
          </div>
        </div>
      </header>

      {/* Chat Area */}
      <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6">
        <div className="max-w-4xl mx-auto space-y-6">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex items-start space-x-4 ${
                message.role === 'user' ? 'flex-row-reverse space-x-reverse' : 'flex-row'
              }`}
            >
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
                  message.role === 'user' ? 'bg-blue-100 text-blue-600' : 'bg-gray-200 text-gray-600'
                }`}
              >
                {message.role === 'user' ? <User size={20} /> : <Bot size={20} />}
              </div>
              <div
                className={`max-w-[80%] rounded-2xl px-5 py-3 ${
                  message.role === 'user'
                    ? 'bg-blue-600 text-white rounded-tr-none'
                    : 'bg-white border text-gray-800 rounded-tl-none shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{message.content}</div>
              </div>
            </div>
          ))}
          {isLoading && (
            <div className="flex items-start space-x-4">
              <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                <Bot size={20} />
              </div>
              <div className="bg-white border text-gray-800 rounded-2xl rounded-tl-none px-5 py-3 shadow-sm flex items-center space-x-2">
                <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                <span className="text-gray-500 text-sm">正在思考...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>
      </main>

      {/* Input Area */}
      <footer className="bg-white border-t p-4 sm:p-6 shrink-0">
        <div className="max-w-4xl mx-auto flex items-end space-x-4">
          <div className="flex-1 relative">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="输入消息，按 Enter 发送，Shift + Enter 换行..."
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none"
              rows={1}
              style={{
                minHeight: '52px',
                maxHeight: '200px'
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isLoading}
              className="absolute right-3 bottom-3 text-blue-600 p-1 rounded-md hover:bg-blue-50 disabled:text-gray-400 disabled:hover:bg-transparent transition-colors"
            >
              <Send size={20} />
            </button>
          </div>
        </div>
        <div className="text-center mt-3 text-xs text-gray-400">
          AI 生成的内容可能不准确，请注意甄别。
        </div>
      </footer>
    </div>
  );
}

export default App;
