import { Bot, Loader2 } from 'lucide-react';
import type { Message } from '../../types/chat';
import { MessageBubble } from './MessageBubble';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function MessageList({ messages, isLoading, messagesEndRef }: MessageListProps) {
  return (
    <main className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 bg-gray-50/50">
      <div className="max-w-4xl mx-auto space-y-6">
        {messages.map((message) => {
          // 如果内容为空且正在 loading，展示骨架屏或思考状态
          if (message.content === '' && isLoading) {
            return (
              <div key={message.id} className="flex items-start space-x-4">
                <div className="w-10 h-10 rounded-full bg-gray-200 text-gray-600 flex items-center justify-center shrink-0">
                  <Bot size={20} />
                </div>
                <div className="bg-white border text-gray-800 rounded-2xl rounded-tl-none px-5 py-3 shadow-sm flex items-center space-x-2">
                  <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
                  <span className="text-gray-500 text-sm">正在思考...</span>
                </div>
              </div>
            );
          }

          // 正常消息气泡
          return <MessageBubble key={message.id} message={message} />;
        })}
        <div ref={messagesEndRef as React.RefObject<HTMLDivElement>} />
      </div>
    </main>
  );
}
