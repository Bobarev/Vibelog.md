/**
 * Постоянный сайдбар веб-интерфейса (VL-156).
 *
 * Паттерн по мотивам ref-2 (next-shadcn-admin-dashboard):
 * app-sidebar.tsx — SidebarHeader с логотипом + SidebarContent с NavMain.
 * Отличия: без Next.js Link/usePathname — хеш-ссылки <a href="#/...">;
 * без zustand/preference-store — статические пункты; footer вне скоупа.
 *
 * Навигация: Канбан (#/) ↔ Настройки (#/settings), адресная строка —
 * единственный источник маршрута (см. useHashRoute).
 */

import * as React from "react";

import { Command, Kanban, Settings } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";
import { useHashRoute } from "@/lib/use-hash-route";

/** Пункт навигации сайдбара. */
interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Маршрут, при котором пункт активен. */
  route: "board" | "settings";
}

const NAV_ITEMS: NavItem[] = [
  { title: "Канбан", url: "#/", icon: Kanban, route: "board" },
  { title: "Настройки", url: "#/settings", icon: Settings, route: "settings" },
];

export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const route = useHashRoute();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild>
              <a href="#/">
                <div className="bg-sidebar-primary text-sidebar-primary-foreground flex aspect-square size-8 items-center justify-center rounded-lg">
                  <Command className="size-4" />
                </div>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-semibold">Vibelog</span>
                  <span className="truncate text-xs">таск-менеджер</span>
                </div>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV_ITEMS.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={route === item.route}
                    tooltip={item.title}
                  >
                    <a href={item.url}>
                      <item.icon />
                      <span>{item.title}</span>
                    </a>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
