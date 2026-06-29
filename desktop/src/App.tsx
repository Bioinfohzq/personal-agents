import { useEffect, useRef, useState } from 'react';
import type { FormEvent, KeyboardEvent } from 'react';
import { BUSINESS_API_URL, clearStoredSession, login, readStoredSession, register, storeSession, type AuthSession } from './lib/auth';
import { ASSISTANT_ID, LANGGRAPH_API_URL, langGraphClient } from './lib/langgraph';
import type { ChatMessage, ChatThread } from './types';
import './styles.css';

const welcomeMessage: ChatMessage = {
  id: 'welcome',
  role: 'agent',
  content: '你好，我是 Personal Agents 桌面客户端。请先确认 LangGraph 服务已在本机 2024 端口运行。',
};

function normalizeMessage(rawMessage: unknown, index: number): ChatMessage {
  const message = rawMessage as {
    id?: string;
    type?: string;
    role?: string;
    content?: unknown;
  };

  const role = message.type === 'human' || message.role === 'user' ? 'user' : 'agent';
  const content = typeof message.content === 'string'
    ? message.content
    : JSON.stringify(message.content ?? '');

  return {
    id: message.id ?? `history-${index}`,
    role,
    content,
  };
}

function formatThreadTime(thread: ChatThread): string {
  const rawTime = thread.updated_at ?? thread.created_at;

  if (!rawTime) {
    return '无时间记录';
  }

  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(rawTime));
}

