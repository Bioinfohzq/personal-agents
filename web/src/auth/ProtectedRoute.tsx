import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './AuthContext';

/**
 * ProtectedRoute:路由守卫组件
 *
 * 作用:未登录用户不能访问受保护的路由,会被重定向到 /login
 *
 * 工作原理:
 *   1. 从 AuthContext 读取 session
 *   2. 如果 session 为 null(未登录),返回 <Navigate to="/login" /> 重定向
 *   3. 如果已登录,渲染 <Outlet />(即子路由对应的页面组件)
 *
 * <Outlet /> 是 React Router 的占位组件,表示"子路由渲染到这里"
 *   类似 Python 模板继承里的 {% block content %}{% endblock %}
 *
 * <Navigate to="/login" replace /> 中的 replace:
 *   - replace=true:替换当前历史记录(用户点后退不会回到受保护页面)
 *   - replace=false(默认):添加新历史记录
 *
 * 用法(在路由配置里):
 *   {
 *     element: <ProtectedRoute />,  // 守卫
 *     children: [                    // 受保护的子路由
 *       { path: 'chat', element: <ChatPage /> },
 *       { path: 'passwordbook', element: <PasswordbookPage /> },
 *     ]
 *   }
 */
export function ProtectedRoute() {
  const { session } = useAuth();

  if (!session) {
    // 未登录:重定向到登录页
    // replace 表示替换历史记录,这样用户登录后点后退不会回到需要登录的页面
    return <Navigate to="/login" replace />;
  }

  // 已登录:渲染子路由(<Outlet /> 会被替换为匹配的子路由组件)
  return <Outlet />;
}
