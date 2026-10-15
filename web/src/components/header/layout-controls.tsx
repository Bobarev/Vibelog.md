/**
 * Настройки вида в шапке (VL-166).
 *
 * По мотивам ref-2 layout-controls.tsx, упрощённо (без zustand и
 * пресетов/шрифтов референса): Popover с 3 секциями ToggleGroup —
 * Тема (useTheme, theme-provider.tsx), стиль сайдбара и режим
 * сворачивания (usePreferences, preferences.tsx). Тексты на русском.
 */

import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useTheme } from "@/components/theme-provider";
import {
  usePreferences,
  type SidebarCollapsible,
  type SidebarVariant,
} from "@/components/preferences";

export function LayoutControls() {
  const { theme, setTheme } = useTheme();
  const { values, setPreference } = usePreferences();

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="icon" variant="ghost" aria-label="Параметры вида">
          <Settings />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end">
        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <h4 className="font-medium text-sm leading-none">Параметры вида</h4>
            <p className="text-muted-foreground text-xs">Настройте внешний вид интерфейса.</p>
          </div>
          <div className="space-y-3 **:data-[slot=toggle-group]:w-full **:data-[slot=toggle-group-item]:flex-1 **:data-[slot=toggle-group-item]:text-xs">
            <div className="space-y-1">
              <Label className="font-medium text-xs">Режим темы</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={theme}
                onValueChange={(value) => {
                  // Пустое значение — снятие выбора при повторном клике: игнорируем
                  if (value) setTheme(value as "light" | "dark" | "system");
                }}
              >
                <ToggleGroupItem value="light" aria-label="Светлая тема">
                  Светлая
                </ToggleGroupItem>
                <ToggleGroupItem value="dark" aria-label="Тёмная тема">
                  Тёмная
                </ToggleGroupItem>
                <ToggleGroupItem value="system" aria-label="Системная тема">
                  Системная
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">Стиль сайдбара</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={values.sidebar_variant}
                onValueChange={(value) => {
                  if (value) setPreference("sidebar_variant", value as SidebarVariant);
                }}
              >
                <ToggleGroupItem value="inset" aria-label="Врезной сайдбар">
                  Врезной
                </ToggleGroupItem>
                <ToggleGroupItem value="sidebar" aria-label="Обычный сайдбар">
                  Обычный
                </ToggleGroupItem>
                <ToggleGroupItem value="floating" aria-label="Плавающий сайдбар">
                  Плавающий
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="space-y-1">
              <Label className="font-medium text-xs">Режим сворачивания</Label>
              <ToggleGroup
                size="sm"
                spacing={0}
                variant="outline"
                type="single"
                value={values.sidebar_collapsible}
                onValueChange={(value) => {
                  if (value) setPreference("sidebar_collapsible", value as SidebarCollapsible);
                }}
              >
                <ToggleGroupItem value="offcanvas" aria-label="Выездной режим">
                  Выездной
                </ToggleGroupItem>
                <ToggleGroupItem value="icon" aria-label="Свёртка в иконки">
                  Иконки
                </ToggleGroupItem>
                <ToggleGroupItem value="none" aria-label="Без сворачивания">
                  Нет
                </ToggleGroupItem>
              </ToggleGroup>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
