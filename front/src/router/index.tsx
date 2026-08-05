import { createBrowserRouter, Navigate } from 'react-router-dom';
import { ProtectedRoute } from '../auth/ProtectedRoute';
import { MainLayout } from '../layouts/MainLayout';
import { ChatPage } from '../pages/ChatPage';
import { LoginPage } from '../components/Auth/LoginPage';
import { PasswordbookPage } from '../components/Passwordbook/PasswordbookPage';
import { SchedulePage } from '../components/Schedule/SchedulePage';
import { FileSystemPage } from '../components/FileSystem/FileSystemPage';

/**
 * 路由配置
 *
 * 路由结构:
 *   /login             → LoginPage(公开路由,未登录可访问)
 *   /                  → ProtectedRoute(认证守卫,未登录重定向到 /login)
 *     ├─ index         → 重定向到 /chat
 *     ├─ chat          → ChatPage(无 threadId,自动选择最近会话)
 *     ├─ chat/:threadId → ChatPage(加载指定会话)
 *     ├─ passwordbook  → PasswordbookPage
 *     └─ *             → 重定向到 /chat(未知路由兜底)
 *
 * 嵌套关系说明:
 *   ProtectedRoute 返回 <Outlet />,被 MainLayout 替换
 *   MainLayout 返回 <Outlet context={...} />,被各页面组件替换
 *   所以渲染链路是:ProtectedRoute → MainLayout → ChatPage/PasswordbookPage
 *
 * createBrowserRouter vs <BrowserRouter>:
 *   createBrowserRouter 是 React Router v7 推荐的 API,支持数据加载等高级特性
 *   老的 <BrowserRouter> + <Routes> + <Route> 写法也兼容,但新项目推荐用 createBrowserRouter
 */
export const router = createBrowserRouter([
  {
    // 公开路由:登录页(不需要认证)
    path: '/login',
    element: <LoginPage />,
  },
  {
    // 受保护路由:需要登录才能访问
    path: '/',
    element: <ProtectedRoute />,
    children: [
      {
        // 主布局:渲染 Sidebar + Header + <Outlet />
        element: <MainLayout />,
        children: [
          // 访问 / 时重定向到 /chat
          { index: true, element: <Navigate to="/chat" replace /> },
          // 聊天页(无指定会话,ChatPage 内部会自动选择最近会话)
          { path: 'chat', element: <ChatPage /> },
          // 聊天页(指定会话,URL 参数 threadId 供 ChatPage 读取)
          { path: 'chat/:threadId', element: <ChatPage /> },
          // 密码本页
          { path: 'passwordbook', element: <PasswordbookPage /> },
          // 日程页(月视图日历,管理日程安排)
          { path: 'schedule', element: <SchedulePage /> },
          // 文件系统页(目录扫描/存储分析/权限查看,仅 macOS/Linux)
          { path: 'filesystem', element: <FileSystemPage /> },
          // 未知路由重定向到聊天页
          { path: '*', element: <Navigate to="/chat" replace /> },
        ],
      },
    ],
  },
]);
