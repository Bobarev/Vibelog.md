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
 * backlog/config.yml). Развёрнутый сайдбар — Collapsible + SidebarMenuSub,
 * свёрнутый до иконок — DropdownMenu (как Authentication в референсе).
 */

import * as React from "react";

import { Command, FolderCog, Kanban, Settings, SlidersHorizontal } from "lucide-react";

import { Sidebar, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { NavMain, type NavGroup } from "@/components/layout/nav-main";

/** Группы навигации: Канбан + вложенное меню Настройки (VL-165). */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: "Основное",
    items: [
      { id: "board", title: "Канбан", url: "board", icon: Kanban },
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

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
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
      <NavMain items={NAV_GROUPS} />
      <SidebarRail />
    </Sidebar>
  );
}
