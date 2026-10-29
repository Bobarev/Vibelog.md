/**
 * Таблица задач #/tasks — презентационный компонент (VL-175).
 *
 * Без своего состояния сортировки/пагинации: всё приходит пропсами от
 * TasksPage (владелец данных и state, см. tasks-page.tsx). Сортировка —
 * цикл по клику asc → desc → сброс (null), следующее состояние вычисляет
 * сама таблица и отдаёт наверх через onSortChange.
 *
 * Пагинация по мотивам getPageNumbers из ref-2
 * (next-shadcn-admin-dashboard, .../dashboard/tasks/_components/tasks.tsx):
 * окно из 3 номеров + многоточия до краёв.
 */

import { ArrowDown, ArrowUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KanbanTask } from "@/types/kanban";
import { cn } from "cn";
import type { SortKey, SortState } from "./sort-tasks";
import { headerIcons, labelTone, priorityBadge, statusIcon } from "./task-visuals";

/** Описание одной колонки: ключ сортировки + заголовок. */
interface ColumnDef {
  key: SortKey;
  label: string;
}

/** 8 колонок таблицы (AC1 VL-175). */
const COLUMNS: ColumnDef[] = [
  { key: "id", label: "ID" },
  { key: "title", label: "Title" },
  { key: "status", label: "Status" },
  { key: "priority", label: "Priority" },
  { key: "type", label: "Type" },
  { key: "labels", label: "Labels" },
  { key: "milestone", label: "Milestone" },
  { key: "updated_date", label: "Updated" },
];

/** Доступные размеры страницы (селект пагинации). */
const PAGE_SIZES = [25, 50, 100] as const;

/**
 * Окно номеров страниц (1-based): до 3 страниц — все, иначе 3 соседних
 * вокруг текущей; края скрыты за «…», если не примыкают к окну.
 */
function getPageNumbers(current: number, pageCount: number): (number | "…")[] {
  if (pageCount <= 3) {
    return Array.from({ length: pageCount }, (_, index) => index + 1);
  }
  let window: number[];
  if (current <= 2) window = [1, 2, 3];
  else if (current >= pageCount - 1) window = [pageCount - 2, pageCount - 1, pageCount];
  else window = [current - 1, current, current + 1];

  const result: (number | "…")[] = [];
  if (window[0] > 1) {
    result.push(1);
    if (window[0] > 2) result.push("…");
  }
  result.push(...window);
  if (window[2] < pageCount) {
    if (window[2] < pageCount - 1) result.push("…");
    result.push(pageCount);
  }
  return result;
}

/** Цикл сортировки колонки: asc → desc → сброс (null) → asc … */
function nextSort(sort: SortState, key: SortKey): SortState {
  if (!sort || sort.key !== key) return { key, dir: "asc" };
  if (sort.dir === "asc") return { key, dir: "desc" };
  return null;
}

/** Пропсы: строки текущей страницы + состояние из владельца (TasksPage). */
export interface TasksTableProps {
  /** Строки текущей страницы (уже отсортированные; фильтры — VL-176). */
  tasks: KanbanTask[];
  sort: SortState;
  onSortChange: (sort: SortState) => void;
  /** 0-based индекс страницы. */
  page: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
  /** Клик по строке — просмотр задачи в TaskModal. */
  onRowClick: (task: KanbanTask) => void;
  /** Всего задач после фильтров — для счётчика и числа страниц. */
  filteredCount: number;
  /** Всего загруженных задач (до фильтров). */
  total: number;
}

