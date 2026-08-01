import React, { createContext, useContext, useLayoutEffect, useState } from "react";

const STORAGE_KEY = "theme";
const LEGACY_KEY = "21r_dark";
const DEFAULT_THEME = "light";

function readInitialTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === "light" || v === "dark") return v;
    // Migrate legacy key "21r_dark" ("1" | "0")
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "1") return "dark";
    if (legacy === "0") return "light";
  } catch (e) { /* localStorage may be unavailable */ }
  return DEFAULT_THEME;
}

function applyTheme(theme) {
  const isDark = theme === "dark";
  document.documentElement.classList.toggle("dark", isDark);
  try {
    localStorage.setItem(STORAGE_KEY, theme);
    localStorage.setItem(LEGACY_KEY, isDark ? "1" : "0"); // back-compat
  } catch (e) { /* ignore */ }
}

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  dark: false,
  toggle: () => {},
  setTheme: () => {},
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(readInitialTheme);

  // Apply BEFORE first paint (useLayoutEffect blocks paint until class is set)
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

  // Sync across tabs / external writes to localStorage
  useLayoutEffect(() => {
    const onStorage = (e) => {
      if (e.key !== STORAGE_KEY) return;
      if ((e.newValue === "light" || e.newValue === "dark") && e.newValue !== theme) {
        setThemeState(e.newValue);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [theme]);

  const setTheme = (t) => setThemeState(t === "dark" ? "dark" : "light");
  const toggle = () => setThemeState((t) => (t === "dark" ? "light" : "dark"));

  return (
    <ThemeContext.Provider value={{ theme, dark: theme === "dark", toggle, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() { return useContext(ThemeContext); }
