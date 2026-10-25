/**
 * List-вид задач (VL-177): строки из плоского массива, общего с доской
 * (фильтр → поиск → сортировка применяются владельцем до передачи сюда).
 *
 * Презентационный: без состояния сортировки/страниц — только рендер строк
 * и клик → onTaskClick (TaskModal view). Пусто → «Нет задач» (как в
 * TasksTable). Скролл внутри (flex-1 overflow-y-auto) — main остаётся
 * scroll-контейнером страницы (lesson-14).
 */

import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { KanbanTask } from "@/types/kanban";

/** Пропсы списка: строки + клик по строке. */
export interface TasksListProps {
  /** Уже отфильтрованные/отсортированные задачи (владелец — Kanban). */
  tasks: KanbanTask[];
  /** Клик по строке — просмотр задачи в TaskModal. */
  onTaskClick: (task: KanbanTask) => void;
}

/** 6 колонок списка: ID/Title/Status/Priority/Labels/Updated (AC3 VL-177). */
const COLUMN_COUNT = 6;

export function TasksList({ tasks, onTaskClick }: TasksListProps) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>ID</TableHead>
            <TableHead>Title</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Priority</TableHead>
            <TableHead>Labels</TableHead>
            <TableHead>Updated</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {tasks.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell
                colSpan={COLUMN_COUNT}
                className="h-24 text-center text-muted-foreground"
              >
                Нет задач
              </TableCell>
            </TableRow>
          ) : (
            tasks.map((task) => (
              <TableRow
                key={task.id}
                className="cursor-pointer"
                onClick={() => onTaskClick(task)}
              >
                <TableCell className="font-mono text-xs">{task.id}</TableCell>
                <TableCell className="max-w-md truncate font-medium" title={task.title}>
                  {task.title}
                </TableCell>
                <TableCell>
                  <Badge variant="secondary">{task.status}</Badge>
                </TableCell>
                <TableCell>
                  <Badge variant="outline">{task.priority}</Badge>
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1">
                    {task.labels.length === 0
                      ? "—"
                      : task.labels.map((label) => (
                          <Badge
                            key={label}
                            variant="outline"
                            className="rounded-md px-1.5 text-[11px]"
                          >
                            {label}
                          </Badge>
                        ))}
                  </span>
                </TableCell>
                <TableCell title={task.updated_date}>
                  {task.updated_date ? task.updated_date.slice(0, 10) : "—"}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}
