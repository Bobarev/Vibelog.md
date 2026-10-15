/**
 * Циклический переключатель темы в шапке (VL-166).
 *
 * По мотивам ref-2 theme-switcher.tsx: клик циклит light → dark → system.
 * Отличие от референса: иконки рендерятся по значению useTheme().theme
 * в JSX, а не CSS-хаком с html[data-theme-mode] — наш theme-provider
 * пишет классы light/dark прямо на documentElement, атрибута
 * data-theme-mode нет.
 */

import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/theme-provider";

/** Порядок цикла переключения тем. */
const THEME_CYCLE = ["light", "dark", "system"] as const;

/** Русские подписи тем для aria-label. */
const THEME_LABELS: Record<(typeof THEME_CYCLE)[number], string> = {
  light: "светлая",
  dark: "тёмная",
  system: "системная",
};

export function ThemeSwitcher() {
  const { theme, setTheme } = useTheme();

  const cycleTheme = () => {
    const currentIndex = THEME_CYCLE.indexOf(theme as (typeof THEME_CYCLE)[number]);
    const nextTheme = THEME_CYCLE[(currentIndex + 1) % THEME_CYCLE.length];
    setTheme(nextTheme);
  };

  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={cycleTheme}
      aria-label={`Текущая тема: ${THEME_LABELS[theme] ?? theme}. Нажмите, чтобы переключить`}
    >
      {/* Иконка по текущему значению темы (system → Monitor) */}
      {theme === "system" ? <Monitor /> : theme === "dark" ? <Sun /> : <Moon />}
    </Button>
  );
}
