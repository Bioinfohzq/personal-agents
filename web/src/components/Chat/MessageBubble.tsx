import { User, Bot, Wrench } from 'lucide-react';
import type { Message } from '../../types/chat';

interface MessageBubbleProps {
  message: Message;
}

export function MessageBubble({ message }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';

  return (
    <div
      className={`flex items-start space-x-4 ${
        isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'
      }`}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 shadow-sm ${
          isUser
            ? 'bg-blue-100 text-blue-600'
            : isTool
              ? 'bg-amber-100 text-amber-700'
              : 'bg-gray-800 text-gray-100'
        }`}
      >
        {isUser ? <User size={20} /> : isTool ? <Wrench size={18} /> : <Bot size={20} />}
      </div>
      <div
        className={`max-w-[80%] rounded-2xl px-5 py-3 ${
          isUser
            ? 'bg-blue-600 text-white rounded-tr-none shadow-md'
            : isTool
              ? 'bg-amber-50 border border-amber-200 text-gray-700 rounded-tl-none text-sm'
              : 'bg-white border border-gray-100 text-gray-800 rounded-tl-none shadow-sm'
        }`}
      >
        {isTool && message.toolName && (
          <div className="text-xs font-medium text-amber-700 mb-1 flex items-center gap-1">
            <Wrench size={12} /> {message.toolName}
          </div>
        )}
        <div className={`whitespace-pre-wrap leading-relaxed min-h-[1.5rem] ${isTool ? 'font-mono text-xs' : ''}`}>
          {message.content}
        </div>
      </div>
    </div>
  );
}
