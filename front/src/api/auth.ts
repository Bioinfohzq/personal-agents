import { BUSINESS_API_URL, readErrorMessage } from './http';

const SESSION_STORAGE_KEY = 'personal_agents_session';

export interface AuthUser {
  id: number;
  username: string;
  email: string;
}

export interface AuthSession {
  token: string;
  user: AuthUser;
}

interface LoginResponse {
  token: string;
  user: AuthUser;
}

export function readStoredSession(): AuthSession | null {
  const rawSession = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!rawSession) {
    return null;
  }

  try {
    return JSON.parse(rawSession) as AuthSession;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function storeSession(session: AuthSession) {
  localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
}

export function clearStoredSession() {
  localStorage.removeItem(SESSION_STORAGE_KEY);
}

export async function login(account: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${BUSINESS_API_URL}/api/v1/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account, password }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, '账号或密码错误'));
  }

  const data = await response.json() as LoginResponse;
  return {
    token: data.token,
    user: data.user,
  };
}

export async function register(username: string, email: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${BUSINESS_API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, email, password }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, response.status === 409 ? '用户名或邮箱已存在' : '注册失败'));
  }

  const data = await response.json() as LoginResponse;
  return {
    token: data.token,
    user: data.user,
  };
}
