import { useCallback, useState, type ReactNode } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { client } from '../api/client';
import type { Thread } from '../types/chat';
import { useAuth } from '../auth/AuthContext';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { Header } from '../components/Header/Header';

/**
 * MainLayoutContext:MainLayout 通过 Outlet context 传给子页面的共享数据
 *
 * 为什么用 Outlet context 而不是 props?
 *   <Outlet /> 渲染的子组件(MainLayout 的子路由)无法通过 props 传值,
 *   只能通过 Outlet 的 context 属性传递。子页面用 useOutletContext() 接收。
 *
 * 传递的共享状态:
 *   - threads / currentThreadId / isLoading:Sidebar 和 Header 需要
 *   - fetchThreads:ChatPage 发送消息后要刷新侧边栏
 *   - setIsLoading:ChatPage 加载会话时通知 Header 禁用按钮
 */
export interface MainLayoutContext {
  threads: Thread[];
  currentThreadId: string | null;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  fetchThreads: () => Promise<void>;
}

/**
 * MainLayout:主界面布局
 *
 * 职责:
 *   1. 渲染整体布局(Sidebar | Header + 内容区)
 *   2. 管理跨页面共享的状态(threads 列表、isLoading)
 *   3. 从 URL 解析 currentThreadId(供 Sidebar 高亮当前会话)
 *   4. 提供创建新会话、退出登录等操作
 *
 * <Outlet /> 的位置就是子路由(ChatPage / PasswordbookPage)渲染的地方
 */
export function MainLayout() {
  const { session, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // 共享状态
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // 从 URL 解析当前 threadId
  //   /chat/abc123 → 'abc123'
  //   /chat        → null
  //   /passwordbook → null
  const currentThreadId = (() => {
    const path = location.pathname;
    if (path.startsWith('/chat/')) {
      return path.slice('/chat/'.length);
    }
    return null;
  })();

  /**
   * 拉取历史会话列表
   */
  const fetchThreads = useCallback(async () => {
    try {
      const results = await client.threads.search({ limit: 50 });
      setThreads(results as Thread[]);
    } catch (err) {
      console.error('Failed to fetch threads:', err);
    }
  }, []);

  /**
   * 创建新会话:调 SDK 创建 + 刷新列表 + 导航到新会话路由
   * 导航后 ChatPage 会通过 useParams 检测到 threadId 变化,自动加载会话内容
   */
  const createNewThread = useCallback(async () => {
    try {
      setIsLoading(true);
      const thread = await client.threads.create();
      await fetchThreads();
      // 导航到新会话的 URL,ChatPage 会自动响应
      navigate(`/chat/${thread.thread_id}`);
    } catch (err) {
      console.error('Failed to create thread:', err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchThreads, navigate]);

  /**
   * 退出登录:调 AuthContext 的 logout
   * logout 会清空 session,ProtectedRoute 检测到 session 为 null 会自动重定向到 /login
   */
  const handleLogout = useCallback(() => {
    logout();
    // 不需要手动 navigate,ProtectedRoute 会自动处理
  }, [logout]);

  // 组装要传给子页面的 context 值
  const outletContext: MainLayoutContext = {
    threads,
    currentThreadId,
    isLoading,
    setIsLoading,
    fetchThreads,
  };

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden w-full">
      {/* 侧边栏:导航 + 会话列表 */}
      <Sidebar
        isOpen={isSidebarOpen}
        threads={threads}
        currentThreadId={currentThreadId}
      />

      <div className="flex-1 flex flex-col min-w-0 bg-white">
        {/* 顶部导航栏 */}
        <Header
          isSidebarOpen={isSidebarOpen}
          isLoading={isLoading}
          currentUser={session!.user}
          onToggleSidebar={() => setIsSidebarOpen((prev) => !prev)}
          onCreateThread={createNewThread}
          onLogout={handleLogout}
        />

        {/* Outlet:子路由渲染位置
            context 属性把共享数据传给子页面,子页面用 useOutletContext() 接收 */}
        <Outlet context={outletContext} />
      </div>
    </div>
  );
}
