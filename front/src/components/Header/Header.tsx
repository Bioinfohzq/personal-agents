import { Bot, PanelLeftClose, PanelLeftOpen, PlusCircle } from 'lucide-react';
import type { AuthUser } from '../../api/auth';

interface HeaderProps {
  isSidebarOpen: boolean;
  isLoading: boolean;
  currentUser: AuthUser;
  onToggleSidebar: () => void;
  onCreateThread: () => void;
  onLogout: () => void;
}

export function Header({ isSidebarOpen, isLoading, currentUser, onToggleSidebar, onCreateThread, onLogout }: HeaderProps) {
  return (
    <header className="bg-white border-b shadow-sm px-4 py-3 flex items-center justify-between shrink-0 h-[68px]">
      <div className="flex items-center space-x-3">
        <button 
          onClick={onToggleSidebar}
          className="p-2 -ml-2 text-gray-500 hover:bg-gray-100 hover:text-gray-700 rounded-lg transition-colors focus:outline-none"
          title={isSidebarOpen ? "收起侧边栏" : "展开侧边栏"}
        >
          {isSidebarOpen ? <PanelLeftClose size={20} /> : <PanelLeftOpen size={20} />}
        </button>

        <div className="bg-blue-600 p-1.5 rounded-lg flex-shrink-0">
          <Bot className="w-5 h-5 text-white" />
        </div>
        
        <div className="flex flex-col">
          <h1 className="text-lg font-semibold text-gray-800 leading-tight">AI助理</h1>
          <p className="text-xs text-gray-500 flex items-center space-x-1">
            <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
            <span>LangGraph 连接正常</span>
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <span className="hidden md:inline text-sm text-gray-500">{currentUser.username}</span>
        <button
          onClick={onCreateThread}
          disabled={isLoading}
          className="flex items-center space-x-1.5 px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap"
        >
          <PlusCircle className="w-4 h-4" />
          <span>新建会话</span>
        </button>
        <button
          onClick={onLogout}
          className="px-3 py-2 bg-white hover:bg-red-50 border border-gray-200 text-gray-600 hover:text-red-600 rounded-lg text-sm font-medium transition-colors"
        >
          退出
        </button>
      </div>
    </header>
  );
}
