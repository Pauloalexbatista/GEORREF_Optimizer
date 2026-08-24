"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/utils/api";

interface User {
  id: number;
  nome: string;
  email: string;
  empresa_id: number;
  is_admin: boolean;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (empresaNome: string, utilizadorNome: string, email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    async function restoreSession() {
      const token = typeof window !== "undefined" ? localStorage.getItem("georoute_token") : null;
      if (!token) {
        setLoading(false);
        return;
      }

      let attempts = 0;
      const maxAttempts = 3;

      while (attempts < maxAttempts) {
        try {
          const userData = await apiRequest("/api/auth/me");
          setUser(userData);
          setLoading(false);
          return;
        } catch (e: any) {
          attempts++;
          const isNetworkErr = e.message?.includes("Failed to fetch") || e.name === "TypeError" || e.status === 502 || e.status === 503;
          if (isNetworkErr && attempts < maxAttempts) {
            await new Promise(r => setTimeout(r, 1000));
            continue;
          }
          
          // Session expired or invalid - silently clear and reset without noisy console errors
          localStorage.removeItem("georoute_token");
          setUser(null);
          break;
        }
      }
      setLoading(false);
    }
    restoreSession();
  }, []);

  const login = async (email: string, password: string) => {
    const cleanEmail = email.trim().toLowerCase();
    setLoading(true);
    try {
      const res = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: cleanEmail, password }),
      });
      localStorage.setItem("georoute_token", res.access_token);
      const userData = await apiRequest("/api/auth/me");
      setUser(userData);
      router.push("/dashboard");
      setLoading(false);
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const register = async (empresaNome: string, utilizadorNome: string, email: string, password: string) => {
    setLoading(true);
    try {
      await apiRequest("/api/auth/register", {
        method: "POST",
        body: JSON.stringify({
          empresa_nome: empresaNome,
          utilizador_nome: utilizadorNome,
          email,
          password,
        }),
      });
      await login(email, password);
    } catch (error) {
      setLoading(false);
      throw error;
    }
  };

  const logout = () => {
    localStorage.removeItem("georoute_token");
    setUser(null);
    router.push("/login");
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
