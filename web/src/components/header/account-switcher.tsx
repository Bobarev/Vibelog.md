/**
 * Юзер-меню в шапке (VL-166).
 *
 * По мотивам ref-2 account-switcher.tsx, но БЕЗ переключения юзеров:
 * в Vibelog один автор. Данные — git_user_name из GET /api/settings
 * (резолв: кэш .vibelog/settings.json → git config → '@agent', VL-166).
 * Пока API не ответил — AvatarFallback «?». Ошибка API не роняет шапку:
 * тихий fallback '@agent', без console.error (AC — чистая консоль).
 */

import * as React from "react";

import { ExternalLink, FolderCog, LogOut, SlidersHorizontal } from "lucide-react";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";

/** Fallback-имя, когда API недоступен или не вернул имя. */
const FALLBACK_NAME = "@agent";

export function AccountSwitcher() {
  // null — API ещё не ответил; строка — готовое имя (или fallback)
  const [name, setName] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/settings")
      .then((res) => {
        if (!res.ok) throw new Error(`GET /api/settings: ${res.status}`);
        return res.json() as Promise<{ git_user_name?: unknown }>;
      })
      .then((data) => {
        if (cancelled) return;
        const userName = data.git_user_name;
        setName(typeof userName === "string" && userName.trim() !== "" ? userName.trim() : FALLBACK_NAME);
      })
      .catch(() => {
        // Тихий fallback: шапка обязана работать без API (AC — чистая консоль)
        if (!cancelled) setName(FALLBACK_NAME);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar className="size-8 rounded-lg" aria-label="Меню пользователя">
          <AvatarFallback>{name === null ? "?" : getInitials(name)}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-56 space-y-1 rounded-lg" side="bottom" align="end" sideOffset={4}>
        <DropdownMenuLabel className="p-0 pl-1">
          <div className="flex w-full items-center gap-2 px-1 py-1.5">
            <Avatar className="size-9 rounded-lg">
              <AvatarFallback>{name === null ? "?" : getInitials(name)}</AvatarFallback>
            </Avatar>
            <div className="grid min-w-0 flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{name ?? "…"}</span>
              <span className="truncate text-xs text-muted-foreground">Автор Vibelog</span>
            </div>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <a href="#/settings">
              <SlidersHorizontal />
              Настройки бота
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="#/config">
              <FolderCog />
              Конфиг проекта
            </a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href="https://gitverse.ru/bobarev/Vibelog.md" target="_blank" rel="noreferrer">
              <ExternalLink />
              Репозиторий
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem disabled>
          <LogOut />
          Выйти
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
