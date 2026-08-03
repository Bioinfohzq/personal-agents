import { useState } from 'react';
import type { FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { login as loginApi, register, type AuthSession } from '../../api/auth';
import { useAuth } from '../../auth/AuthContext';

/**
 * 登录/注册页面组件
 *
 * 职责:表单收集 → 调用后端认证接口 → 持久化 session → 通知 AuthContext 更新登录态
 *
 * 路由改造说明:
 *   原来通过 onLogin prop 回调通知父组件 App 更新 session,
 *   现在直接调用 AuthContext 的 login 方法更新全局登录态。
 *   登录成功后用 useNavigate 跳转到 /chat。
 *   如果已登录访问 /login,自动重定向到 /chat。
 */
export function LoginPage() {
  // 从 AuthContext 获取 login 方法和 session
  const { session, login } = useAuth();
  // useNavigate:编程式导航,登录成功后跳转到 /chat
  const navigate = useNavigate();

  // 已登录则直接跳转到聊天页(避免已登录用户看到登录页)
  if (session) {
    return <Navigate to="/chat" replace />;
  }

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');     // 注册模式的用户名
  const [email, setEmail] = useState('');           // 注册模式的邮箱
  const [account, setAccount] = useState('');       // 登录模式的账号(用户名或邮箱)
  const [password, setPassword] = useState('');     // 密码(两种模式共用)
  const [error, setError] = useState<string | null>(null);  // 错误提示,null 表示无错误
  const [isSubmitting, setIsSubmitting] = useState(false);   // 提交中状态,用于禁用按钮和显示 loading

  /**
   * 表单提交处理器
   * 流程:校验 → 调后端认证接口 → 持久化 → 更新 AuthContext → 跳转
   */
  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    // 阻止表单默认提交行为(默认会刷新页面),改用 JS 控制提交
    event.preventDefault();

    // 前端参数校验
    if (mode === 'login' && (!account.trim() || !password)) {
      setError('请输入账号和密码');
      return;
    }

    if (mode === 'register' && (!username.trim() || !email.trim() || !password)) {
      setError('请输入用户名、邮箱和密码');
      return;
    }

    if (mode === 'register' && password.length < 8) {
      setError('密码至少需要 8 位');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // 根据当前模式调用不同的认证接口
      const session: AuthSession = mode === 'login'
        ? await loginApi(account.trim(), password)
        : await register(username.trim(), email.trim(), password);

      // 登录成功:
      //   1. 调用 AuthContext 的 login(内部会持久化到 localStorage + 更新全局状态)
      //   2. 跳转到 /chat(ProtectedRoute 检测到 session 存在,允许访问)
      login(session);
      navigate('/chat', { replace: true });
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
  }

  /**
   * 访客登录:跳过后端认证,直接进入聊天页面
   *
   * 适用场景:本地开发时只启动了前端 + 智能体(LangGraph),没启动 Go 后端。
   * 访客模式特点:
   *   - 能用聊天功能(聊天只依赖 LangGraph,不需要 Go 后端)
   *   - 不能用密码本(密码本需要 Go 后端的真实 JWT token)
   *   - 侧边栏不显示密码本入口
   *   - 直接访问 /passwordbook 会被重定向回 /chat
   */
  function handleGuestLogin() {
    const guestSession: AuthSession = {
      token: 'guest-token',  // 假 token,密码本接口会返回 401
      user: {
        id: 0,
        username: '访客',
        email: '',
      },
      isGuest: true,
    };
    login(guestSession);
    navigate('/chat', { replace: true });
  }

  return (
    <main className="min-h-screen bg-slate-100 flex items-center justify-center px-4">
      <section className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-8">
        <div className="mb-8">
          <p className="text-sm font-semibold text-blue-600">Personal Agents</p>
          <h1 className="mt-2 text-2xl font-bold text-slate-900">{mode === 'login' ? '登录业务系统' : '注册业务账号'}</h1>
          <p className="mt-2 text-sm text-slate-500">{mode === 'login' ? '登录后即可进入 AI 助理工作台。' : '注册成功后会自动登录。'}</p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          {mode === 'login' ? (
            <label className="block">
              <span className="text-sm font-medium text-slate-700">账号 / 邮箱</span>
              <input
                className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
                autoComplete="username"
                placeholder="请输入账号或邮箱"
              />
            </label>
          ) : (
            <>
              <label className="block">
                <span className="text-sm font-medium text-slate-700">用户名</span>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  autoComplete="username"
                  placeholder="请输入用户名"
                />
              </label>

              <label className="block">
                <span className="text-sm font-medium text-slate-700">邮箱</span>
                <input
                  className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  placeholder="请输入邮箱"
                />
              </label>
            </>
          )}

          <label className="block">
            <span className="text-sm font-medium text-slate-700">密码</span>
            <input
              className="mt-2 w-full rounded-xl border border-slate-300 px-4 py-3 outline-none focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              placeholder="请输入密码"
            />
          </label>

          {error ? <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

          <button
            className="w-full rounded-xl bg-blue-600 px-4 py-3 font-semibold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={isSubmitting}
          >
            {isSubmitting ? '处理中...' : mode === 'login' ? '登录' : '注册并登录'}
          </button>
        </form>

        <button
          className="mt-5 w-full text-sm font-medium text-blue-600 hover:text-blue-700"
          type="button"
          onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setError(null);
          }}
        >
          {mode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
        </button>

        {/* 分隔线 */}
        <div className="mt-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs text-slate-400">或者</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {/* 访客访问按钮:不调后端,直接进入聊天页面 */}
        <button
          className="mt-4 w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
          type="button"
          onClick={handleGuestLogin}
        >
          以访客身份体验 AI 助理
        </button>
        <p className="mt-2 text-center text-xs text-slate-400">
          访客模式仅可用聊天功能,密码本不可用
        </p>
      </section>
    </main>
  );
}
