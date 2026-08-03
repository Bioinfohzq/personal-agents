import { createContext, useContext, useCallback, useMemo, useState, type ReactNode } from 'react';
import {
  clearStoredSession,
  readStoredSession,
  storeSession,
  type AuthSession,
} from '../api/auth';

/**
 * AuthContext:全局认证状态管理
 *
 * 为什么需要 Context?
 *   原本 session 状态在 App.tsx 里,通过 props 一层层传递。
 *   加了路由后,LoginPage、ProtectedRoute、Header、PasswordbookPage 都需要 session,
 *   如果继续用 props 透传会很繁琐(props drilling)。
 *   Context 让任何子组件都能直接读取 session,无需逐层传递。
 *
 * 核心概念:Context 是 React 提供的"跨组件数据通道"
 *   - Provider 在上层提供数据
 *   - useAuth() 在下层消费数据
 *   - 数据变化时,所有消费的组件自动重新渲染
 */

interface AuthContextValue {
  session: AuthSession | null;             // 当前登录态,null 表示未登录
  login: (session: AuthSession) => void;   // 登录成功后调用:持久化 + 更新状态
  logout: () => void;                      // 退出登录:清除持久化 + 清空状态
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  // 初始值从 localStorage 读取,实现"刷新页面后仍保持登录态"
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession());

  // 登录:先持久化到 localStorage,再更新内存状态
  // 持久化是为了刷新页面后仍能恢复登录态;更新状态是为了触发 UI 重新渲染
  const login = useCallback((newSession: AuthSession) => {
    storeSession(newSession);
    setSession(newSession);
  }, []);

  // 退出:清除持久化数据,清空内存状态
  // 状态清空后,所有消费 useAuth() 的组件都会重新渲染(如 ProtectedRoute 会重定向到 /login)
  const logout = useCallback(() => {
    clearStoredSession();
    setSession(null);
  }, []);

  // useMemo 缓存 context value,避免 Provider 每次渲染都生成新对象
  // 否则所有消费组件都会因为引用变化而无意义地重新渲染
  const value = useMemo<AuthContextValue>(
    () => ({ session, login, logout }),
    [session, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * useAuth:在子组件里消费认证状态的 Hook
 *
 * 用法:
 *   const { session, logout } = useAuth();
 *
 * 如果在 AuthProvider 外部调用,会抛出错误(帮助开发期发现问题)
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth 必须在 <AuthProvider> 内部使用');
  }
  return ctx;
}
