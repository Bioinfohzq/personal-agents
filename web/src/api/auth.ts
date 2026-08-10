import { BUSINESS_API_URL, readErrorMessage } from './http';

const SESSION_STORAGE_KEY = 'personal_agents_session';

// AuthUser 用户信息
// username / phone / email 三者可能只有其中一个有值（取决于注册方式）
export interface AuthUser {
  id: number;
  username: string;  // 用户名，可能为空字符串（用手机号/邮箱注册时）
  phone: string;     // 手机号，可能为空字符串（用用户名/邮箱注册时）
  email: string;     // 邮箱，可能为空字符串（用用户名/手机号注册时）
}

export interface AuthSession {
  token: string;
  user: AuthUser;
  // isGuest:是否为访客模式(不调后端登录接口,只体验聊天功能)
  //   true  → 访客,只能用聊天页面,密码本不可用(无真实 token)
  //   false → 正常登录用户,所有功能可用
  //   undefined → 兼容旧数据,视为非访客
  isGuest?: boolean;
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

// register 注册接口
// account: 账号（用户名 / 手机号 / 邮箱三选一），后端会自动识别类型
export async function register(account: string, password: string): Promise<AuthSession> {
  const response = await fetch(`${BUSINESS_API_URL}/api/v1/auth/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ account, password }),
  });

  if (!response.ok) {
    throw new Error(await readErrorMessage(response, response.status === 409 ? '该账号已存在' : '注册失败'));
  }

  const data = await response.json() as LoginResponse;
  return {
    token: data.token,
    user: data.user,
  };
}
