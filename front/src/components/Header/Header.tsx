import { Bot, KeyRound, PanelLeftClose, PanelLeftOpen, PlusCircle } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import type { AuthUser } from '../../api/auth';

/**
 * Header 顶部导航栏组件
 *
 * 职责:
 *   1. 显示当前页面的标题和图标(根据 URL 路径判断是聊天还是密码本)
 *   2. 提供侧边栏折叠按钮、新建会话按钮、退出登录按钮
 *
 * 路由改造说明:
 *   原来通过 activeView prop 判断当前视图,现在用 useLocation 读取 URL 路径判断。
 *   这样 Header 不需要父组件传 activeView,自己就能感知当前页面。
 */
interface HeaderProps {
  isSidebarOpen: boolean;
  isLoading: boolean;
  currentUser: AuthUser;
  onToggleSidebar: () => void;
  onCreateThread: () => void;
  onLogout: () => void;
}

export function Header({
  isSidebarOpen,
  isLoading,
  currentUser,
  onToggleSidebar,
  onCreateThread,
  onLogout,
}: HeaderProps) {
  // 从 URL 路径判断当前页面:以 /chat 开头就是聊天页面
  const location = useLocation();
  const isChatView = location.pathname.startsWith('/chat');

  const title = isChatView ? 'AI 助理' : '密码本';
  const subtitle = isChatView ? 'LangGraph 连接正常' : '个人账号资料管理';
  const Icon = isChatView ? Bot : KeyRound;

  return (
    <header className="bg-white border-b shadow-sm px-4 py-3 flex items-center justify-between shrink-0 h-[68px]">
      <div className="flex items-center space-x-3">
        <button
          type="button"
          onClick={onToggleSidebar}
          className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition-colors focus:outline-none"
          title={isSidebarOpen ? '收起侧边栏' : '展开侧边栏'}
        >
          {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
        </button>

        <div className="bg-blue-600 p-1.5 rounded-lg flex-shrink-0">
          <Icon className="w-5 h-5 text-white" />
        </div>

        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-gray-800 leading-tight">{title}</h1>
          <p className="text-xs text-gray-500 flex items-center space-x-1">
            {isChatView && <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>}
            <span>{subtitle}</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden md:inline text-sm text-gray-500">{currentUser.username}</span>
        {/* "新建会话"按钮仅在聊天页面显示 */}
        {isChatView && (
          <button
            type="button"
            onClick={onCreateThread}
            disabled={isLoading}
            className="flex items-center space-x-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
          >
            <PlusCircle className="w-4 h-4" />
            <span>新建会话</span>
          </button>
        )}
        <button
          type="button"
          onClick={onLogout}
          className="px-3 py-2 bg-white hover:bg-red-50 border border-gray-200 text-gray-600 hover:text-red-600 rounded-lg text-sm font-medium transition-colors"
        >
          退出
        </button>
      </div>
    </header>
  );
}
