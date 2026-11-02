/**
 * Корень веб-интерфейса (VL-165): сайдбар + контент по хеш-маршруту.
 *
 * Сайдбар — постоянный (ref-2 паттерн AppSidebar + SidebarProvider);
 * контент переключается по useHashRoute: Канбан (#/), Настройки бота
 * (#/settings, .vibelog/settings.json, VL-156), Конфиг проекта
 * (#/config, backlog/config.yml, VL-165), References (#/references,
 * #/reference/<id>, VL-174), Documents (#/documents, #/document/<id>,
 * VL-181) и Lessons (#/lessons, #/lesson/<id>, VL-182).
 */

import { Kanban } from "@/components/kanban/kanban"
import { ChatPage } from "@/components/chat/thread"
import { ConfigPage } from "@/components/config/config-page"
import { DocumentDetail } from "@/components/documents/document-detail"
import { DocumentsPage } from "@/components/documents/documents-page"
import { AppHeader } from "@/components/header/app-header"
import { AppSidebar } from "@/components/layout/app-sidebar"
import { LessonDetail } from "@/components/lessons/lesson-detail"
import { LessonsPage } from "@/components/lessons/lessons-page"
import { usePreferences } from "@/components/preferences"
import { ReferencesPage } from "@/components/references/references-page"
import { ReferenceDetail } from "@/components/references/reference-detail"
import { SettingsPage } from "@/components/settings/settings"
import { SetupPage } from "@/components/setup/setup-page"
import { TasksPage } from "@/components/tasks/tasks-page"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { useHashRoute, useReferenceId, useDocumentId, useLessonId } from "@/lib/use-hash-route"
import { QUICK_CREATE_EVENT, setQuickCreatePending } from "@/lib/quick-create"

export function App() {
  const route = useHashRoute()
  const refId = useReferenceId()
  const docId = useDocumentId()
  const lessonId = useLessonId()
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
    <SidebarProvider className="h-svh min-h-0 overflow-hidden">
      {/* variant/collapsible из PreferencesProvider (VL-166): spread {...props}
          в AppSidebar переопределяет дефолт collapsible="icon" */}
      <AppSidebar
        variant={values.sidebar_variant}
        collapsible={values.sidebar_collapsible}
        onQuickCreate={handleQuickCreate}
      />
      {/* Фиксированный каркас (VL-263): SidebarInset получает реальную высоту
          (h-full + min-h-0 + overflow-hidden), поэтому скроллится не body, а
          внутренняя область. md:...h-[calc(100%-1rem)] компенсирует m-2 у
          variant=inset/floating, иначе низ уезжает за вьюпорт */}
      <SidebarInset className="h-full min-h-0 min-w-0 overflow-hidden overflow-x-clip md:peer-data-[variant=inset]:h-[calc(100%-1rem)]">
        <AppHeader />
        {/* main — scroll-контейнер (flex-1), header всегда виден (VL-166).
            Чат (VL-204) — overflow-hidden: скроллится viewport внутри
            Thread, двойного скролла быть не должно (lesson-14).
            min-w-0 + overflow-x-hidden (VL-211, ref-2 layout.tsx):
            min-content kanban-грида не пробрасывается до SidebarInset —
            шапка всегда по ширине вьюпорта, горизонтального скролла
            документа нет */}
        <main
          className={`min-h-0 min-w-0 flex-1 overflow-x-hidden ${
            route === "chat" ? "overflow-hidden" : "overflow-y-auto p-2"
          }`}
        >
          {route === "tasks" ? (
            <TasksPage />
          ) : route === "chat" ? (
            <ChatPage />
          ) : route === "settings" ? (
            <SettingsPage />
          ) : route === "config" ? (
            <ConfigPage />
          ) : route === "setup" ? (
            <SetupPage />
          ) : route === "references" ? (
            <ReferencesPage />
          ) : route === "reference" ? (
            <ReferenceDetail id={refId ?? ""} />
          ) : route === "documents" ? (
            <DocumentsPage />
          ) : route === "document" ? (
            <DocumentDetail id={docId ?? ""} />
          ) : route === "lessons" ? (
            <LessonsPage />
          ) : route === "lesson" ? (
            <LessonDetail id={lessonId ?? ""} />
          ) : (
            <Kanban />
          )}
        </main>
      </SidebarInset>
    </SidebarProvider>
  )
}

export default App
