/**
 * Постоянный сайдбар веб-интерфейса (VL-156, переработан в VL-165).
 *
 * Паттерн ref-2 (next-shadcn-admin-dashboard): SidebarHeader с логотипом
 * Command + название, SidebarContent с NavMain (группы, collapsible-подменю).
 * Отличия: без Next.js Link — хеш-ссылки <a href="#/...">; без
 * zustand/preference-store — статические пункты; footer вне скоупа.
 *
 * Навигация (VL-165): Канбан (#/); «Настройки» — parent-пункт с подменю:
 * «Бот» (#/settings, .vibelog/settings.json) и «Конфиг проекта» (#/config,
 * backlog/config.yml). References (#/references, VL-174) и Documents
 * (#/documents, VL-181) — отдельные пункты в группе «Основное»,
 * подсвечиваются и на детальных страницах #/reference/<id>, #/document/<id>
 * (activeWhen). Развёрнутый сайдбар — Collapsible + SidebarMenuSub,
 * свёрнутый до иконок — DropdownMenu (как Authentication в референсе).
 */

import * as React from "react";

import { Command, FileText, FolderCog, Kanban, Library, PlusCircle, Settings, SlidersHorizontal } from "lucide-react";

import { Sidebar, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { NavMain, type NavGroup } from "@/components/layout/nav-main";

/** Группы навигации: Канбан + вложенное меню Настройки (VL-165). */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: "Основное",
    items: [
      { id: "board", title: "Канбан", url: "board", icon: Kanban },
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
      {
        id: "settings",
        title: "Настройки",
        icon: Settings,
        subItems: [
          { id: "bot", title: "Бот", url: "settings", icon: SlidersHorizontal },
          { id: "config", title: "Конфиг проекта", url: "config", icon: FolderCog },
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
