import { useState } from 'react';
import { User, Bot, Wrench, BookmarkPlus } from 'lucide-react';
import type { Message } from '../../types/chat';

interface MessageBubbleProps {
  message: Message;
  onSaveToKnowledge?: (message: Message) => void;
}

export function MessageBubble({ message, onSaveToKnowledge }: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isTool = message.role === 'tool';
  const canSave = !isTool && !message.isStreaming && !!message.content?.trim() && !!onSaveToKnowledge;
  const [hover, setHover] = useState(false);

  return (
    <div
      className={`flex items-start space-x-4 group ${
        isUser ? 'flex-row-reverse space-x-reverse' : 'flex-row'
      }`}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
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
      <div className="flex flex-col max-w-[80%]">
        <div
          className={`rounded-2xl px-5 py-3 ${
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

        {/* 操作栏:悬浮时显示"存入知识库"按钮 */}
        {canSave && (
          <div className={`mt-1 flex gap-1 ${isUser ? 'justify-end' : 'justify-start'} ${hover ? 'opacity-100' : 'opacity-0'} transition-opacity`}>
            <button
              type="button"
              onClick={() => onSaveToKnowledge?.(message)}
              className="inline-flex items-center gap-1 text-xs text-gray-500 hover:text-blue-600 hover:bg-blue-50 px-2 py-1 rounded-md transition-colors"
              title="存入知识库"
            >
              <BookmarkPlus size={13} />
              <span>存入知识库</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