export function TasksTable({
  tasks,
  sort,
  onSortChange,
  page,
  pageSize,
  onPageChange,
  onPageSizeChange,
  onRowClick,
  filteredCount,
  total,
}: TasksTableProps) {
  const pageCount = Math.max(1, Math.ceil(filteredCount / pageSize));
  // Страховка: если страница устарела (смена pageSize/фильтров) — ближайшая валидная
  const currentPage = Math.min(page, pageCount - 1) + 1; // 1-based для рендера
  const pageNumbers = getPageNumbers(currentPage, pageCount);

  return (
    <>
      {/* Счётчик: сколько видно после фильтров из общего числа (AC3) */}
      <div className="shrink-0 border-b px-4 py-2 text-sm text-muted-foreground">
        Показано {filteredCount} из {total}
      </div>

      {/* Таблица скроллится внутри страницы — main остаётся scroll-контейнером (lesson-14) */}
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <Table>
          {/* Sticky-заголовок с иконками колонок — ref-2 kanban-table.tsx:97
              (bg-background sticky top-0 z-10 + headerIcons, VL-211/п.5) */}
          <TableHeader className="bg-background sticky top-0 z-10">
            <TableRow className="hover:bg-transparent">
              {COLUMNS.map((column) => {
                const active = sort?.key === column.key;
                const Icon = headerIcons[column.key];
                return (
                  <TableHead
                    key={column.key}
                    className="cursor-pointer select-none"
                    onClick={() => onSortChange(nextSort(sort, column.key))}
                    title={`Сортировать по ${column.label}`}
                  >
                    <span className="inline-flex items-center gap-2">
                      {Icon && <Icon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />}
                      {column.label}
                      {/* Индикатор направления: ArrowUp/ArrowDown есть в lucide-react (lesson-15) */}
                      {active && sort?.dir === "asc" ? (
                        <ArrowUp className="size-3.5" />
                      ) : active ? (
                        <ArrowDown className="size-3.5" />
                      ) : null}
                    </span>
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMNS.length} className="h-24 text-center text-muted-foreground">
                  Нет задач
                </TableCell>
              </TableRow>
            ) : (
              tasks.map((task) => (
                <TableRow
                  key={task.id}
                  className="cursor-pointer"
                  onClick={() => onRowClick(task)}
                >
                  <TableCell className="font-mono text-xs">{task.id}</TableCell>
                  <TableCell className="max-w-md truncate font-medium" title={task.title}>
                    {task.title}
                  </TableCell>
                  <TableCell>
                    {/* Статус: иконка из statusIcons + текст (ref-2
                        kanban-table-columns statusCell, VL-211/п.5);
                        без Select-смены — переходы валидирует workflow */}
                    <span className="inline-flex items-center gap-1.5">
                      {(() => {
                        const StatusIcon = statusIcon(task.status);
                        return <StatusIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />;
                      })()}
                      {task.status}
                    </span>
                  </TableCell>
                  <TableCell>
                    {/* Priority-Badge с иконкой и tone-цветом — ref-2 task-priority.ts */}
                    {(() => {
                      const priority = priorityBadge(task.priority);
                      const PriorityIcon = priority.icon;
                      return PriorityIcon ? (
                        <Badge variant={priority.variant} className={cn("rounded-md px-2", priority.className)}>
                          <PriorityIcon data-icon="inline-start" aria-hidden="true" />
                          {task.priority}
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="rounded-md px-2">
                          {task.priority}
                        </Badge>
                      );
                    })()}
                  </TableCell>
                  <TableCell>{task.type}</TableCell>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-1">
                      {task.labels.length === 0
                        ? "—"
                        : task.labels.map((label) => (
                            <Badge key={label} variant="secondary" className={labelTone(label)}>
                              {label}
                            </Badge>
                          ))}
                    </span>
                  </TableCell>
                  <TableCell>{task.milestone || "—"}</TableCell>
                  <TableCell className="tabular-nums" title={task.updated_date}>
                    {task.updated_date ? task.updated_date.slice(0, 10) : "—"}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Пагинация: размер страницы + Prev/Next + номера (AC3) */}
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          На странице
          <Select
            value={String(pageSize)}
            onValueChange={(value) => onPageSizeChange(Number(value))}
          >
            <SelectTrigger className="h-8 w-[72px]" size="sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAGE_SIZES.map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage <= 1}
            /* наверх отдаём 0-based */
            onClick={() => onPageChange(currentPage - 2)}
          >
            Prev
          </Button>
          {pageNumbers.map((number, index) =>
            number === "…" ? (
              <span key={`gap-${index}`} className="px-1.5 text-sm text-muted-foreground">
                …
              </span>
            ) : (
              <Button
                key={number}
                variant={number === currentPage ? "default" : "outline"}
                size="sm"
                className="w-8 px-0"
                onClick={() => onPageChange(number - 1)}
              >
                {number}
              </Button>
            )
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={currentPage >= pageCount}
            onClick={() => onPageChange(currentPage)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}
