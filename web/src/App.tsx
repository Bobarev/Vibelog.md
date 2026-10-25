/**
 * Корень веб-интерфейса (VL-165): сайдбар + контент по хеш-маршруту.
 *
 * Сайдбар — постоянный (ref-2 паттерн AppSidebar + SidebarProvider);
 * контент переключается по useHashRoute: Канбан (#/), Настройки бота
 * (#/settings, .vibelog/settings.json, VL-156), Конфиг проекта
 * (#/config, backlog/config.yml, VL-165) и References (#/references,
 * #/reference/<id>, VL-174).
 */

import { Kanban } from "@/components/kanban/kanban"
import { ConfigPage } from "@/components/config/config-page"
import { AppHeader } from "@/components/header/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { usePreferences } from "@/components/preferences"
import { ReferencesPage } from "@/components/references/references-page"
import { ReferenceDetail } from "@/components/references/reference-detail"
import { SettingsPage } from "@/components/settings/settings"
import { TasksPage } from "@/components/tasks/tasks-page"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useHashRoute, useReferenceId } from "@/lib/use-hash-route"
import { QUICK_CREATE_EVENT, setQuickCreatePending } from "@/lib/quick-create"

export function App() {
  const route = useHashRoute()
  const refId = useReferenceId()
  const { values } = usePreferences()

  /** Quick Create: открыть модалку создания задачи (VL-163/VL-177). */
  function handleQuickCreate() {
    // На #/tasks модалка создания живёт в TasksPage (VL-177): hash не
    // трогаем — иначе страница уедет на доску, TasksPage смонтируется и
    // открытая модалка пропадёт вместе с ним. Остальные страницы ведут на
    // доску (модалка Kanban), как раньше
    if (window.location.hash !== "#/tasks") {
      window.location.hash = "#/"
    }
    // Флаг — для случая, когда нужный компонент ещё не смонтирован (другая
    // страница, hash только что переключился); событие — когда целевая
    // страница уже открыта. Второе гасится потреблением флага.
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
          {route === "tasks" ? (
            <TasksPage />
          ) : route === "settings" ? (
            <SettingsPage />
          ) : route === "config" ? (
            <ConfigPage />
          ) : route === "references" ? (
            <ReferencesPage />
          ) : route === "reference" ? (
            <ReferenceDetail id={refId ?? ""} />
          ) : (
            <Kanban />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
