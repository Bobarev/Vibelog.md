/**
 * Тулбар видов задач (VL-177): tabs Board/List/Table + поиск/фильтр/
 * сортировка/создание/обновление — по образцу ref-2 kanban.tsx:114–173
 * (next-shadcn-admin-dashboard).
 *
 * Владелец состояния — Kanban (#/) или TasksPage (#/tasks): тулбар
 * презентационный, весь state приходит пропсами (parent-child, lesson-19
 * не нужен). Здесь же живут helpers вида:
 * - loadBoardView/saveBoardView — localStorage vibelog.tasks.view хранит
 *   ТОЛЬКО board/list (источник истины для table — hash #/tasks, hash
 *   главнее при конфликте — риск VL-177);
 * - filterBySearch — case-insensitive substring по id/title (AC2).
 */

import {
  ArrowUpDown,
  Kanban as KanbanIcon,
  List,
  Plus,
  RefreshCw,
  SlidersHorizontal,
  Table2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { KanbanTask } from "@/types/kanban";

import type { SortKey, SortState } from "./sort-tasks";

/** Активный вид: board/list живут на #/, table — на #/tasks. */
export type TaskView = "board" | "list" | "table";

/** Режимы, которые персистятся в localStorage (table — через hash). */
export type BoardView = "board" | "list";

/** Ключ localStorage — вид board/list переживает перезагрузку (VL-177). */
const VIEW_STORAGE_KEY = "vibelog.tasks.view";

/** Подписи полей меню «Сортировка» — те же SortKey, что в заголовках таблицы. */
const SORT_FIELDS: Array<{ key: SortKey; label: string }> = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "type", label: "Type" },
  { key: "labels", label: "Labels" },
  { key: "milestone", label: "Milestone" },
  { key: "updated_date", label: "Updated" },
];

/**
 * Читает сохранённый вид board/list: битое значение, чужой JSON или
 * исключение (приватный режим Safari/Catalina) → board (все обращения
 * к localStorage через try/catch — lesson проекта).
 */
export function loadBoardView(): BoardView {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === "list" ? "list" : "board";
  } catch {
    return "board";
  }
}

/** Сохраняет вид board/list; исключение игнорируется — вид работает и без записи. */
export function saveBoardView(view: BoardView): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, view);
  } catch {
    // Приватный режим/quota — UI не должен падать из-за невозможности сохранить
  }
}

/**
 * Поиск по id/title: case-insensitive substring; пустой запрос возвращает
 * входной массив без копии (фильтр не нужен).
 */
export function filterBySearch(tasks: KanbanTask[], query: string): KanbanTask[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter(
    (task) => task.id.toLowerCase().includes(q) || task.title.toLowerCase().includes(q),
  );
}

/**
 * Выбор поля в меню сортировки: повторный клик не меняет состояние,
 * новое поле сохраняет текущее направление; первый выбор — desc для
 * Updated (свежие сверху), asc для остальных.
 */
function pickSortField(sort: SortState, key: SortKey): SortState {
  if (sort?.key === key) return sort;
  return { key, dir: sort?.dir ?? (key === "updated_date" ? "desc" : "asc") };
}

/** Пропсы тулбара: state и колбэки владельца (Kanban/TasksPage). */
export interface TasksToolbarProps {
  view: TaskView;
  onViewChange: (view: TaskView) => void;
  search: string;
  onSearchChange: (search: string) => void;
  /** Единый sort-state: меню «Сортировка» и заголовки таблицы — один владелец. */
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** Панель фильтров открыта — aria-pressed кнопки «Фильтр». */
  filtersOpen: boolean;
  onToggleFilters: () => void;
  onAddTask: () => void;
  onRefresh: () => void;
  /** Идёт загрузка — кнопка «Обновить» disabled + спиннер (как в шапке VL-27). */
  refreshing: boolean;
}

export function TasksToolbar({
  view,
  onViewChange,
  search,
  onSearchChange,
  sort,
  onSortChange,
  filtersOpen,
  onToggleFilters,
  onAddTask,
  onRefresh,
  refreshing,
}: TasksToolbarProps) {
  return (
    // layout как ref-2:112 — на узких экранах колонкой, на lg одной строкой
    <div className="flex shrink-0 flex-col gap-3 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between lg:px-6">
      <Tabs
        value={view}
        onValueChange={(value) => onViewChange(value as TaskView)}
        className="min-w-0"
      >
        {/* На мобильном табы во всю ширину, на sm+ — по содержимому (ref-2) */}
        <TabsList className="w-full *:data-[slot=tabs-trigger]:flex-1 sm:w-fit sm:*:data-[slot=tabs-trigger]:flex-none">
          <TabsTrigger value="board" className="gap-2">
            <KanbanIcon />
            Board
          </TabsTrigger>
          <TabsTrigger value="list" className="gap-2">
            <List />
            List
          </TabsTrigger>
          <TabsTrigger value="table" className="gap-2">
            <Table2 />
            Table
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center 2xl:justify-end">
        {/* Поиск по id/title — управляемый пропсами владельца (AC2) */}
        <Input
          type="search"
          name="tasks-search"
          aria-label="Поиск задач"
          placeholder="Поиск задач"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          className="min-w-0 sm:w-64"
        />
        <Button
          type="button"
          variant="outline"
          aria-pressed={filtersOpen}
          onClick={onToggleFilters}
        >
          <SlidersHorizontal data-icon="inline-start" />
          Фильтр
        </Button>

        {/* Сортировка: поле + направление — меню не закрывается при выборе
            поля (onSelect preventDefault, как в TasksFilters), закрывается
            после выбора направления */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="outline">
              <ArrowUpDown data-icon="inline-start" />
              Сортировка
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-50">
            <DropdownMenuLabel>Поле</DropdownMenuLabel>
            <DropdownMenuGroup>
              {SORT_FIELDS.map(({ key, label }) => (
                <DropdownMenuCheckboxItem
                  key={key}
                  checked={sort?.key === key}
                  onCheckedChange={() => onSortChange(pickSortField(sort, key))}
                  // Меню остаётся открытым — можно сразу сменить направление
                  onSelect={(event) => event.preventDefault()}
                >
                  {label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Направление</DropdownMenuLabel>
            <DropdownMenuGroup>
              {/* Направление имеет смысл только при выбранном поле:
                  до выбора поля пункты disabled */}
              <DropdownMenuRadioGroup
                value={sort?.dir ?? undefined}
                onValueChange={(dir) => {
                  if (sort) onSortChange({ ...sort, dir: dir === "desc" ? "desc" : "asc" });
                }}
              >
                <DropdownMenuRadioItem value="asc" disabled={!sort}>
                  По возрастанию
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="desc" disabled={!sort}>
                  По убыванию
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button type="button" onClick={onAddTask}>
          <Plus data-icon="inline-start" />
          Создать задачу
        </Button>

        {/* «Обновить» перенесён из шапки kanban.tsx:233–237 (VL-177) */}
        <Button type="button" variant="outline" onClick={onRefresh} disabled={refreshing}>
          <RefreshCw
            className={refreshing ? "animate-spin" : undefined}
            data-icon="inline-start"
          />
          Обновить
        </Button>
      </div>
    </div>
  );
}
