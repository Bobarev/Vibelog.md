/**
 * Страница «Задачи — таблица» (#/tasks, VL-175).
 *
 * Владелец данных и состояния: загружает задачи + конфиг (Promise.all,
 * паттерн kanban.tsx), хранит сортировку/фильтры/пагинацию, рендерит
 * TasksFilters (VL-176), TasksTable (презентационная) и TaskModal для
 * просмотра по клику на строку.
 *
 * Цепочка обработки: filterTasks (6 multi-select групп, AND между ними) →
 * sortTasks → слайс страницы. Счётчик «Показано N из M» — после фильтров
 * (filteredCount) из общего числа загруженных (total). Смена фильтра или
 * сортировки сбрасывает страницу на 0 (первую).
 */

import * as React from "react";

import { RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { TaskModal } from "@/components/task-modal/task-modal";
import type { KanbanTask } from "@/types/kanban";

import { fetchConfig, fetchTasks, type TasksConfig } from "./api";
import { sortTasks, type SortState } from "./sort-tasks";
import { TasksFilters } from "./tasks-filters";
import { TasksTable } from "./tasks-table";
import { filterTasks, useTaskFilters, type TaskFilterKey } from "./use-task-filters";

/** Размер страницы по умолчанию (AC3: 25/50/100). */
const DEFAULT_PAGE_SIZE = 25;

/** Стартовая сортировка: свежие задачи сверху (AC: updated desc). */
const DEFAULT_SORT: SortState = { key: "updated_date", dir: "desc" };

export function TasksPage() {
  const [tasks, setTasks] = React.useState<KanbanTask[]>([]);
  const [config, setConfig] = React.useState<TasksConfig | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sort, setSort] = React.useState<SortState>(DEFAULT_SORT);
  const [page, setPage] = React.useState(0);
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE);
  // Фильтры multi-select: состояние + localStorage (VL-176)
  const { filters, setFilter, clearFilter, reset, isEmpty } = useTaskFilters();
  // Модалка просмотра (по клику на строку) — режим только view (VL-175)
  const [modal, setModal] = React.useState<{ open: boolean; task: KanbanTask | null }>({
    open: false,
    task: null,
  });

  /**
   * Начальная загрузка — инлайн promise-цепочка как в config-page:
   * setState только внутри then/catch (async-граница). Вынос в async
   * load() и вызов из effect давал бы react-hooks/set-state-in-effect
   * (setState синхронно в effect до первого await).
   */
  React.useEffect(() => {
    let cancelled = false;
    Promise.all([fetchTasks(), fetchConfig()])
      .then(([loadedTasks, loadedConfig]) => {
        if (cancelled) return;
        setTasks(loadedTasks);
        setConfig(loadedConfig);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        // Ошибка в state, не в консоль — lesson-16 (консоль без ошибок)
        setError(err instanceof Error ? err.message : "Неизвестная ошибка загрузки");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** (Пере)загрузка по кнопке «Обновить» и после сохранения в модалке. */
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [loadedTasks, loadedConfig] = await Promise.all([fetchTasks(), fetchConfig()]);
      setTasks(loadedTasks);
      setConfig(loadedConfig);
    } catch (err) {
      // Ошибка в state, не в консоль — lesson-16 (консоль без ошибок)
      setError(err instanceof Error ? err.message : "Неизвестная ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, []);

  // Цепочка VL-176: фильтры → сортировка → слайс страницы (см. шапку файла)
  const filtered = React.useMemo(() => filterTasks(tasks, filters), [tasks, filters]);
  const sorted = React.useMemo(
    () => sortTasks(filtered, sort, config ?? { statuses: [], priorities: [], types: [] }),
    [filtered, sort, config]
  );
  const filteredCount = sorted.length; // после фильтров (N в «Показано N из M»)

  /** Смена сортировки — сброс на первую страницу (AC: страница 0 при sort). */
  function handleSortChange(next: SortState) {
    setSort(next);
    setPage(0);
  }

  /**
   * Сброс страницы при смене любого фильтра — в хендлерах, а не useEffect
   * (паттерн VL-175: setPage синхронно в effect дал бы react-hooks/
   * set-state-in-effect; все изменения фильтров идут только из этих
   * хендлеров, поэтому поведение эквивалентно useEffect по filters/sort).
   */
  function handleFilterToggle(key: TaskFilterKey, value: string) {
    setFilter(key, value);
    setPage(0);
  }

  function handleFilterClearGroup(key: TaskFilterKey) {
    clearFilter(key);
    setPage(0);
  }

  function handleFilterReset() {
    reset();
    setPage(0);
  }

  /** Смена размера страницы — пересчёт не нужен, но страницу сбрасываем. */
  function handlePageSizeChange(next: number) {
    setPageSize(next);
    setPage(0);
  }

  // Страницы текущей страницы (0-based); сброс при sort/фильтрах — в хендлерах выше
  const pageTasks = sorted.slice(page * pageSize, page * pageSize + pageSize);

  return (
    // h-full min-h-0 flex flex-col — как Kanban (lesson-14): main остаётся
    // scroll-контейнером, таблица скроллится внутри TasksTable (flex-1 overflow-y-auto)
    <div className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border">
      {/* Шапка: заголовок + кнопка обновления */}
      <div className="flex shrink-0 items-center justify-between gap-3 border-b px-4 py-3 lg:px-6">
        <h1 className="font-medium text-base">Задачи — таблица</h1>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={loading ? "animate-spin" : undefined} data-icon="inline-start" />
          Обновить
        </Button>
      </div>

      {error ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-destructive text-sm">Ошибка загрузки: {error}</p>
        </div>
      ) : loading || !config ? (
        <div className="flex flex-1 items-center justify-center p-6">
          <p className="text-muted-foreground text-sm">Загрузка задач…</p>
        </div>
      ) : (
        <>
          {/* Панель фильтров (VL-176) — над таблицей; «Сбросить фильтры» внутри */}
          <TasksFilters
            filters={filters}
            config={config}
            tasks={tasks}
            isEmpty={isEmpty}
            onToggle={handleFilterToggle}
            onClearGroup={handleFilterClearGroup}
            onReset={handleFilterReset}
          />
          <TasksTable
            tasks={pageTasks}
            sort={sort}
            onSortChange={handleSortChange}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            onRowClick={(task) => setModal({ open: true, task })}
            filteredCount={filteredCount}
            total={tasks.length}
          />
        </>
      )}

      <TaskModal
        open={modal.open}
        onOpenChange={(open) => setModal((prev) => ({ ...prev, open }))}
        mode="view"
        task={modal.task}
        statuses={config?.statuses ?? []}
        // После сохранения/архивирования (view → edit) — перечитать список
        onSaved={() => void load()}
      />
    </div>
  );
}
