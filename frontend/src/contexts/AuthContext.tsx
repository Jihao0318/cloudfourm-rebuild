import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import type { User } from '../types';
import { auth, setToken, getToken, setRefreshToken } from '../services/api';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (username: string, email: string, password: string, invite_code?: string) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    const token = getToken();
    if (!token) {
      setLoading(false);
      return;
    }
    try {
      const res = await auth.me();
      if (res.success && res.data) {
        setUser(res.data);
      } else {
        setToken(null);
      }
    } catch {
      // 网络抖动/5xx 等非 401 错误：保留本地 token，仅清用户态（避免一抖动就永久登出）；
      // 真正的会话失效（401）已由 api.ts 内部清 token 并派发 auth:expired，此处不重复清
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  // 监听全局 401 过期事件，自动跳转登录页（带上原路径，登录后回跳）
  useEffect(() => {
    const handler = () => {
      setUser(null);
      if (!['/login', '/register'].includes(window.location.pathname)) {
        const from = window.location.pathname + window.location.search;
        window.location.href = `/login?from=${encodeURIComponent(from)}`;
      }
    };
    window.addEventListener('auth:expired', handler);
    return () => window.removeEventListener('auth:expired', handler);
  }, []);

  const login = async (email: string, password: string) => {
    try {
      const res = await auth.login(email, password);
      if (res.success && res.data) {
        setToken(res.data.token);
        if (res.data.refresh_token) setRefreshToken(res.data.refresh_token);
        setUser(res.data.user);
        return { success: true };
      }
      // 透传 403 邮箱绑定/验证响应的 data（bind_token、has_email、masked_email），供登录页跳转绑定流程
      return { success: false, error: res.error, data: res.data };
    } catch (err: any) {
      return { success: false, error: err.message || '登录失败' };
    }
  };

  const register = async (username: string, email: string, password: string, invite_code?: string) => {
    try {
      const res = await auth.register(username, email, password, invite_code);
      if (res.success && res.data) {
        setToken(res.data.token);
        if (res.data.refresh_token) setRefreshToken(res.data.refresh_token);
        setUser(res.data.user);
        return { success: true };
      }
      // 透传 403 邮箱绑定/验证响应的 data（bind_token、has_email、masked_email），供登录页跳转绑定流程
      return { success: false, error: res.error, data: res.data };
    } catch (err: any) {
      return { success: false, error: err.message || '注册失败' };
    }
  };

  const logout = async () => {
    // 通知后端吊销全部会话（删 refresh tokens + token_version+1），失败不阻塞本地登出
    try { await auth.logout(); } catch {}
    setToken(null);
    setRefreshToken(null);
    setUser(null);
  };

  const refreshUser = async () => {
    await fetchUser();
  };


  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
