import { MessageSquare, Clock } from 'lucide-react';
import type { Thread } from '../../types/chat';
import { formatDate } from '../../utils/format';

interface SidebarProps {
  isOpen: boolean;
  threads: Thread[];
  currentThreadId: string | null;
  isLoading: boolean;
  onSelectThread: (id: string) => void;
}

export function Sidebar({
  isOpen,
  threads,
  currentThreadId,
  isLoading,
  onSelectThread
}: SidebarProps) {
  return (
    <aside 
      className={`bg-gray-900 text-gray-300 flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-gray-800 z-10 ${
        isOpen ? 'w-64' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      <div className="px-4 py-4 mt-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
        最近会话
      </div>

      <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
        {threads.length === 0 ? (
          <div className="text-center text-sm text-gray-600 mt-4">暂无历史记录</div>
        ) : (
          threads.map(t => (
            <button
              key={t.thread_id}
              onClick={() => onSelectThread(t.thread_id)}
              disabled={isLoading}
              className={`w-full text-left px-3 py-3 rounded-xl flex flex-col space-y-1.5 transition-colors ${
                t.thread_id === currentThreadId 
                  ? 'bg-gray-800 text-white shadow-sm' 
                  : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
              }`}
            >
              <div className="flex items-center space-x-2.5 text-sm font-medium">
                <MessageSquare size={14} className={t.thread_id === currentThreadId ? 'text-blue-400' : ''} />
                <span className="truncate">会话 {t.thread_id.substring(0, 8)}</span>
              </div>
              {t.updated_at && (
                <div className="flex items-center space-x-1.5 text-xs opacity-60 pl-6">
                  <Clock size={10} />
                  <span>{formatDate(t.updated_at)}</span>
                </div>
              )}
            </button>
          ))
        )}
      </div>
    </aside>
  );
}
