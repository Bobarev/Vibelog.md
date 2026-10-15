/**
 * Меню репозитория в шапке (VL-166).
 *
 * По мотивам ref-2 github-repositories-menu.tsx: DropdownMenu с кнопкой-
 * иконкой и пунктом-ссылкой на репозиторий. Иконка GitBranch вместо
 * Github: lucide-react 1.x мог удалить бренд-иконки (Github), GitBranch —
 * стандартная иконка, гарантированно есть.
 */

import { GitBranch } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/** Репозиторий проекта (gitverse — основной хостинг Vibelog.md). */
const REPOSITORY_URL = "https://gitverse.ru/bobarev/Vibelog.md";

export function RepoMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Репозиторий проекта">
          <GitBranch />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Проект</DropdownMenuLabel>
          <DropdownMenuItem asChild>
            <a href={REPOSITORY_URL} target="_blank" rel="noreferrer">
              Репозиторий Vibelog.md
            </a>
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
