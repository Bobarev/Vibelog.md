/**
 * List-вид задач (VL-211) — повторение ref-2 kanban-list.tsx:
 * задачи разбиты по статусам-группам (Collapsible), каждая группа —
 * шапка bg-muted/50 (иконка статуса, название, счётчик, счётчик
 * high-priority) и строки с бэйджами/иконками, как в референсе.
 *
 * Отличия от ref-2 (наши данные из KanbanTask):
 * - колонки динамические (config.statuses), не ideas/planned/...;
 * - вместо team-бэйджа — labels с tone-цветом (labelTone), вместо
 *   due-даты с прогрессом — due_date, вместо owner-аватара с tone —
 *   initials первого assignee;
 * - без dnd (строка кликается → TaskModal, как раньше);
 * - счётчик инсайтов — commentsCount (MessageSquare), attachments
 *   у нас не считаются.
 *
 * Пропсы-владелец: Kanban передаёт уже отфильтрованный/отсортированный
 * board (фильтры/поиск/сортировка применяются до сюда, VL-177).
 */

import { Flame, MessageSquare, MoreVertical, Plus } from "lucide-react";
import { cn } from "cn";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { getInitials } from "@/lib/utils";
import type { BoardState, KanbanTask } from "@/types/kanban";

import { labelTone, priorityBadge, statusIcon } from "./task-visuals";

/** Пропсы: разбитый по статусам доска + порядок колонок + клик по строке. */
export interface TasksListProps {
  /** Уже отфильтрованная/отсортированная доска (владелец — Kanban). */
  board: BoardState;
  /** Порядок статусов (columnOrder из конфига). */
  columnOrder: string[];
  /** Клик по строке — просмотр задачи в TaskModal. */
  onTaskClick: (task: KanbanTask) => void;
}

export function TasksList({ board, columnOrder, onTaskClick }: TasksListProps) {
  return (
    <div className="min-h-0 min-w-0 flex-1 overflow-y-auto">
      <div className="min-w-0 pb-4">
        {columnOrder.map((status) => {
          const tasks = board[status] ?? [];
          const StatusIcon = statusIcon(status);
          const highPriorityCount = tasks.filter((task) => task.priority === "High").length;

          return (
            <Collapsible key={status} defaultOpen className="border-b">
              <div className="bg-muted/50 hover:bg-muted flex items-center gap-1 pr-3 lg:pr-4.5">
                <h2 className="min-w-0 flex-1">
                  <CollapsibleTrigger className="focus-visible:ring-ring flex min-h-10 w-full items-center gap-2 py-2 pr-3 pl-4 text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-inset lg:pl-6">
                    <StatusIcon className="text-muted-foreground size-3.5 shrink-0" aria-hidden="true" />
                    {status}
                    <span className="text-muted-foreground font-normal tabular-nums">
                      {tasks.length}
                      <span className="sr-only"> задач</span>
                    </span>
                    {highPriorityCount > 0 && (
                      <span className="text-muted-foreground ml-auto hidden items-center gap-1.5 text-xs font-normal sm:flex">
                        <Flame className="text-destructive size-3.5" aria-hidden="true" />
                        {highPriorityCount} high priority
                      </span>
                    )}
                  </CollapsibleTrigger>
                </h2>
                {/* Декоративные кнопки действий группы — как в ref-2;
                    создание задачи в наших реалиях идёт через Quick Create */}
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`Создать задачу в «${status}»`}
                  type="button"
                  tabIndex={-1}
                >
                  <Plus />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="text-muted-foreground"
                  aria-label={`Действия группы «${status}»`}
                  type="button"
                  tabIndex={-1}
                >
                  <MoreVertical />
                </Button>
              </div>
              <CollapsibleContent>
                <ul aria-label={`Задачи статуса ${status}`}>
                  {tasks.map((task) => {
                    const priority = priorityBadge(task.priority);
                    const PriorityIcon = priority.icon;
                    const assignee = task.assignee[0] ?? "";

                    return (
                      <li key={task.id}>
                        <button
                          type="button"
                          className="hover:bg-muted/50 flex w-full items-center gap-3 border-b px-4 py-2.5 text-left lg:px-6"
                          onClick={() => onTaskClick(task)}
                        >
                          {PriorityIcon ? (
                            <Badge
                              variant={priority.variant}
                              className={cn("size-5 shrink-0 rounded-sm p-0", priority.className)}
                              title={`Приоритет: ${task.priority}`}
                            >
                              <PriorityIcon aria-hidden="true" />
                              <span className="sr-only">Приоритет {task.priority}</span>
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="size-5 shrink-0 rounded-sm p-0 text-[10px]">
                              {task.priority.slice(0, 1)}
                            </Badge>
                          )}
                          <span className="text-muted-foreground hidden shrink-0 font-mono text-xs sm:inline">
                            {task.id}
                          </span>
                          <span className="flex min-w-0 flex-1 flex-col items-start gap-2 sm:flex-row sm:items-center sm:gap-4">
                            <span className="w-full truncate text-sm font-normal sm:w-auto sm:flex-1" title={task.title}>
                              {task.title}
                            </span>
                            {task.labels.length > 0 && (
                              <span className="flex shrink-0 flex-wrap items-center gap-1">
                                {task.labels.slice(0, 3).map((label) => (
                                  <Badge key={label} variant="secondary" className={labelTone(label)}>
                                    {label}
                                  </Badge>
                                ))}
                              </span>
                            )}
                          </span>
                          {task.commentsCount > 0 && (
                            <span
                              className="text-muted-foreground hidden shrink-0 items-center gap-1 text-xs tabular-nums sm:flex"
                              title={`${task.commentsCount} комментариев`}
                            >
                              <MessageSquare className="size-3.5" aria-hidden="true" />
                              {task.commentsCount}
                              <span className="sr-only">комментариев</span>
                            </span>
                          )}
                          <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                            <span className="sr-only">Обновлено </span>
                            {task.updated_date ? task.updated_date.slice(0, 10) : "—"}
                          </span>
                          {assignee && (
                            <span className="flex shrink-0 items-center gap-1.5" title={assignee}>
                              <Avatar className="size-6">
                                <AvatarFallback className="rounded-sm text-[11px]">
                                  <span aria-hidden="true">{getInitials(assignee)}</span>
                                  <span className="sr-only">Исполнитель {assignee}</span>
                                </AvatarFallback>
                              </Avatar>
                            </span>
                          )}
                        </button>
                      </li>
                    );
                  })}
                  {tasks.length === 0 && (
                    <li className="text-muted-foreground px-4 py-6 text-sm lg:px-6">Нет задач</li>
                  )}
                </ul>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
