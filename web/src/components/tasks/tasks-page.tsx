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

import { TaskModal } from "@/components/task-modal/task-modal";
import { QUICK_CREATE_EVENT, consumeQuickCreatePending } from "@/lib/quick-create";
import type { KanbanTask } from "@/types/kanban";

import { fetchConfig, fetchTasks, type TasksConfig } from "./api";
import { sortTasks, type SortState } from "./sort-tasks";
import { TasksFilters } from "./tasks-filters";
import { TasksTable } from "./tasks-table";
import {
  TasksToolbar,
  filterBySearch,
  saveBoardView,
} from "./tasks-toolbar";
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
  // Поиск по id/title из тулбара — до сортировки, после фильтров (VL-177)
  const [search, setSearch] = React.useState("");
  // Панель фильтров открыта по умолчанию — как было до появления тулбара
  const [filtersOpen, setFiltersOpen] = React.useState(true);
  // Фильтры multi-select: состояние + localStorage (VL-176)
  const { filters, setFilter, clearFilter, reset, isEmpty } = useTaskFilters();
  // Модалка: view по клику на строку; create — кнопка «Создать задачу»
  // и Quick Create сайдбара (VL-177)
  const [modal, setModal] = React.useState<{
    open: boolean;
    mode: "view" | "create";
    task: KanbanTask | null;
  }>({ open: false, mode: "view", task: null });

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

  // Quick Create сайдбара на #/tasks (VL-177, паттерн kanban.tsx:119–133):
  // событие — если TasksPage уже смонтирована; флаг — если запрос пришёл
  // до монтирования (App не меняет hash с #/tasks, иначе страница уедет
  // на доску вместе с открытой модалкой). Оба потребителя (Kanban/TasksPage)
  // не смонтированы одновременно — взаимного срабатывания нет
  React.useEffect(() => {
    const openCreate = () => {
      consumeQuickCreatePending(); // гасим флаг, чтобы не открыть повторно при remount
      setModal({ open: true, mode: "create", task: null });
    };
    window.addEventListener(QUICK_CREATE_EVENT, openCreate);
    if (consumeQuickCreatePending()) {
      queueMicrotask(openCreate);
    }
    return () => window.removeEventListener(QUICK_CREATE_EVENT, openCreate);
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

  // Цепочка VL-176/VL-177: фильтры → поиск → сортировка → слайс страницы (см. шапку файла)
  const filtered = React.useMemo(() => filterTasks(tasks, filters), [tasks, filters]);
  const searched = React.useMemo(() => filterBySearch(filtered, search), [filtered, search]);
  const sorted = React.useMemo(
    () => sortTasks(searched, sort, config ?? { statuses: [], priorities: [], types: [] }),
    [searched, sort, config]
  );
  const filteredCount = sorted.length; // после фильтров (N в «Показано N из M»)

  /**
   * Таб Board/List в тулбаре — на #/ с записью вида в localStorage,
   * чтобы Kanban открыл нужный вид; table — уже здесь, хендлер не нужен
   * (AC1 VL-177). Смена вида не влияет на страницу.
   */
  function handleViewChange(next: "board" | "list" | "table") {
    if (next === "table") return;
    saveBoardView(next);
    window.location.hash = "#/";
  }

  /** «Создать задачу» в тулбаре — локальная модалка create (AC3 VL-177). */
  function handleAddTask() {
    setModal({ open: true, mode: "create", task: null });
  }

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
      {/* Тулбар видов (VL-177): view всегда 'table' — Board/List ведут на #/
          с записью вида в localStorage; поиск/сортировка — локальный state
          страницы, тот же sortTasks, что и в заголовках таблицы */}
      <TasksToolbar
        view="table"
        onViewChange={handleViewChange}
        search={search}
        onSearchChange={setSearch}
        sort={sort}
        onSortChange={handleSortChange}
        filtersOpen={filtersOpen}
        onToggleFilters={() => setFiltersOpen((prev) => !prev)}
        onAddTask={handleAddTask}
        onRefresh={() => void load()}
        refreshing={loading}
      />

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
          {/* Панель фильтров (VL-176) — раскрывается кнопкой «Фильтр» в
              тулбаре (VL-177); «Сбросить фильтры» внутри */}
          {filtersOpen && (
            <TasksFilters
              filters={filters}
              config={config}
              tasks={tasks}
              isEmpty={isEmpty}
              onToggle={handleFilterToggle}
              onClearGroup={handleFilterClearGroup}
              onReset={handleFilterReset}
            />
          )}
          <TasksTable
            tasks={pageTasks}
            sort={sort}
            onSortChange={handleSortChange}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            onPageSizeChange={handlePageSizeChange}
            onRowClick={(task) => setModal({ open: true, mode: "view", task })}
            filteredCount={filteredCount}
            total={tasks.length}
          />
        </>
      )}

      <TaskModal
        open={modal.open}
        onOpenChange={(open) => setModal((prev) => ({ ...prev, open }))}
        mode={modal.mode}
        task={modal.task}
        statuses={config?.statuses ?? []}
        // После сохранения/архивирования (view → edit) и создания — перечитать список
        onSaved={() => void load()}
      />
    </div>
  );
}
