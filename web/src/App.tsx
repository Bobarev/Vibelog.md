/**
 * Корень веб-интерфейса (VL-156): сайдбар + контент по хеш-маршруту.
 *
 * Сайдбар — постоянный (ref-2 паттерн AppSidebar + SidebarProvider);
 * контент переключается Канбан ↔ Настройки через useHashRoute (#/ ↔ #/settings).
 */

import { Kanban } from "@/components/kanban/kanban"
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
        <main className="min-h-svh p-2">{route === "settings" ? <SettingsPage /> : <Kanban />}</main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
