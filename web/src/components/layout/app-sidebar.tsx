/**
 * Постоянный сайдбар веб-интерфейса (VL-156, переработан в VL-165).
 *
 * Паттерн ref-2 (next-shadcn-admin-dashboard): SidebarHeader с логотипом
 * Command + название, SidebarContent с NavMain (группы, collapsible-подменю).
 * Отличия: без Next.js Link — хеш-ссылки <a href="#/...">; без
 * zustand/preference-store — статические пункты; footer вне скоупа.
 *
 * Навигация (VL-165/VL-177): «Задачи» (#/ — доска/список, активен и на
 * #/tasks через activeWhen); «Настройки» — parent-пункт с подменю:
 * «Бот» (#/settings, .vibelog/settings.json) и «Конфиг проекта» (#/config,
 * backlog/config.yml). References (#/references, VL-174), Documents
 * (#/documents, VL-181) и Lessons (#/lessons, VL-182) — отдельные пункты
 * в группе «Основное»,
 * подсвечиваются и на детальных страницах #/reference/<id>, #/document/<id>,
 * #/lesson/<id> (activeWhen). Развёрнутый сайдбар — Collapsible +
 * SidebarMenuSub, свёрнутый до иконок — DropdownMenu (как Authentication
 * в референсе).
 */

import * as React from "react";

import { Command, FileText, FolderCog, Kanban, Library, Lightbulb, MessageSquare, PlusCircle, Settings, SlidersHorizontal, Wand2 } from "lucide-react";

import { Sidebar, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { NavMain, type NavGroup } from "@/components/layout/nav-main";

/** Группы навигации: «Задачи» + вложенное меню Настройки (VL-165/VL-177). */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: "Основное",
    items: [
      // Переименовано «Канбан» → «Задачи» (VL-177): пункт активен и на #/,
      // и на #/tasks (таблица) — activeWhen в nav-main (lesson-11:
      // активность по хеш-роуту; поле activeRoutes из плана не нужно —
      // в NavItem уже есть эквивалентное activeWhen из VL-174)
      {
        id: "board",
        title: "Задачи",
        url: "board",
        icon: Kanban,
        activeWhen: ["tasks"],
      },
      // References (VL-174): активен и на детальной странице #/reference/<id>
      // (activeWhen в nav-main — у неё свой Route 'reference')
      {
        id: "references",
        title: "References",
        url: "references",
        icon: Library,
        activeWhen: ["references", "reference"],
      },
      // Documents (VL-181): активен и на детальной странице #/document/<id>
      {
        id: "documents",
        title: "Documents",
        url: "documents",
        icon: FileText,
        activeWhen: ["documents", "document"],
      },
      // Lessons (VL-182): активен и на детальной странице #/lesson/<id>
      // (lesson-11 — активность по хеш-роуту, не defaultOpen)
      {
        id: "lessons",
        title: "Lessons",
        url: "lessons",
        icon: Lightbulb,
        activeWhen: ["lessons", "lesson"],
      },
      // Чат с LLM (VL-204): #/chat — обсуждение проекта и создание задач
      // через tool-calling с подтверждением Allow/Deny
      {
        id: "chat",
        title: "Чат",
        url: "chat",
        icon: MessageSquare,
        activeWhen: ["chat"],
      },
      {
        id: "settings",
        title: "Настройки",
        icon: Settings,
        subItems: [
          { id: "bot", title: "Бот", url: "settings", icon: SlidersHorizontal },
          { id: "config", title: "Конфиг проекта", url: "config", icon: FolderCog },
          // Мастер настройки проекта (VL-210): #/setup — агенты, LLM, секреты, бот, MCP
          { id: "setup", title: "Мастер настройки", url: "setup", icon: Wand2 },
        ],
      },
    ],
  },
];

export function AppSidebar({
  onQuickCreate,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  /** Клик Quick Create — открыть модалку создания задачи (VL-163). */
  onQuickCreate?: () => void;
}) {
  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#/">
                <Command />
                <span className="font-semibold text-base">Vibelog</span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {/* Quick Create — кнопка над навигацией, паттерн ref-2 (nav-main.tsx):
          bg-primary, tooltip при свёрнутом сайдбаре (VL-163) */}
      {onQuickCreate && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Создать задачу"
                  onClick={onQuickCreate}
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <PlusCircle />
                  <span>Создать задачу</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      <NavMain items={NAV_GROUPS} />
      <SidebarRail />
    </Sidebar>
  );
}
