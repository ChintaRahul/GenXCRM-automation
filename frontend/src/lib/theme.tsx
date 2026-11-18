import { createContext, useContext, useEffect, useState } from "react";
import { syncStatusBar } from "./platform";

type Theme = "dark" | "light";

const ThemeContext = createContext<{ theme: Theme; toggleTheme: () => void; setTheme: (t: Theme) => void }>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
});

const DARK_QUERY = "(prefers-color-scheme: dark)";
const systemTheme = (): Theme => (window.matchMedia?.(DARK_QUERY).matches ? "dark" : "light");
const storedTheme = (): Theme | null => {
  const value = localStorage.getItem("theme");
  return value === "dark" || value === "light" ? value : null;
};

// Follows the device (prefers-color-scheme) until the user picks a theme; their pick is saved
// and wins from then on.
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [choice, setChoice] = useState<Theme | null>(storedTheme);
  const [system, setSystem] = useState<Theme>(systemTheme);
  const theme = choice ?? system;

  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = () => setSystem(query.matches ? "dark" : "light");
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    void syncStatusBar(theme);
  }, [theme]);

  const setTheme = (next: Theme) => {
    localStorage.setItem("theme", next);
    setChoice(next);
  };
  const toggleTheme = () => setTheme(theme === "dark" ? "light" : "dark");

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
