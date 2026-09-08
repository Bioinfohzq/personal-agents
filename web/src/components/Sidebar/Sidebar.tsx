import { Bot, KeyRound, MessageSquare, Clock, CalendarDays, HardDrive, BookOpen, Trash2, Brain, LogOut, ChevronRight } from 'lucide-react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useEffect, useRef, useState } from 'react';
import type { Thread } from '../../types/chat';
import type { AuthUser } from '../../api/auth';
import { formatDate } from '../../utils/format';

/**
 * Sidebar 侧边栏组件
 *
 * 布局结构(flex-col):
 *   1. 顶部导航区(shrink-0):AI助理/密码本/日程/知识库/文件系统
 *   2. 中间弹性区(flex-1):聊天页显示最近会话列表,其他页面显示提示
 *   3. 底部用户区(shrink-0):用户信息行,点击弹出浮层菜单(长期记忆/退出登录)
 */
interface SidebarProps {
  isOpen: boolean;
  threads: Thread[];
  currentThreadId: string | null;
  currentUser: AuthUser;
  isGuest?: boolean;
  onDeleteThread: (threadId: string) => Promise<void>;
  onLogout: () => void;
}

// 顶部主导航项
const NAV_ITEMS: Array<{ to: string; label: string; icon: typeof Bot; guestHidden?: boolean }> = [
  { to: '/chat', label: 'AI 助理', icon: Bot },
  { to: '/passwordbook', label: '密码本', icon: KeyRound, guestHidden: true },
  { to: '/schedule', label: '日程', icon: CalendarDays, guestHidden: true },
  { to: '/knowledgebook', label: '知识记录', icon: BookOpen },
  { to: '/filesystem', label: '文件系统', icon: HardDrive, guestHidden: true },
];

