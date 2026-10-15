/**
 * Провайдер настроек вида (VL-166): variant и collapsible сайдбара.
 *
 * Аналог zustand-стора из ref-2 (next-shadcn-admin-dashboard), но на
 * React-контексте + localStorage — в проекте нет zustand и он не планируется.
 * Тема НЕ хранится здесь: она в theme-provider.tsx (useTheme), чтобы не
 * дублировать состояние и не ломать хоткей "d" и синхронизацию между вкладками.
 *
 * Ключ localStorage: vibelog-layout-prefs. Значения совпадают с пропсами
 * <Sidebar variant=... collapsible=...> из ui/sidebar.tsx — App.tsx читает
 * context и передаёт их в AppSidebar напрямую.
 */

import * as React from "react";

/** Вариант отображения сайдбара (как в ui/sidebar.tsx). */
export type SidebarVariant = "inset" | "sidebar" | "floating";

/** Режим сворачивания сайдбара (как в ui/sidebar.tsx). */
export type SidebarCollapsible = "offcanvas" | "icon" | "none";

/** Значения настроек вида. */
export interface LayoutPreferences {
  sidebar_variant: SidebarVariant;
  sidebar_collapsible: SidebarCollapsible;
}

/** Дефолты: variant=sidebar, collapsible=icon — текущее поведение AppSidebar (VL-165). */
const DEFAULT_PREFERENCES: LayoutPreferences = {
  sidebar_variant: "sidebar",
  sidebar_collapsible: "icon",
};

const STORAGE_KEY = "vibelog-layout-prefs";

type PreferencesContextValue = {
  values: LayoutPreferences;
  setPreference: <K extends keyof LayoutPreferences>(
    key: K,
    value: LayoutPreferences[K]
  ) => void;
};

const PreferencesContext = React.createContext<
  PreferencesContextValue | undefined
>(undefined);

/** Проверка, что строка из localStorage — валидный вариант. */
function isSidebarVariant(value: unknown): value is SidebarVariant {
  return value === "inset" || value === "sidebar" || value === "floating";
}

/** Проверка, что строка из localStorage — валидный режим сворачивания. */
function isSidebarCollapsible(value: unknown): value is SidebarCollapsible {
  return value === "offcanvas" || value === "icon" || value === "none";
}

/** Читает persisted-состояние: битый/чужой JSON не должен ронять приложение. */
function loadPreferences(): LayoutPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return DEFAULT_PREFERENCES;
    }
    const record = parsed as Record<string, unknown>;
    return {
      sidebar_variant: isSidebarVariant(record.sidebar_variant)
        ? record.sidebar_variant
        : DEFAULT_PREFERENCES.sidebar_variant,
      sidebar_collapsible: isSidebarCollapsible(record.sidebar_collapsible)
        ? record.sidebar_collapsible
        : DEFAULT_PREFERENCES.sidebar_collapsible,
    };
  } catch {
    // localStorage может бросить (приватный режим, quota) — не роняем UI
    return DEFAULT_PREFERENCES;
  }
}

export function PreferencesProvider({ children }: { children: React.ReactNode }) {
  //Ленивая инициализация: localStorage доступен только в браузере
  const [values, setValues] = React.useState<LayoutPreferences>(loadPreferences);

  const setPreference = React.useCallback(
    <K extends keyof LayoutPreferences>(key: K, value: LayoutPreferences[K]) => {
      setValues((prev) => {
        const next = { ...prev, [key]: value };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Приватный режим — настройки живут только в памяти сессии
        }
        return next;
      });
    },
    []
  );

  const value = React.useMemo(() => ({ values, setPreference }), [values, setPreference]);

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

/** Хук чтения/изменения настроек вида. */
export function usePreferences() {
  const context = React.useContext(PreferencesContext);
  if (context === undefined) {
    throw new Error("usePreferences must be used within a PreferencesProvider");
  }
  return context;
}
