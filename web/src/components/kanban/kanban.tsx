/**
 * Корневой компонент Kanban-доски VL-27 (по мотивам kanban.tsx шаблона).
 *
 * Отличия от шаблона:
 * - колонки динамические: статусы из GET /api/config, а не data.ts;
 * - тулбар Board/List/Table с поиском/фильтрами/сортировкой (VL-177):
 *   view board/list персистится в localStorage vibelog.tasks.view,
 *   таб Table уводит на #/tasks (hash главнее при конфликте — риск VL-177);
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

import { TaskModal } from '@/components/task-modal/task-modal';
import {
  QUICK_CREATE_EVENT,
  consumeQuickCreatePending,
  setQuickCreatePending,
} from '@/lib/quick-create';
import { OPEN_TASK_EVENT, consumePendingTaskId } from '@/lib/open-task';
import { sortTasks, type SortState } from '@/components/tasks/sort-tasks';
import { TasksFilters } from '@/components/tasks/tasks-filters';
import { TasksList } from '@/components/tasks/tasks-list';
import {
  TasksToolbar,
  filterBySearch,
  loadBoardView,
  saveBoardView,
  type BoardView,
  type TaskView,
} from '@/components/tasks/tasks-toolbar';
import {
  filterTasks,
  useTaskFilters,
} from '@/components/tasks/use-task-filters';
import { fetchConfig, type TasksConfig } from '@/components/tasks/api';

import { fetchTasks, fetchTask, getTriggerStatus, patchTaskStatus, triggerPhase } from './api';
import { KanbanColumn } from './kanban-column';
import { TaskCard } from './task-card';
import { buildBoard, findColumnId } from './utils';
import type { BoardState, KanbanTask } from '../../types/kanban';

/** Колонка-триггер → фаза оркестратора (VL-28): перенос сюда запускает qwen. */
const PHASE_BY_STATUS: Record<string, string> = {
  Spec: 'spec',
  'In Progress': 'plan',
  Review: 'code',
};

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
  // Конфиг проекта (statuses/priorities/types) — нужен сортировке (VL-177)
  const [config, setConfig] = React.useState<TasksConfig | null>(null);
  // Вид board/list: localStorage vibelog.tasks.view (try/catch в loadBoardView);
  // для table источник истины — hash #/tasks, туда вид не пишем (VL-177)
  const [view, setView] = React.useState<BoardView>(() => loadBoardView());
  // Поиск по id/title и единый sort-state тулбара (VL-177)
  const [search, setSearch] = React.useState('');
  const [sort, setSort] = React.useState<SortState>(null);
  // Панель фильтров (VL-176) раскрыта/скрыта кнопкой «Фильтр» в тулбаре
  const [filtersOpen, setFiltersOpen] = React.useState(false);
  // Фильтры multi-select: тот же localStorage-ключ, что на #/tasks — синхрон (VL-176)
  const { filters, setFilter, clearFilter, reset, isEmpty } = useTaskFilters();
  // Модалка задачи (VL-163): просмотр по клику на карточку, создание — Quick Create
  const [modal, setModal] = React.useState<{
    open: boolean;
    mode: 'view' | 'create' | 'edit';
    task: KanbanTask | null;
  }>({ open: false, mode: 'view', task: null });
  // Задачи с запущенной фазой qwen + таймеры поллинга их завершения (VL-28)
  const [runningPhases, setRunningPhases] = React.useState<Set<string>>(new Set());
  const pollTimers = React.useRef(new Map<string, ReturnType<typeof setInterval>>());
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

  /** (Пере)загрузка доски: задачи + конфиг (статусы колонок + порядок сортировки). */
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [tasks, loadedConfig] = await Promise.all([fetchTasks(), fetchConfig()]);
      applyBoard(buildBoard(tasks, loadedConfig.statuses));
      setConfig(loadedConfig);
      setColumnOrder(loadedConfig.statuses);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка загрузки');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка при монтировании: setState уходят в async-продолжение load
    // (после await), синхронен только setLoading(true) — паттерн проекта
    // (VL-27; тот же паттерн в references-page), правило линтера ложно
    // срабатывает на вызов async-функции из effect
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Quick Create сайдбара (VL-163): событие — если Kanban уже смонтирован;
  // модульный флаг — если запрос пришёл до монтирования (пользователь был
  // на другой странице, hash только что переключился на доску)
  React.useEffect(() => {
    const openCreate = () => {
      consumeQuickCreatePending(); // гасим флаг, чтобы не открыть повторно при remount
      setModal({ open: true, mode: 'create', task: null });
    };
    window.addEventListener(QUICK_CREATE_EVENT, openCreate);
    if (consumeQuickCreatePending()) {
      queueMicrotask(openCreate);
    }
    return () => window.removeEventListener(QUICK_CREATE_EVENT, openCreate);
  }, []);

  // Переход на задачу из deep-link (VL-182: source_tasks/linked_tasks на
  // страницах lessons). Два входа: событие — если Kanban уже смонтирован;
  // модульный флаг — если запрос пришёл до монтирования (dispatch события
  // идёт ДО смены hash, как в quick-create). Открытие — асинхронный
  // fetchTask; ошибка (задача в архиве/нет сети) — тихий fallback без
  // console (lesson-16), модалка просто не открывается.
  React.useEffect(() => {
    const openById = (id: string) => {
      if (!id) return;
      fetchTask(id)
        .then(task => setModal({ open: true, mode: 'view', task }))
        .catch(() => {
          /* тихий fallback: задача не найдена — модалка не открывается */
        });
    };
    const openFromEvent = (event: Event) => {
      // Гасим модульный флаг: событие и флаг могли оба сработать на одном
      // запросе — двойное открытие не нужно
      consumePendingTaskId();
      const id = (event as CustomEvent<{ id?: string }>).detail?.id;
      openById(typeof id === 'string' ? id : '');
    };
    window.addEventListener(OPEN_TASK_EVENT, openFromEvent);
    const pending = consumePendingTaskId();
    if (pending) {
      queueMicrotask(() => openById(pending));
    }
    return () => window.removeEventListener(OPEN_TASK_EVENT, openFromEvent);
  }, []);

  /** Клик по карточке — просмотр задачи в модалке (VL-163). */
  function openView(task: KanbanTask) {
    setModal({ open: true, mode: 'view', task });
  }

  /**
   * Переключение таба в тулбаре (VL-177): table — уход на #/tasks (источник
   * истины hash, вид в localStorage не пишем); board/list — запись вида
   * перед показом, чтобы перезагрузка открыла тот же вид.
   */
  function handleViewChange(next: TaskView) {
    if (next === 'table') {
      window.location.hash = '#/tasks';
      return;
    }
    saveBoardView(next);
    setView(next);
  }

  /**
   * «Создать задачу» в тулбаре — тот же Quick Create, что в сайдбаре
   * (флаг + событие; слушатель выше на этой же странице откроет модалку).
   */
  function handleAddTask() {
    setQuickCreatePending();
    window.dispatchEvent(new CustomEvent(QUICK_CREATE_EVENT));
  }

  /** После сохранения/архивирования — перечитать доску из файлов. */
  function handleSaved() {
    void load();
  }

  // Очистка поллинг-таймеров при размонтировании — иначе утечка setInterval
  React.useEffect(() => {
    const timers = pollTimers.current;
    return () => {
      for (const t of timers.values()) clearInterval(t);
      timers.clear();
    };
  }, []);

  /** Поллинг завершения фазы: running:false → перечитать доску (VL-28). */
  function startPolling(taskId: string) {
    setRunningPhases(prev => new Set(prev).add(taskId));
    const timer = setInterval(async () => {
      try {
        const run = await getTriggerStatus(taskId);
        if (!run.running) {
          clearInterval(timer);
          pollTimers.current.delete(taskId);
          setRunningPhases(prev => {
            const next = new Set(prev);
            next.delete(taskId);
            return next;
          });
          void load(); // доска подхватывает комментарий/статус из файлов
        }
      } catch {
        // Сетевая ошибка поллинга — пробуем в следующий тик
      }
    }, 3000);
    pollTimers.current.set(taskId, timer);
  }

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

      // VL-28: перенос в колонку-триггер запускает фазу qwen
      const phase = PHASE_BY_STATUS[newStatus];
      if (phase) {
        try {
          await triggerPhase(task.id, phase);
          startPolling(task.id);
        } catch (err2) {
          // Статус уже сохранён — доску не откатываем, только логируем
          console.error('Не удалось запустить фазу:', err2);
        }
      }
    } catch (err) {
      // Откат: файл не обновился — доска не должна врать
      applyBoard(boardBeforeDrag.current);
      console.error('Не удалось сменить статус задачи:', err);
    }
  }

  // Плоский массив всех загруженных задач — общий источник для опций
  // TasksFilters, поиска, сортировки и List-вида (VL-177)
  const allTasks = React.useMemo(() => Object.values(board).flat(), [board]);

  // Цепочка VL-177: фильтры (VL-176) → поиск по id/title → сортировка.
  // config null только до первой загрузки — пустой fallback стабилен
  // (status/priority уйдут в конец по configIndex, sort без ключа — копия)
  const visibleTasks = React.useMemo(() => {
    const byFilters = filterTasks(allTasks, filters);
    const bySearch = search.trim() ? filterBySearch(byFilters, search) : byFilters;
    return sortTasks(bySearch, sort, config ?? { statuses: [], priorities: [], types: [] });
  }, [allTasks, filters, search, sort, config]);

  // Разбивка в колонки ПОСЛЕ сортировки: порядок карточек внутри колонки
  // не персистится (PATCH при dnd пишет только status — VL-27), поэтому
  // сортировать безопасно; dnd-kit move() мутирует сырой board, вид
  // пересчитывается реактивно из него
  const visibleBoard = React.useMemo(() => {
    const next: BoardState = {};
    for (const status of columnOrder) next[status] = [];
    for (const task of visibleTasks) {
      if (!next[task.status]) next[task.status] = [];
      next[task.status].push(task);
    }
    return next;
  }, [visibleTasks, columnOrder]);

  const orderedColumns = columnOrder.filter(status => status in visibleBoard);

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border">
      {/* Тулбар видов с поиском/фильтром/сортировкой/созданием (VL-177,
          по образцу ref-2 kanban.tsx:114–173; «Обновить» перенесён из
          бывшей шапки kanban.tsx:233–237) */}
      <TasksToolbar
        view={view}
        onViewChange={handleViewChange}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={setSort}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen(prev => !prev)}
        onAddTask={handleAddTask}
        onRefresh={() => void load()}
        refreshing={loading}
      />

      {/* Панель фильтров (VL-176) — тот же компонент и localStorage-ключ,
          что на #/tasks; показ по кнопке «Фильтр» из тулбара */}
      {filtersOpen && !error && config && (
        <TasksFilters
          filters={filters}
          config={config}
          tasks={allTasks}
          isEmpty={isEmpty}
          onToggle={setFilter}
          onClearGroup={clearFilter}
          onReset={reset}
        />
      )}

      {error ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-destructive text-sm">Ошибка загрузки: {error}</p>
        </div>
      ) : loading ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-muted-foreground text-sm">Загрузка задач…</p>
        </div>
      ) : view === 'list' ? (
        // List-вид: те же фильтры/поиск/сортировка, что и у доски (VL-177)
        <TasksList tasks={visibleTasks} onTaskClick={openView} />
      ) : (
        <DragDropProvider onDragStart={handleDragStart} onDragOver={handleDragOver} onDragEnd={handleDragEnd}>
          <div className="scrollbar-thin min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden bg-muted/25 px-4 pt-4 pb-0 [scrollbar-color:var(--border)_transparent] lg:px-5 lg:pt-5 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-border [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar]:h-1">
            <div
              className="inline-grid h-full min-w-full gap-4"
              style={{ gridTemplateColumns: `repeat(${Math.max(orderedColumns.length, 1)}, minmax(20rem, 1fr))` }}
            >
              {orderedColumns.map(status => (
                <KanbanColumn
                  key={status}
                  status={status}
                  tasks={visibleBoard[status]}
                  runningPhases={runningPhases}
                  onTaskClick={openView}
                />
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

      {/* Модалка задачи (VL-163/VL-172): view/create/edit; statuses — колонки доски */}
      <TaskModal
        open={modal.open}
        onOpenChange={open => setModal(prev => ({ ...prev, open }))}
        mode={modal.mode}
        task={modal.task}
        statuses={columnOrder}
        onSaved={handleSaved}
        onTriggered={startPolling}
      />
    </div>
  );
}
