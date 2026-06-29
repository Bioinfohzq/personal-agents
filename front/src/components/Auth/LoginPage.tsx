import { useState } from 'react';
import type { FormEvent } from 'react';
import { login, register, storeSession, type AuthSession } from '../../api/auth';

interface LoginPageProps {
  onLogin: (session: AuthSession) => void;
}

export function LoginPage({ onLogin }: LoginPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

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
      const session = mode === 'login'
        ? await login(account.trim(), password)
        : await register(username.trim(), email.trim(), password);
      storeSession(session);
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : '登录失败');
    } finally {
      setIsSubmitting(false);
    }
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
      </section>
    </main>
  );
}
