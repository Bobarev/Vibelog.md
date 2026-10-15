/**
 * Кнопка Поиск в шапке (VL-166).
 *
 * Скопирована из ref-2 search-dialog.tsx (кнопка + kbd), но БЕЗ
 * CommandDialog и обработчика: реализация поиска — отдельная задача.
 * Кнопка отображается, но неактивна: aria-disabled + title «Скоро»,
 * клик — no-op. Визуал (variant=link, kbd ⌘J) — как в референсе,
 * чтобы включить поиск было достаточно вернуть onClick.
 */

import { Search } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SearchButton() {
  return (
    <Button
      variant="link"
      className="px-0! font-normal text-muted-foreground hover:no-underline"
      aria-disabled="true"
      title="Скоро"
      onClick={(e) => {
        // No-op: поиск пока не реализован (VL-166 только размещает кнопку)
        e.preventDefault();
      }}
    >
      <Search data-icon="inline-start" />
      Поиск
      <kbd className="inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-medium text-[10px]">
        <span className="text-xs">⌘</span>J
      </kbd>
    </Button>
  );
}
