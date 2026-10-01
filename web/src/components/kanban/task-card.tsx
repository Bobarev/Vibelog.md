/**
 * Карточка задачи VL-27 (по мотивам task-card.tsx шаблона arhamkhnz).
 *
 * Отличия от шаблона: вместо owner/team/progress/insights — реальные поля
 * Vibelog (assignee[0] → аватар, labels[] → бейджи, commentsCount → иконка).
 * Директива клиентского рантайма Next.js и Progress-блок удалены:
 * в Vite всё клиентское, прогресса в данных Vibelog нет.
 */

import { cn } from 'cn';
import {
  ArrowUpRight,
  CalendarDays,
  Flame,
  type LucideIcon,
  Loader2,
  MessageSquare,
  Minus,
  Tag,
} from 'lucide-react';

import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { getInitials } from '@/lib/utils';

import type { KanbanTask } from '../../types/kanban';

/** Иконка и стиль бейджа приоритета (High/Medium/Low). */
const priorityBadgeConfig: Record<
  string,
  { icon: LucideIcon; variant: 'destructive' | 'secondary'; className: string }
> = {
  High: {
    icon: Flame,
    variant: 'destructive',
    className: 'border-transparent',
  },
  Medium: {
    icon: ArrowUpRight,
    variant: 'secondary',
    className: 'bg-amber-500/10 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300',
  },
  Low: {
    icon: Minus,
    variant: 'secondary',
    className: 'bg-slate-500/10 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  },
};

/** Значок приоритета с дефолтом: неизвестный приоритет → secondary без иконки-пламени. */
function priorityConfig(priority: string) {
  return priorityBadgeConfig[priority] ?? { icon: Minus, variant: 'secondary' as const, className: '' };
}

export function TaskCard({
  task,
  isOverlay = false,
  isRunning = false,
}: {
  task: KanbanTask;
  isOverlay?: boolean;
  /** Идёт ли фаза qwen (VL-28) — показываем индикатор. */
  isRunning?: boolean;
}) {
  const priority = priorityConfig(task.priority);
  const PriorityIcon = priority.icon;
  const assignee = task.assignee[0];

  return (
    <article
      className={cn(
        'flex flex-col gap-3 rounded-xl border bg-card p-4 text-card-foreground shadow-xs',
        isOverlay && 'w-68 rotate-1 shadow-lg',
      )}
    >
      <div className="min-w-0 space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="min-w-0 truncate font-medium text-sm leading-none">{task.title}</h3>
          <Badge
            variant={priority.variant}
            className={cn(
              'shrink-0 rounded-md border-transparent px-2 font-medium',
              priority.className,
            )}
          >
            <PriorityIcon data-icon="inline-start" />
            {task.priority}
          </Badge>
        </div>
        <p className="line-clamp-2 text-muted-foreground text-sm leading-5">{task.description}</p>
        {task.labels.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.labels.map(label => (
              <Badge key={label} variant="secondary" className="rounded-md px-1.5 text-[11px]">
                <Tag className="size-3" />
                {label}
              </Badge>
            ))}
          </div>
        ) : null}
        {task.lastComment ? (
          <p
            className="truncate text-muted-foreground text-xs"
            title={`${task.lastComment.author}: ${task.lastComment.text}`}
          >
            💬 {task.lastComment.author}: {task.lastComment.text}
          </p>
        ) : null}
      </div>

      <Separator />

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {assignee ? (
            <>
              <Avatar className="size-5 after:rounded-sm">
                <AvatarFallback className="rounded-sm text-[10px]">{getInitials(assignee)}</AvatarFallback>
              </Avatar>
              <span className="truncate text-muted-foreground text-sm">{assignee}</span>
            </>
          ) : (
            <span className="text-muted-foreground/60 text-sm">без исполнителя</span>
          )}
        </div>

        <div className="flex items-center gap-3 text-muted-foreground">
          {task.commentsCount > 0 ? (
            <span className="flex items-center gap-1.5 text-sm">
              <MessageSquare className="size-3.5" />
              {task.commentsCount}
            </span>
          ) : null}
          {task.due_date ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate text-sm">{task.due_date}</span>
              <CalendarDays className="size-3" />
            </span>
          ) : null}
        </div>
      </div>
      {isRunning ? (
        <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
          <Loader2 className="size-3 animate-spin" />
          фаза выполняется…
        </div>
      ) : null}
    </article>
  );
}
