/**
 * Обёртка карточки с сортировкой/перетаскиванием VL-27
 * (по мотивам sortable-task-card.tsx шаблона).
 *
 * useSortable из @dnd-kit/react: id карточки + group = колонка (статус),
 * data несёт тип задачи для DragOverlay в kanban.tsx.
 */

import { useSortable } from '@dnd-kit/react/sortable';
import { cn } from 'cn';

import { TaskCard } from './task-card';
import type { KanbanTask } from '../../types/kanban';

export function SortableTaskCard({
  task,
  columnId,
  index,
  isRunning = false,
}: {
  task: KanbanTask;
  columnId: string;
  index: number;
  /** Идёт ли фаза qwen для этой задачи (VL-28). */
  isRunning?: boolean;
}) {
  const { isDragging, ref } = useSortable({
    id: task.id,
    index,
    type: 'task',
    accept: 'task',
    group: columnId,
    data: { type: 'task', task, columnId },
  });

  return (
    <div ref={ref} className={cn('touch-none', isDragging && 'opacity-30')}>
      <TaskCard task={task} isRunning={isRunning} />
    </div>
  );
}
