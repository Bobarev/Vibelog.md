/**
 * Навигация сайдбара (VL-165) по паттерну ref-2 NavMain
 * (next-shadcn-admin-dashboard/.../sidebar/nav-main.tsx).
 *
 * Отличия от референса:
 * - вместо Next.js Link/usePathname — хеш-ссылки <a href="#/..."> и
 *   useHashRoute (адресная строка — единственный источник маршрута);
 * - вместо zustand/preference-store — статические пропсы items;
 * - бейджи не переносим; Quick Create живёт в app-sidebar.tsx (VL-163).
 *
 * Пункт с subItems: развёрнутый сайдбар — Collapsible + SidebarMenuSub
 * с поворотом ChevronRight; свёрнутый до иконок (collapsible=icon) —
 * DropdownMenu side="right", как Authentication в референсе.
 */

import * as React from "react";

import { ChevronRight } from "lucide-react";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useHashRoute, type Route } from "@/lib/use-hash-route";

/** Подпункт меню: всегда ссылка на хеш-маршрут. */
interface NavSubItem {
  id: string;
  title: string;
  url: Route;
  icon?: React.ComponentType<{ className?: string }>;
}

/** Пункт меню: ссылка ИЛИ родитель с подпунктами (как NavMainItem в ref-2). */
type NavItem =
  | {
      id: string;
      title: string;
      url: Route;
      icon: React.ComponentType<{ className?: string }>;
      /**
       * Дополнительные маршруты, где пункт активен (VL-174): например,
       * References подсвечивается и на детальной странице #/reference/<id>,
       * у которой свой Route — сравнивать только с url нельзя.
       */
      activeWhen?: Route[];
      subItems?: never;
    }
  | {
      id: string;
      title: string;
      url?: never;
      icon: React.ComponentType<{ className?: string }>;
      subItems: NavSubItem[];
    };

/** Группа сайдбара с опциональным заголовком (ref-2 NavGroup). */
export interface NavGroup {
  id: string;
  label?: string;
  items: NavItem[];
}

interface NavMainProps {
  readonly items: readonly NavGroup[];
}

function hasSubItems(item: NavItem): item is Extract<NavItem, { subItems: NavSubItem[] }> {
  return Boolean(item.subItems?.length);
}

export function NavMain({ items }: NavMainProps) {
  const route = useHashRoute();

  return (
    <>
      {items.map((group) => (
        <SidebarGroup key={group.id}>
          {group.label && (
            <SidebarGroupLabel className="group-data-[collapsible=icon]:pointer-events-none">
              {group.label}
            </SidebarGroupLabel>
          )}
          <SidebarGroupContent>
            <SidebarMenu>
              {group.items.map((item) =>
                hasSubItems(item) ? (
                  <NavParentItem key={item.id} item={item} route={route} />
                ) : (
                  <SidebarMenuItem key={item.id}>
                    <SidebarMenuButton
                      asChild
                      isActive={
                        route === item.url ||
                        (item.activeWhen?.includes(route) ?? false)
                      }
                      tooltip={item.title}
                    >
                      <a href={hrefFor(item.url)}>
                        <item.icon />
                        <span>{item.title}</span>
                      </a>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ),
              )}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ))}
    </>
  );
}

/** Хеш-ссылка: route 'board' — корень #/, остальные — #/<route>. */
function hrefFor(url: Route): string {
  return url === "board" ? "#/" : `#/${url}`;
}

/**
 * Родительский пункт с подпунктами: Collapsible при развёрнутом сайдбаре,
 * DropdownMenu при свёрнутом до иконок (state 'collapsed', не mobile).
 */
function NavParentItem({
  item,
  route,
}: {
  item: Extract<NavItem, { subItems: NavSubItem[] }>;
  route: Route;
}) {
  const { state, isMobile } = useSidebar();
  const isCollapsedDesktop = state === "collapsed" && !isMobile;
  const isActive = item.subItems.some((sub) => sub.url === route);

  if (isCollapsedDesktop) {
    return <NavDropdownItem item={item} isActive={isActive} route={route} />;
  }

  return <NavCollapsibleItem item={item} isActive={isActive} route={route} />;
}

/** Развёрнутый вариант: подменю раскрывается, ChevronRight поворачивается. */
function NavCollapsibleItem({
  item,
  isActive,
  route,
}: {
  item: Extract<NavItem, { subItems: NavSubItem[] }>;
  isActive: boolean;
  route: Route;
}) {
  // Контролируемый open: активный подпункт открывает submenu при смене
  // хеш-маршрута (defaultOpen не реактивен — risk из плана VL-165)
  const [open, setOpen] = React.useState(isActive);
  React.useEffect(() => {
    if (isActive) {
      // Открытие submenu при смене хеш-маршрута — синхронный setState в
      // effect по паттерну VL-165 (контролируемый Collapsible; risk из
      // плана: defaultOpen не реактивен) — подавление ложного срабатывания
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOpen(true);
    }
  }, [isActive]);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={isActive}>
            <item.icon />
            <span>{item.title}</span>
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <SidebarMenuSub>
            {item.subItems.map((subItem) => (
              <SidebarMenuSubItem key={subItem.id}>
                <SidebarMenuSubButton asChild isActive={subItem.url === route}>
                  <a href={hrefFor(subItem.url)}>
                    {subItem.icon && <subItem.icon />}
                    <span>{subItem.title}</span>
                  </a>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

/** Свёрнутый вариант: подпункты в выпадающем меню справа от иконки. */
function NavDropdownItem({
  item,
  isActive,
  route,
}: {
  item: Extract<NavItem, { subItems: NavSubItem[] }>;
  isActive: boolean;
  route: Route;
}) {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton tooltip={item.title} isActive={isActive}>
            <item.icon />
            <span>{item.title}</span>
          </SidebarMenuButton>
        </DropdownMenuTrigger>

        <DropdownMenuContent side="right" align="start" sideOffset={12} className="w-48">
          <DropdownMenuGroup>
            {item.subItems.map((subItem) => (
              <DropdownMenuItem key={subItem.id} asChild>
                <a
                  href={hrefFor(subItem.url)}
                  aria-current={subItem.url === route ? "page" : undefined}
                  className="flex items-center gap-2"
                >
                  {subItem.icon && <subItem.icon />}
                  <span>{subItem.title}</span>
                </a>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  );
}