export function Sidebar({
  isOpen,
  threads,
  currentThreadId,
  currentUser,
  isGuest = false,
  onDeleteThread,
  onLogout,
}: SidebarProps) {
  const location = useLocation();
  const navigate = useNavigate();
  const isChatView = location.pathname.startsWith('/chat');

  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deletingLoading, setDeletingLoading] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // 可见导航项:访客模式隐藏需要后端JWT的页面
  const visibleNavItems = isGuest
    ? NAV_ITEMS.filter((item) => !item.guestHidden)
    : NAV_ITEMS;

  // 用户显示名:优先username,其次phone,再次email,都没有则显示"用户"
  const displayName = currentUser.username || currentUser.phone || currentUser.email || '用户';

  // 点击外部关闭浮层
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  // 跳转到长期记忆
  const goToMemory = () => {
    setMenuOpen(false);
    navigate('/memorybook');
  };

  // 退出登录
  const handleLogout = () => {
    setMenuOpen(false);
    onLogout();
  };

  // 点击删除按钮:阻止 Link 跳转,进入确认状态
  const handleDeleteClick = (e: React.MouseEvent, threadId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(threadId);
  };

  const confirmDelete = async (e: React.MouseEvent, threadId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingLoading(true);
    await onDeleteThread(threadId);
    setDeletingLoading(false);
    setDeletingId(null);
  };

  const cancelDelete = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDeletingId(null);
  };

  return (
    <aside
      className={`bg-gray-900 text-gray-300 flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-gray-800 z-10 ${
        isOpen ? 'w-64' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      {/* 顶部导航区 */}
      <div className="px-3 py-4 border-b border-gray-800 space-y-1 shrink-0">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 rounded-xl px-3 py-3 text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-gray-800 text-white shadow-sm'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={16} className={isActive ? 'text-blue-400' : ''} />
                  <span>{item.label}</span>
                </>
              )}
            </NavLink>
          );
        })}
      </div>

      {/* 中间弹性区域:聊天页显示会话列表,其他页面显示说明文字 */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {isChatView ? (
          <>
            <div className="px-4 py-4 text-sm font-semibold text-gray-500 tracking-wider shrink-0">
              最近会话
            </div>
            <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
              {threads.length === 0 ? (
                <div className="text-center text-sm text-gray-600 mt-4">暂无历史记录</div>
              ) : (
                threads.map((thread) => {
                  const isActive = thread.thread_id === currentThreadId;
                  const isDeleting = deletingId === thread.thread_id;
                  const title = thread.metadata?.title || `会话 ${thread.thread_id.substring(0, 8)}`;
                  return (
                    <div key={thread.thread_id} className="relative group">
                      <Link
                        to={`/chat/${thread.thread_id}`}
                        className={`w-full text-left px-3 py-3 rounded-xl flex flex-col space-y-1.5 transition-colors pr-9 ${
                          isActive
                            ? 'bg-gray-800 text-white shadow-sm'
                            : 'hover:bg-gray-800 text-gray-400 hover:text-gray-200'
                        }`}
                      >
                        <div className="flex items-center space-x-2.5 text-sm font-medium">
                          <MessageSquare size={14} className={isActive ? 'text-blue-400' : ''} />
                          <span className="truncate">{title}</span>
                        </div>
                        {thread.updated_at && (
                          <div className="flex items-center space-x-1.5 text-xs opacity-60 pl-6">
                            <Clock size={10} />
                            <span>{formatDate(thread.updated_at)}</span>
                          </div>
                        )}
                      </Link>

                      {!isDeleting && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClick(e, thread.thread_id)}
                          className={`absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-md text-gray-500 hover:text-red-400 hover:bg-gray-700 transition-opacity ${
                            isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                          }`}
                          title="删除会话"
                        >
                          <Trash2 size={14} />
                        </button>
                      )}

                      {isDeleting && (
                        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                          <button
                            type="button"
                            onClick={(e) => cancelDelete(e)}
                            disabled={deletingLoading}
                            className="px-2 py-1 text-xs rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors disabled:opacity-50"
                          >
                            取消
                          </button>
                          <button
                            type="button"
                            onClick={(e) => confirmDelete(e, thread.thread_id)}
                            disabled={deletingLoading}
                            className="px-2 py-1 text-xs rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors disabled:opacity-50"
                          >
                            {deletingLoading ? '...' : '删除'}
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </>
        ) : (
          <div className="px-4 py-6 text-sm text-gray-500 leading-6 overflow-y-auto">
            选择左侧功能模块开始使用。
          </div>
        )}
      </div>

      {/* 底部用户区:点击弹出浮层菜单 */}
      {!isGuest && (
        <div className="relative px-3 py-3 border-t border-gray-800 shrink-0" ref={menuRef}>
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors ${
              menuOpen
                ? 'bg-gray-800 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            {/* 头像占位:用首字圆形 */}
            <div className="w-7 h-7 rounded-full bg-gradient-to-br from-indigo-500 to-purple-500 flex items-center justify-center text-white text-xs font-medium shrink-0">
              {displayName.charAt(0).toUpperCase()}
            </div>
            <span className="flex-1 text-left truncate font-medium">{displayName}</span>
            <ChevronRight
              size={16}
              className={`text-gray-500 transition-transform duration-200 ${menuOpen ? 'rotate-90' : ''}`}
            />
          </button>

          {/* 浮层菜单:向上弹出 */}
          {menuOpen && (
            <div className="absolute bottom-full left-3 right-3 mb-2 bg-gray-800 rounded-xl shadow-xl border border-gray-700 overflow-hidden z-20 animate-in fade-in slide-in-from-bottom-2 duration-150">
              <button
                type="button"
                onClick={goToMemory}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                <Brain size={16} className="text-indigo-400" />
                <span>长期记忆</span>
              </button>
              <div className="h-px bg-gray-700" />
              <button
                type="button"
                onClick={handleLogout}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-gray-200 hover:bg-gray-700 transition-colors"
              >
                <LogOut size={16} className="text-red-400" />
                <span>退出登录</span>
              </button>
            </div>
          )}
        </div>
      )}
    </aside>
  );
}
