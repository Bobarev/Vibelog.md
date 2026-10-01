/**
 * Колонка Kanban-доски VL-27 (по мотивам kanban-column.tsx шаблона).
 *
 * Отличия от шаблона:
 * - нет перетаскивания самой колонки (useSortable) — порядок колонок
 *   соответствует порядку статусов в backlog.config.yml;
 * - колонка статуса динамическая (string), не union из data.ts.
 */

import { CollisionPriority } from '@dnd-kit/abstract';
import { useDroppable } from '@dnd-kit/react';
import { MoreVertical, Plus } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { SortableTaskCard } from './sortable-task-card';
import type { KanbanTask } from '../../types/kanban';

export function KanbanColumn({
  status,
  tasks,
  runningPhases,
}: {
  status: string;
  tasks: KanbanTask[];
  /** Задачи с запущенной фазой qwen (VL-28) — индикация на карточках. */
  runningPhases: Set<string>;
}) {
  // Контейнер задач: сюда перетаскиваются карточки (drop-цель колонки)
  const taskDropTarget = useDroppable({
    id: status,
    type: 'task-container',
    accept: 'task',
    collisionPriority: CollisionPriority.Low,
    data: { type: 'task-container', columnId: status },
  });

  return (
    <section className="flex min-h-0 flex-col rounded-t-xl border bg-muted/50 transition-colors">
      <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 space-y-1">
          <h2 className="truncate font-medium text-base leading-none">{status}</h2>
          <p className="text-muted-foreground text-sm tabular-nums leading-none">
            {tasks.length} {tasks.length === 1 ? 'задача' : 'задач'}
          </p>
        </div>
        <div className="-mr-2 flex items-center gap-0.5 text-muted-foreground">
          {/* Заглушка: создание задачи из колонки появится в VL-28 (оркестратор) */}
          <Button variant="ghost" size="icon-sm" disabled aria-label={`Добавить задачу в «${status}»`}>
            <Plus />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled aria-label={`Действия колонки «${status}»`}>
            <MoreVertical />
          </Button>
        </div>
      </div>

      <div
        ref={taskDropTarget.ref}
        className="scrollbar-thin flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 pb-3 [scrollbar-color:var(--border)_transparent] [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:w-1"
      >
        {tasks.map((task, taskIndex) => (
          <SortableTaskCard
            key={task.id}
            task={task}
            columnId={status}
            index={taskIndex}
            isRunning={runningPhases.has(task.id)}
          />
        ))}
      </div>
    </section>
  );
}