function App() {
  const [session, setSession] = useState<AuthSession | null>(() => readStoredSession());
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);
  const [threads, setThreads] = useState<ChatThread[]>([]);
  const [currentThreadId, setCurrentThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([welcomeMessage]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [statusText, setStatusText] = useState('正在连接 LangGraph...');
  const [errorText, setErrorText] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  async function refreshThreads() {
    const result = await langGraphClient.threads.search({ limit: 50 });
    const nextThreads = result as ChatThread[];
    setThreads(nextThreads);
    return nextThreads;
  }

  async function loadThread(threadId: string) {
    setIsLoading(true);
    setErrorText(null);

    try {
      const state = await langGraphClient.threads.getState(threadId);
      const values = state.values as { messages?: unknown[] } | undefined;
      const nextMessages = values?.messages?.map(normalizeMessage) ?? [];

      setCurrentThreadId(threadId);
      setMessages(nextMessages.length > 0 ? nextMessages : [welcomeMessage]);
      setStatusText('已连接 LangGraph');
    } catch (error) {
      console.error('加载会话失败:', error);
      setErrorText('加载会话失败，请确认 LangGraph 服务状态。');
    } finally {
      setIsLoading(false);
    }
  }

  async function createThread() {
    setIsLoading(true);
    setErrorText(null);

    try {
      const thread = await langGraphClient.threads.create();
      setCurrentThreadId(thread.thread_id);
      setMessages([welcomeMessage]);
      setStatusText('已创建新会话');
      await refreshThreads();
    } catch (error) {
      console.error('创建会话失败:', error);
      setErrorText('无法创建会话，请先启动 LangGraph 服务。');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    async function initialize() {
      if (!session) {
        return;
      }

      try {
        const existingThreads = await refreshThreads();

        if (existingThreads.length > 0) {
          await loadThread(existingThreads[0].thread_id);
          return;
        }

        await createThread();
      } catch (error) {
        console.error('初始化桌面客户端失败:', error);
        setStatusText('等待 LangGraph 服务');
        setErrorText('未连接到 LangGraph。请在项目根目录启动后端服务后重试。');
      }
    }

    void initialize();
  }, [session]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (authMode === 'login' && (!account.trim() || !password)) {
      setLoginError('请输入账号和密码');
      return;
    }

    if (authMode === 'register' && (!username.trim() || !email.trim() || !password)) {
      setLoginError('请输入用户名、邮箱和密码');
      return;
    }

    if (authMode === 'register' && password.length < 8) {
      setLoginError('密码至少需要 8 位');
      return;
    }

    setIsLoggingIn(true);
    setLoginError(null);

    try {
      const nextSession = authMode === 'login'
        ? await login(account.trim(), password)
        : await register(username.trim(), email.trim(), password);
      storeSession(nextSession);
      setSession(nextSession);
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : '登录失败');
    } finally {
      setIsLoggingIn(false);
    }
  }

  function handleLogout() {
    clearStoredSession();
    setSession(null);
    setThreads([]);
    setCurrentThreadId(null);
    setMessages([welcomeMessage]);
  }

  async function sendMessage() {
    const content = input.trim();

    if (!content || isLoading || !currentThreadId) {
      return;
    }

    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
    };
    const agentMessageId = crypto.randomUUID();

    setMessages((previousMessages) => [
      ...previousMessages,
      userMessage,
      { id: agentMessageId, role: 'agent', content: '' },
    ]);
    setInput('');
    setIsLoading(true);
    setErrorText(null);

    try {
      const stream = langGraphClient.runs.stream(currentThreadId, ASSISTANT_ID, {
        input: {
          messages: [{ role: 'user', content }],
        },
        streamMode: 'messages',
      });
      let finalContent = '';

      for await (const chunk of stream) {
        const streamChunk = chunk as {
          event?: string;
          data?: unknown;
        };

        if (streamChunk.event !== 'messages/partial' || !Array.isArray(streamChunk.data)) {
          continue;
        }

        const messageChunk = streamChunk.data[0] as {
          type?: string;
          role?: string;
          content?: unknown;
        } | undefined;
        const isAssistantChunk = messageChunk?.type === 'AIMessageChunk'
          || messageChunk?.type === 'ai'
          || messageChunk?.role === 'assistant';
        const nextContent = typeof messageChunk?.content === 'string' ? messageChunk.content : '';

        if (isAssistantChunk && nextContent && nextContent !== finalContent) {
          finalContent = nextContent;
          setMessages((previousMessages) => previousMessages.map((message) => (
            message.id === agentMessageId ? { ...message, content: finalContent } : message
          )));
        }
      }

      if (!finalContent) {
        setMessages((previousMessages) => previousMessages.map((message) => (
          message.id === agentMessageId ? { ...message, content: '没有收到有效回复。' } : message
        )));
      }

      await refreshThreads();
    } catch (error) {
      console.error('发送消息失败:', error);
      setErrorText('发送失败，请检查 LangGraph 服务是否仍在运行。');
      setMessages((previousMessages) => previousMessages.map((message) => (
        message.id === agentMessageId ? { ...message, content: '发送失败，请稍后重试。' } : message
      )));
    } finally {
      setIsLoading(false);
    }
  }

  function handleInputKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void sendMessage();
    }
  }

  if (!session) {
    return (
      <main className="login-shell">
        <section className="login-card">
          <p className="eyebrow">Business API</p>
          <h1>{authMode === 'login' ? '登录 Personal Agents' : '注册 Personal Agents'}</h1>
          <p className="login-hint">
            {authMode === 'login' ? '登录后进入桌面客户端。' : '注册成功后会自动登录。'}
            当前业务 API：{BUSINESS_API_URL}
          </p>

          <form className="login-form" onSubmit={handleLogin}>
            {authMode === 'login' ? (
              <label>
                <span>账号 / 邮箱</span>
                <input
                  value={account}
                  onChange={(event) => setAccount(event.target.value)}
                  autoComplete="username"
                  placeholder="请输入账号或邮箱"
                />
              </label>
            ) : (
              <>
                <label>
                  <span>用户名</span>
                  <input
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="请输入用户名"
                  />
                </label>

                <label>
                  <span>邮箱</span>
                  <input
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    autoComplete="email"
                    placeholder="请输入邮箱"
                  />
                </label>
              </>
            )}

            <label>
              <span>密码</span>
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
                placeholder="请输入密码"
              />
            </label>

            {loginError ? <p className="login-error">{loginError}</p> : null}

            <button type="submit" disabled={isLoggingIn}>
              {isLoggingIn ? '处理中...' : authMode === 'login' ? '登录' : '注册并登录'}
            </button>
          </form>

          <button
            className="auth-switch-button"
            type="button"
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'register' : 'login');
              setLoginError(null);
            }}
          >
            {authMode === 'login' ? '没有账号？立即注册' : '已有账号？返回登录'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">PA</span>
          <div>
            <h1>Personal Agents</h1>
            <p>桌面客户端</p>
          </div>
        </div>

        <button className="new-thread-button" type="button" onClick={createThread} disabled={isLoading}>
          新建会话
        </button>
        <div className="user-panel">
          <span>{session.user.username}</span>
          <button type="button" onClick={handleLogout}>退出登录</button>
        </div>

        <div className="thread-list">
          {threads.length === 0 ? (
            <p className="empty-state">暂无历史会话</p>
          ) : threads.map((thread) => (
            <button
              className={thread.thread_id === currentThreadId ? 'thread-item active' : 'thread-item'}
              key={thread.thread_id}
              type="button"
              onClick={() => void loadThread(thread.thread_id)}
              disabled={isLoading}
            >
              <span>{thread.thread_id.slice(0, 8)}</span>
              <small>{formatThreadTime(thread)}</small>
            </button>
          ))}
        </div>
      </aside>

      <section className="chat-panel">
        <header className="chat-header">
          <div>
            <p className="eyebrow">LangGraph API</p>
            <h2>{LANGGRAPH_API_URL}</h2>
          </div>
          <span className={errorText ? 'status warning' : 'status'}>{statusText}</span>
        </header>

        {errorText ? <div className="error-banner">{errorText}</div> : null}

        <div className="message-list">
          {messages.map((message) => (
            <article className={`message ${message.role}`} key={message.id}>
              <span>{message.role === 'user' ? '你' : 'Agent'}</span>
              <p>{message.content || '正在生成回复...'}</p>
            </article>
          ))}
          <div ref={messagesEndRef} />
        </div>

        <footer className="composer">
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            placeholder="输入消息，Enter 发送，Shift + Enter 换行"
            disabled={isLoading || !currentThreadId}
          />
          <button type="button" onClick={() => void sendMessage()} disabled={isLoading || !input.trim()}>
            {isLoading ? '处理中' : '发送'}
          </button>
        </footer>
      </section>
    </main>
  );
}

export default App;
