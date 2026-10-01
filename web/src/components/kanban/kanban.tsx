/**
 * Корневой компонент Kanban-доски VL-27 (по мотивам kanban.tsx шаблона).
 *
 * Отличия от шаблона:
 * - колонки динамические: статусы из GET /api/config, а не data.ts;
 * - нет тулбара Tabs/Search/Filter/Sort (вне скоупа VL-27);
 * - после drag-and-drop — PATCH /api/tasks/:id со сменой status;
 *   при ошибке доска откатывается к состоянию до перетаскивания;
 * - директивы клиентского рантайма Next.js не нужны (Vite).
 */

import * as React from 'react';

import { move } from '@dnd-kit/helpers';
import {
  DragDropProvider,
  type DragEndEvent,
  type DragOverEvent,
  DragOverlay,
  type DragStartEvent,
} from '@dnd-kit/react';
import { RefreshCw } from 'lucide-react';

import { Button } from '@/components/ui/button';

import { fetchStatuses, fetchTasks, patchTaskStatus } from './api';
import { KanbanColumn } from './kanban-column';
import { TaskCard } from './task-card';
import { buildBoard, findColumnId } from './utils';
import type { BoardState, KanbanTask } from '../../types/kanban';

/** Drag-data карточки: проверяется перед использованием в DragOverlay. */
type TaskDragData = {
  type: 'task';
  task: KanbanTask;
  columnId: string;
};

function isTaskDragData(value: unknown): value is TaskDragData {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    (value as TaskDragData).type === 'task' &&
    'task' in value &&
    typeof (value as TaskDragData).task === 'object'
  );
}

export function Kanban() {
  const [board, setBoard] = React.useState<BoardState>({});
  const [columnOrder, setColumnOrder] = React.useState<string[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  // Снапшот доски перед перетаскиванием — для отката при отмене/ошибке
  const boardBeforeDrag = React.useRef<BoardState>({});
  // Зеркало board в рефе: обработчики dnd-kit живут в замыкании раннего
  // рендера, где board ещё пустой — без рефа handleDragEnd видел бы
  // протухшую доску и пропускал PATCH (найдено проверкой в браузере VL-27)
  const boardRef = React.useRef<BoardState>({});

  /** Единственная точка записи доски: state + ref синхронно. */
  function applyBoard(next: BoardState) {
    boardRef.current = next;
    setBoard(next);
  }

  /** (Пере)загрузка доски: задачи + статусы конфига. */
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, statuses] = await Promise.all([fetchTasks(), fetchStatuses()]);
      applyBoard(buildBoard(tasks, statuses));
      setColumnOrder(statuses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  function handleDragStart(event: DragStartEvent) {
    if (event.operation.source?.type === 'task') {
      boardBeforeDrag.current = boardRef.current;
    }
  }

  // Оптимистичное перемещение: карточка едет за курсором до завершения drag
  function handleDragOver(event: DragOverEvent) {
    if (event.operation.source?.type === 'task') {
      applyBoard(move(boardRef.current, event));
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { source } = event.operation;
    if (!source) return;

    // Отмена (Escape / бросок вне доски) — откат к снапшоту
    if (event.canceled) {
      if (source.type === 'task') {
        applyBoard(boardBeforeDrag.current);
      }
      return;
    }

    if (source.type !== 'task' || !isTaskDragData(source.data)) return;

    const task = source.data.task;
    // Новый статус = колонка, в которую карточка попала при оптимистичном
    // move() в handleDragOver. Берём из рефа: замыкание обработчика может
    // быть ранним, а ref всегда актуален.
    const newStatus = findColumnId(boardRef.current, task.id) ?? task.status;

    if (newStatus === task.status) return;

    try {
      await patchTaskStatus(task.id, newStatus);
      // Обновляем локальную копию задачи, чтобы карточка знала новый статус
      applyBoard(
        Object.fromEntries(
          Object.entries(boardRef.current).map(([status, tasks]) => [
            status,
            tasks.map(item => (item.id === task.id ? { ...item, status: newStatus } : item)),
          ])
        )
      );
    } catch (err) {
      // Откат: файл не обновился — доска не должна врать
      applyBoard(boardBeforeDrag.current);
      console.error('Не удалось сменить статус задачи:', err);
    }
  }

  const orderedColumns = columnOrder.filter(status => status in board);

  return (
    <div className="flex h-[calc(100dvh-2rem)] min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border">
      {/* Шапка: заголовок + кнопка обновления (тулбар шаблона вне скоупа VL-27) */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 lg:px-6">
        <h1 className="font-medium text-base">Задачи</h1>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? 'animate-spin' : undefined} data-icon="inline-start" />
          Обновить
        </Button>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-destructive text-sm">Ошибка загрузки: {error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-muted-foreground text-sm">Загрузка задач…</p>
        </div>
      ) : (
        <DragDropProvider onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden bg-muted/25 px-4 pt-4 pb-0 [scrollbar-color:var(--border)_transparent] lg:px-5 lg:pt-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1">
            <div
              className="inline-grid h-full min-w-full gap-4"
              style={{ gridTemplateColumns: `repeat(${Math.max(orderedColumns.length, 1)}, minmax(20rem, 1fr))` }}
            >
              {orderedColumns.map(status => (
                <KanbanColumn key={status} status={status} tasks={board[status]} />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>
            {(dragSource: unknown) => {
              if (
                typeof dragSource !== 'object' ||
                dragSource === null ||
                !isTaskDragData((dragSource as { data?: unknown }).data ?? dragSource)
              ) {
                return null;
              }
              const data = ((dragSource as { data: TaskDragData }).data ?? dragSource) as TaskDragData;
              return <TaskCard task={data.task} isOverlay />;
            }}
          </DragOverlay>
        </DragDropProvider>
      )}
    </div>
  );
}
