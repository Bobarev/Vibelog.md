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
import { AppSidebar } from "@/components/layout/app-sidebar"
import { SettingsPage } from "@/components/settings/settings"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useHashRoute } from "@/lib/use-hash-route"

export function App() {
  const route = useHashRoute()

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <main className="min-h-svh p-2">
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
