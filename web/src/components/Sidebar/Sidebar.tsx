import { Bot, KeyRound, MessageSquare, Clock, CalendarDays, HardDrive, BookOpen } from 'lucide-react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import type { Thread } from '../../types/chat';
import { formatDate } from '../../utils/format';
import { useAuth } from '../../auth/AuthContext';

/**
 * Sidebar 侧边栏组件
 *
 * 职责:
 *   1. 顶部导航:在"AI 助理"和"密码本"之间切换(用 NavLink 实现路由跳转)
 *   2. 会话列表:展示历史会话,点击切换(用 Link 跳转到 /chat/:threadId)
 *
 * 路由改造说明:
 *   原来通过 props.onChangeView / props.onSelectThread 回调通知父组件切换视图,
 *   现在直接用 <NavLink> / <Link> 进行路由跳转,URL 变化后 React Router 自动渲染对应页面。
 *   NavLink 相比 Link 多了 active 状态检测,可以自动高亮当前路由对应的导航项。
 *
 * 访客模式说明:
 *   访客(isGuest=true)只能看到"AI 助理"导航,密码本入口隐藏
 *   因为密码本需要 Go 后端的真实 JWT token,访客的假 token 无法通过鉴权
 */
interface SidebarProps {
  isOpen: boolean;
  threads: Thread[];
  currentThreadId: string | null;
}

// 导航项配置:每项对应一个路由路径
const NAV_ITEMS: Array<{ to: string; label: string; icon: typeof Bot }> = [
  { to: '/chat', label: 'AI 助理', icon: Bot },
  { to: '/passwordbook', label: '密码本', icon: KeyRound },
  { to: '/schedule', label: '日程', icon: CalendarDays },
  { to: '/knowledgebook', label: '知识库', icon: BookOpen },
  { to: '/filesystem', label: '文件系统', icon: HardDrive },
];

export function Sidebar({
  isOpen,
  threads,
  currentThreadId,
}: SidebarProps) {
  // 用 useLocation 判断当前是否在聊天页面,决定是否显示会话列表
  const location = useLocation();
  const isChatView = location.pathname.startsWith('/chat');

  // 从 AuthContext 获取 session,判断是否为访客模式
  // 访客模式下隐藏密码本和日程入口(需要后端 JWT 鉴权)
  const { session } = useAuth();
  const isGuest = session?.isGuest === true;

  // 过滤导航项:访客只显示聊天,不显示密码本/日程/命令手册/文件系统(需要后端 JWT 鉴权)
  const visibleNavItems = isGuest
    ? NAV_ITEMS.filter((item) => item.to !== '/passwordbook' && item.to !== '/schedule' && item.to !== '/filesystem')
    : NAV_ITEMS;

  return (
    <aside
      className={`bg-gray-900 text-gray-300 flex flex-col shrink-0 transition-all duration-300 ease-in-out border-r border-gray-800 z-10 ${
        isOpen ? 'w-64' : 'w-0 opacity-0 pointer-events-none'
      }`}
    >
      {/* 顶部导航区:NavLink 会根据当前 URL 自动添加 active 类名 */}
      <div className="px-3 py-4 border-b border-gray-800 space-y-1">
        {visibleNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              // NavLink 的 className 支持函数形式,接收 { isActive } 参数
              // isActive 为 true 时表示当前 URL 匹配这个路由
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

      {/* 会话列表区:仅在聊天页面显示 */}
      {isChatView && (
        <>
          <div className="px-4 py-4 text-xs font-semibold text-gray-500 uppercase tracking-wider">
            最近会话
          </div>

          <div className="flex-1 overflow-y-auto px-2 space-y-1 custom-scrollbar">
            {threads.length === 0 ? (
              <div className="text-center text-sm text-gray-600 mt-4">暂无历史记录</div>
            ) : (
              threads.map((thread) => (
                <Link
                  key={thread.thread_id}
                  to={`/chat/${thread.thread_id}`}
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
                </Link>
              ))
            )}
          </div>
        </>
      )}

      {!isChatView && (
        <div className="px-4 py-6 text-sm text-gray-500 leading-6">
          在这里集中保存各平台账号、密码和登录地址，方便随时查询。
        </div>
      )}
    </aside>
  );
}
