/**
 * Корень веб-интерфейса (VL-165): сайдбар + контент по хеш-маршруту.
 *
 * Сайдбар — постоянный (ref-2 паттерн AppSidebar + SidebarProvider);
 * контент переключается по useHashRoute: Канбан (#/), Настройки бота
 * (#/settings, .vibelog/settings.json, VL-156) и Конфиг проекта
 * (#/config, backlog/config.yml, VL-165).
 */

import { Kanban } from "@/components/kanban/kanban"
import { ConfigPage } from "@/components/config/config-page"
import { AppHeader } from "@/components/header/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { usePreferences } from "@/components/preferences"
import { SettingsPage } from "@/components/settings/settings"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useHashRoute } from "@/lib/use-hash-route"
import { QUICK_CREATE_EVENT, setQuickCreatePending } from "@/lib/quick-create"

export function App() {
  const route = useHashRoute()
  const { values } = usePreferences()

  /** Quick Create: вернуться на доску (модалка живёт в Kanban) и открыть её. */
  function handleQuickCreate() {
    window.location.hash = "#/"
    // Флаг — для случая, когда Kanban ещё не смонтирован (другая страница);
    // событие — когда доска уже открыта. Второе гасится потреблением флага.
    setQuickCreatePending()
    window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT))
  }

  return (
    <SidebarProvider>
      {/* variant/collapsible из PreferencesProvider (VL-166): spread {...props}
          в AppSidebar переопределяет дефолт collapsible="icon" */}
      <AppSidebar
        variant={values.sidebar_variant}
        collapsible={values.sidebar_collapsible}
        onQuickCreate={handleQuickCreate}
      />
      <SidebarInset>
        <AppHeader />
        {/* main — scroll-контейнер (flex-1), header всегда виден (VL-166) */}
        <main className="min-h-0 flex-1 overflow-y-auto p-2">
          {route === "settings" ? (
            <SettingsPage />
          ) : route === "config" ? (
            <ConfigPage />
          ) : (
            <Kanban />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
