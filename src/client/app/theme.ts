export type ThemeMode = "light" | "dark";

const THEME_STORAGE_KEY = "mcp-inspector-theme";

function isThemeMode(value: string | null): value is ThemeMode {
  return value === "light" || value === "dark";
}

function systemTheme(): ThemeMode {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

export function applyTheme(mode: ThemeMode, persist = false): ThemeMode {
  document.documentElement.dataset.colorMode = mode;
  document.documentElement.dataset.lightTheme = "light";
  document.documentElement.dataset.darkTheme = "dark";
  document.documentElement.style.colorScheme = mode;
  if (persist) localStorage.setItem(THEME_STORAGE_KEY, mode);
  return mode;
}

export function applyInitialTheme(): ThemeMode {
  const saved = localStorage.getItem(THEME_STORAGE_KEY);
  return applyTheme(isThemeMode(saved) ? saved : systemTheme());
}

export function toggleTheme(current: ThemeMode): ThemeMode {
  return applyTheme(current === "light" ? "dark" : "light", true);
}
