"use client";

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";

import { api } from "@/api/client";
import type { User } from "@/api/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // On first mount, a stored token is verified against /me rather than trusted
  // blindly — it may have expired since the last visit.
  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setLoading(false);
      return;
    }
    api
      .get<{ user: User }>("/api/auth/me")
      .then(({ user }) => setUser(user))
      .catch(() => localStorage.removeItem("token"))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user, token } = await api.post<{ user: User; token: string }>("/api/auth/login", {
      email,
      password,
    });
    localStorage.setItem("token", token);
    setUser(user);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const { user, token } = await api.post<{ user: User; token: string }>("/api/auth/register", {
      email,
      password,
      name,
    });
    localStorage.setItem("token", token);
    setUser(user);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an AuthProvider");
  return ctx;
}
