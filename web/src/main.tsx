import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import './index.css'
import { AuthProvider } from './auth/AuthContext'
import { router } from './router'

/**
 * 应用入口文件
 *
 * 结构:
 *   <AuthProvider>          ← 全局认证状态(必须在外层,路由里的组件要用 useAuth)
 *     <RouterProvider>      ← 路由系统(根据 URL 渲染对应页面)
 *       router配置          ← /login、/chat、/passwordbook 等路由
 *     </RouterProvider>
 *   </AuthProvider>
 *
 * 启动流程:
 *   1. createRoot 找到 HTML 里的 #root 挂载点
 *   2. 渲染 AuthProvider → 初始化认证状态(从 localStorage 读取)
 *   3. 渲染 RouterProvider → 根据当前 URL 渲染对应页面
 *      - 未登录访问受保护路由 → ProtectedRoute 重定向到 /login
 *      - 已登录访问 /login → LoginPage 重定向到 /chat
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RouterProvider router={router} />
    </AuthProvider>
  </StrictMode>,
)
