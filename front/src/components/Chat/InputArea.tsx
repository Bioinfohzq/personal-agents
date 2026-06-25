import React from 'react';
import { Send } from 'lucide-react';

interface InputAreaProps {
  input: string;
  isLoading: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
}

export function InputArea({ input, isLoading, onInputChange, onSend, onKeyDown }: InputAreaProps) {
  return (
    <footer className="bg-white border-t p-4 sm:p-6 shrink-0">
      <div className="max-w-4xl mx-auto flex items-end space-x-4">
        <div className="flex-1 relative shadow-sm rounded-xl">
          <textarea
            value={input}
            onChange={(e) => onInputChange(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="输入消息，按 Enter 发送，Shift + Enter 换行..."
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 pr-12 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:bg-white resize-none transition-colors text-gray-700"
            rows={1}
            style={{
              minHeight: '52px',
              maxHeight: '200px'
            }}
          />
          <button
            onClick={onSend}
            disabled={!input.trim() || isLoading}
            className="absolute right-2 bottom-2 text-white bg-blue-600 p-1.5 rounded-lg hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400 transition-colors shadow-sm"
          >
            <Send size={18} />
          </button>
        </div>
      </div>
      <div className="text-center mt-3 text-xs text-gray-400">
        AI 生成的内容可能不准确，请注意甄别。
      </div>
    </footer>
  );
}
