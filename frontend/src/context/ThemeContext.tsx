"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

export type ThemeMode = "dark" | "light";

interface ThemeContextType {
  theme: ThemeMode;
  toggleTheme: () => void;
  setTheme: (theme: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setThemeState] = useState<ThemeMode>("dark");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const savedTheme = localStorage.getItem("georoute_theme") as ThemeMode;
      if (savedTheme && (savedTheme === "dark" || savedTheme === "light")) {
        setThemeState(savedTheme);
        applyThemeClass(savedTheme);
      } else {
        applyThemeClass("dark");
      }
    }
  }, []);

  const applyThemeClass = (t: ThemeMode) => {
    if (typeof document !== "undefined") {
      const root = document.documentElement;
      if (t === "light") {
        root.classList.remove("dark");
        root.classList.add("light");
        document.body.classList.remove("bg-zinc-950", "text-zinc-100");
        document.body.classList.add("bg-slate-50", "text-slate-900");
      } else {
        root.classList.remove("light");
        root.classList.add("dark");
        document.body.classList.remove("bg-slate-50", "text-slate-900");
        document.body.classList.add("bg-zinc-950", "text-zinc-100");
      }
    }
  };

  const setTheme = (newTheme: ThemeMode) => {
    setThemeState(newTheme);
    applyThemeClass(newTheme);
    if (typeof window !== "undefined") {
      localStorage.setItem("georoute_theme", newTheme);
    }
  };

  const toggleTheme = () => {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used within a ThemeProvider");
  }
  return context;
}
