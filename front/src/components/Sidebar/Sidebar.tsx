import { Bot, KeyRound, MessageSquare, Clock } from 'lucide-react';
import type { AppView } from '../../types/app';
import type { Thread } from '../../types/chat';
import { formatDate } from '../../utils/format';

interface SidebarProps {
  isOpen: boolean;
  activeView: AppView;
  onChangeView: (view: AppView) => void;
  threads: Thread[];
  currentThreadId: string | null;
  isLoading: boolean;
  onSelectThread: (id: string) => void;
}

const NAV_ITEMS: Array<{ id: AppView; label: string; icon: typeof Bot }> = [
  { id: 'chat', label: 'AI 助理', icon: Bot },
  { id: 'passwordbook', label: '密码本', icon: KeyRound },
];

export function Sidebar({
  isOpen,
  activeView,
  onChangeView,
  threads,
  currentThreadId,
  isLoading,
  onSelectThread,
}: SidebarProps) {
  return (
    <aside
      className={`bg-gray-900 text-gray-300 flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-gray-800 z-10 ${
        isOpen ? 'w-64' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      <div className="px-3 py-4 border-b border-gray-800 space-y-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onChangeView(item.id)}
              className={`w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white shadow-sm'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-blue-400' : ''} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>

      {activeView === 'chat' && (
        <>
          <div className="px-4 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            最近会话
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
            {threads.length === 0 ? (
              <div className="text-center text-sm text-gray-600 mt-4">暂无历史记录</div>
            ) : (
              threads.map((thread) => (
                <button
                  key={thread.thread_id}
                  type="button"
                  onClick={() => onSelectThread(thread.thread_id)}
                  disabled={isLoading}
                  className={`w-full text-left px-3 py-3 rounded-xl flex flex-col space-y-1.5 transition-colors ${
                    thread.thread_id === currentThreadId
                      ? 'bg-gray-800 text-white shadow-sm'
                      : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  <div className="flex items-center space-x-2.5 text-sm font-medium">
                    <MessageSquare size={14} className={thread.thread_id === currentThreadId ? 'text-blue-400' : ''} />
                    <span className="truncate">会话 {thread.thread_id.substring(0, 8)}</span>
                  </div>
                  {thread.updated_at && (
                    <div className="flex items-center space-x-1.5 text-xs opacity-60 pl-6">
                      <Clock size={10} />
                      <span>{formatDate(thread.updated_at)}</span>
                    </div>
                  )}
                </button>
              ))
            )}
          </div>
        </>
      )}

      {activeView === 'passwordbook' && (
        <div className="px-4 py-6 text-sm text-gray-500 leading-6">
          在这里集中保存各平台账号、密码和登录地址，方便随时查询。
        </div>
      )}
    </aside>
  );
}
