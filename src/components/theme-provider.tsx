"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { applyThemeColors, clearThemeColors } from "@/lib/themes";

interface AppSettings {
  set_as_default_browser: boolean;
  theme: string;
  custom_theme?: Record<string, string>;
}

interface ThemeContextValue {
  theme: string;
  setTheme: (theme: string) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  theme: "system",
  setTheme: () => {},
});

export function useTheme() {
  return useContext(ThemeContext);
}

interface CustomThemeProviderProps {
  children: React.ReactNode;
}

function resolveSystemTheme(): "light" | "dark" {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

// Vice-темы (линия Vice Antidetect): своя палитра поверх светлой или тёмной основы (globals.css)
const VICE_BASE: Record<string, "light" | "dark"> = {
  "vice-night": "dark",
  "vice-day": "light",
};

export function isViceTheme(theme: string | null | undefined): boolean {
  return !!theme && theme in VICE_BASE;
}

function applyClassToHtml(theme: string) {
  const vice = VICE_BASE[theme];
  const resolved = vice ?? (theme === "system" ? resolveSystemTheme() : theme);
  const root = document.documentElement;
  root.classList.remove("light", "dark", "vice", "vice-night", "vice-day");
  root.classList.add(resolved);
  if (vice) root.classList.add("vice", theme);
  // загрузчики набора дизайна в темах Vice — маслкар и катер; чихуахуа (на гидроцикле) — талисман Chihua, не Vice-линии
  delete root.dataset.brand;
  // линия (Chihua ↔ Vice Antidetect) идёт за темой: имена в полосе слева, заголовок окна
  window.dispatchEvent(
    new CustomEvent("chihua-line", { detail: vice ? "vice" : "cloud" }),
  );
}

export function CustomThemeProvider({ children }: CustomThemeProviderProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [theme, setThemeState] = useState("system");

  const setTheme = useCallback((newTheme: string) => {
    setThemeState(newTheme);
    if (newTheme === "custom") {
      applyClassToHtml("dark");
    } else {
      applyClassToHtml(newTheme);
    }
  }, []);

  // Линия (Chihua ↔ Vice Antidetect) идёт за темой: заголовок окна и подсказка значка в трее
  useEffect(() => {
    const onLine = (e: Event) => {
      const line = (e as CustomEvent<string>).detail === "vice" ? "vice" : "cloud";
      void import("@tauri-apps/api/core")
        .then(({ invoke }) => invoke("apply_line", { line }))
        .catch(() => undefined);
    };
    window.addEventListener("chihua-line", onLine);
    return () => window.removeEventListener("chihua-line", onLine);
  }, []);

  // Load initial theme from Tauri settings
  useEffect(() => {
    const loadTheme = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const settings = await invoke<AppSettings>("get_app_settings");
        let themeValue = settings?.theme ?? "dark";
        // Тема установки: установщик Vice Antidetect кладёт рядом с программой brand.json с линией vice. Один раз для
        // каждой линии ставим её тему по умолчанию; выбор, сделанный после этого в настройках, не трогаем.
        try {
          const brand = await invoke<{ line: string; theme: string }>(
            "get_brand",
          );
          const key = `chihua-brand-default-${brand.line}`;
          if (settings && brand.line && !localStorage.getItem(key)) {
            localStorage.setItem(key, "1");
            const want =
              brand.line === "vice"
                ? brand.theme || "vice-night"
                : isViceTheme(themeValue)
                  ? "dark"
                  : themeValue;
            if (want !== themeValue) {
              themeValue = want;
              void invoke("save_app_settings", {
                settings: { ...settings, theme: want },
              }).catch(() => undefined);
            }
          }
        } catch {
          // старая сборка без get_brand
        }
        // Фирменная тема Cloud VPN (тёмная): прежнее значение по умолчанию «как в системе» один раз переводим
        // на неё; выбор, сделанный после этого в настройках, не трогаем.
        try {
          const MIGRATED = "chihua-brand-theme-v1";
          if (!localStorage.getItem(MIGRATED)) {
            localStorage.setItem(MIGRATED, "1");
            if (themeValue === "system" && settings) {
              themeValue = "dark";
              void invoke("save_app_settings", {
                settings: { ...settings, theme: "dark" },
              }).catch(() => undefined);
            }
          }
        } catch {
          // localStorage недоступен — оставляем как есть
        }

        if (themeValue === "custom") {
          setThemeState("custom");
          applyClassToHtml("dark");
          if (
            settings.custom_theme &&
            Object.keys(settings.custom_theme).length > 0
          ) {
            try {
              applyThemeColors(settings.custom_theme);
            } catch (error) {
              console.warn("Failed to apply custom theme variables:", error);
            }
          }
        } else if (
          themeValue === "light" ||
          themeValue === "dark" ||
          themeValue === "system" ||
          isViceTheme(themeValue)
        ) {
          setThemeState(themeValue);
          applyClassToHtml(themeValue);
        } else {
          applyClassToHtml("system");
        }
      } catch (error) {
        console.warn(
          "Failed to load theme settings; defaulting to system:",
          error,
        );
        applyClassToHtml("system");
      } finally {
        setIsLoading(false);
      }
    };

    void loadTheme();
  }, []);

  // Re-apply custom theme after mount
  useEffect(() => {
    if (isLoading) return;
    if (theme !== "custom") {
      clearThemeColors();
      return;
    }
    const reapplyCustomTheme = async () => {
      try {
        const { invoke } = await import("@tauri-apps/api/core");
        const settings = await invoke<AppSettings>("get_app_settings");
        if (settings?.theme === "custom" && settings.custom_theme) {
          applyThemeColors(settings.custom_theme);
        }
      } catch (error) {
        console.warn("Failed to reapply custom theme:", error);
      }
    };
    const handle = window.setTimeout(() => {
      void reapplyCustomTheme();
    }, 100);
    return () => {
      window.clearTimeout(handle);
    };
  }, [isLoading, theme]);

  // Listen for system theme changes when in "system" mode
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyClassToHtml("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);

  if (isLoading) {
    return null;
  }

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}
