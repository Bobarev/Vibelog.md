/**
 * Панель multi-select фильтров таблицы #/tasks (VL-176).
 *
 * 6 кнопок-групп (Status/Priority/Type/Labels/Milestone/Assignee) по
 * паттерну ref-2 task-status-filter.tsx: DropdownMenu + checkbox-элементы,
 * onSelect preventDefault (меню не закрывается после выбора), кнопка
 * border-dashed без выбора → border-solid bg-muted при выбранных,
 * счётчик выбранных в скобках, крестик внутри меню снимает группу.
 *
 * Опции status/priority/type — из GET /api/config (VL-175, api.ts) плюс
 * фактические значения загруженных задач (union); labels/milestone/
 * assignee — уникальные значения из списка задач. Значения, сохранённые в
 * localStorage, но отсутствующие в задачах/конфиге, добавляются в опции
 * (риск VL-176): пункт остаётся видимым и выбранным, сброс корректен.
 *
 * Справа кнопка «Сбросить фильтры» (variant=destructive по паттерну
 * «Reset» ref-2 tasks-toolbar.tsx:41–49) — видна только при !isEmpty.
 */

import { ListFilter, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "cn";
import type { KanbanTask } from "@/types/kanban";

import type { TasksConfig } from "./api";
import type { TaskFilterKey, TaskFilters } from "./use-task-filters";

/** Описание одной группы фильтра: ключ + подпись на кнопке. */
interface FilterGroupDef {
  key: TaskFilterKey;
  label: string;
}

/** 6 групп в порядке отображения (порядок FILTER_KEYS хука). */
const GROUPS: FilterGroupDef[] = [
  { key: "status", label: "Статус" },
  { key: "priority", label: "Приоритет" },
  { key: "type", label: "Тип" },
  { key: "labels", label: "Метки" },
  { key: "milestone", label: "Веха" },
  { key: "assignee", label: "Исполнитель" },
];

/**
 * Опции группы: union конфига (для status/priority/type), фактические
 * значения задач и уже выбранные значения (чтобы «осиротевшие» пункты
 * оставались видимыми). Строки сортируются localeCompare — стабильный
 * порядок независимо от порядка загрузки задач.
 */
function buildOptions(
  key: TaskFilterKey,
  config: TasksConfig,
  tasks: KanbanTask[],
  selected: string[],
): string[] {
  const set = new Set<string>();
  // Значения из конфига первыми — порядок как в config.yml
  if (key === "status") config.statuses.forEach((value) => set.add(value));
  if (key === "priority") config.priorities.forEach((value) => set.add(value));
  if (key === "type") config.types.forEach((value) => set.add(value));
  // Фактические значения загруженных задач
  for (const task of tasks) {
    if (key === "labels") task.labels.forEach((value) => set.add(value));
    else if (key === "assignee") task.assignee.forEach((value) => set.add(value));
    else if (key === "milestone") {
      if (task.milestone) set.add(task.milestone);
    } else set.add(task[key]);
  }
  // Выбранные, но отсутствующие в данных — показать, чтобы сброс работал
  selected.forEach((value) => set.add(value));
  return Array.from(set).sort((a, b) => a.localeCompare(b, "ru"));
}

/** Пропсы панели: состояние фильтров + данные для опций + колбэки владельца. */
export interface TasksFiltersProps {
  filters: TaskFilters;
  /** Значения из GET /api/config (VL-175). */
  config: TasksConfig;
  /** Загруженный список задач — источник фактических значений. */
  tasks: KanbanTask[];
  /** Активен ли хоть один фильтр (видимость кнопки сброса). */
  isEmpty: boolean;
  /** Toggle значения в группе (повторный клик снимает). */
  onToggle: (key: TaskFilterKey, value: string) => void;
  /** Снять всю группу (крестик в меню). */
  onClearGroup: (key: TaskFilterKey) => void;
  /** «Сбросить фильтры» — пустые значения всех групп. */
  onReset: () => void;
}

export function TasksFilters({
  filters,
  config,
  tasks,
  isEmpty,
  onToggle,
  onClearGroup,
  onReset,
}: TasksFiltersProps) {
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-4 py-3 lg:px-6">
      {GROUPS.map(({ key, label }) => {
        const selected = filters[key];
        const options = buildOptions(key, config, tasks, selected);
        return (
          <DropdownMenu key={key}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                className={cn(
                  "border-dashed",
                  selected.length > 0 && "border-solid bg-muted text-foreground",
                )}
              >
                <ListFilter data-icon="inline-start" />
                {label}
                {selected.length > 0 ? ` (${selected.length})` : ""}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-50">
              <DropdownMenuGroup>
                {options.map((value) => (
                  <DropdownMenuCheckboxItem
                    key={value}
                    checked={selected.includes(value)}
                    onCheckedChange={() => onToggle(key, value)}
                    // Меню остаётся открытым — multi-select без закрытия
                    onSelect={(event) => event.preventDefault()}
                  >
                    {value}
                  </DropdownMenuCheckboxItem>
                ))}
              </DropdownMenuGroup>
              {selected.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup>
                    <DropdownMenuItem
                      onSelect={() => onClearGroup(key)}
                      className="justify-center text-center"
                    >
                      <X />
                      Сбросить группу
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        );
      })}

      {!isEmpty && (
        <Button variant="destructive" className="ml-auto" onClick={onReset}>
          <X data-icon="inline-start" />
          Сбросить фильтры
        </Button>
      )}
    </div>
  );
}
