/**
 * Шапка веб-интерфейса (VL-166).
 *
 * Полная копия композиции ref-2 (dashboard/layout.tsx:47-70):
 * header flex h-12 с двумя группами. Левая: SidebarTrigger + Separator +
 * глобальный поиск (VL-185). Правая: настройки вида, тема, репозиторий, юзер-меню.
 */

import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { AccountSwitcher } from "@/components/header/account-switcher";
import { LayoutControls } from "@/components/header/layout-controls";
import { RepoMenu } from "@/components/header/repo-menu";
import { GlobalSearch } from "@/components/header/search";
import { ThemeSwitcher } from "@/components/header/theme-switcher";

export function AppHeader() {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b transition-[width,height] ease-linear group-has-data-[collapsible=icon]/sidebar-wrapper:h-12">
      <div className="flex w-full items-center justify-between px-4 lg:px-6">
        <div className="flex items-center gap-1 lg:gap-2">
          <SidebarTrigger className="-ml-1" />
          <Separator
            orientation="vertical"
            className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
          />
          <GlobalSearch />
        </div>
        <div className="flex items-center gap-2">
          <LayoutControls />
          <ThemeSwitcher />
          <RepoMenu />
          <AccountSwitcher />
        </div>
      </div>
    </header>
  );
}
