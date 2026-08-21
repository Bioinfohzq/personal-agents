import React from 'react';
import { Send, Square } from 'lucide-react';

interface InputAreaProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  onCompositionStart?: () => void;
  onCompositionEnd?: (e: React.CompositionEvent<HTMLTextAreaElement>) => void;
}

export function InputArea({ input, isLoading, onInputChange, onSend, onStop, onKeyDown, onCompositionStart, onCompositionEnd }: InputAreaProps) {
  return (
    <footer className="bg-white border-t p-4 sm:p-6 shrink-0">
      <div className="max-w-4xl mx-auto">
        <div className="relative flex items-end bg-white border border-gray-200 rounded-xl shadow-sm focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-blue-500 transition-all">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            onCompositionStart={onCompositionStart}
            onCompositionEnd={onCompositionEnd}
            placeholder="输入消息，按 Enter 发送，Shift + Enter 换行..."
            className="flex-1 bg-transparent border-0 rounded-xl px-4 py-3 pr-12 focus:outline-none resize-none text-gray-700 placeholder:text-gray-400"
            rows={1}
            style={{
              minHeight: '48px',
              maxHeight: '200px'
            }}
          />
          <div className="absolute right-2 bottom-1.5 flex items-center">
            {isLoading ? (
              // 正在流式响应:显示停止按钮,点击中止请求
              <button
                onClick={onStop}
                aria-label="停止生成"
                title="停止生成"
                className="text-white bg-gray-700 p-1.5 rounded-lg hover:bg-gray-800 transition-colors shadow-sm"
              >
                <Square size={16} fill="currentColor" />
              </button>
            ) : (
              // 空闲:显示发送按钮
              <button
                onClick={onSend}
                disabled={!input.trim()}
                aria-label="发送消息"
                title="发送消息"
                className="text-white bg-blue-600 p-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors shadow-sm"
              >
                <Send size={16} />
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="text-center mt-2 text-xs text-gray-400">
        AI 生成的内容可能不准确，请注意甄别。
      </div>
    </footer>
  );
}
