/**
 * Хук multi-select фильтров таблицы #/tasks (VL-176) + чистая filterTasks.
 *
 * Состояние — 6 групп-массивов (AND между группами, OR внутри), живёт в
 * localStorage под ключом vibelog.tasks.filters и восстанавливается после
 * перезагрузки. Чтение — в useState-инициаторе, запись — в useEffect;
 * оба обёрнуты в try/catch по паттерну preferences.tsx (приватный режим
 * Safari/Catalina и quota не должны ронять UI — lesson: все обращения
 * к localStorage через try/catch). Битый/чужой JSON → пустые фильтры,
 * лишние ключи игнорируются, значения-не-строки отбрасываются.
 *
 * Значения фильтров, которых больше нет в задачах/конфиге, остаются в
 * состоянии (задача риска VL-176): filterTasks просто не найдёт совпадений,
 * а панель покажет их как выбранные — сброс работает корректно.
 */

import * as React from "react";

import type { KanbanTask } from "../../types/kanban";

/** Ключи фильтров — фиксированный набор из 6 групп. */
export type TaskFilterKey = "status" | "priority" | "type" | "labels" | "milestone" | "assignee";

/** Состояние фильтров: группа → выбранные значения (пустая группа = «всё»). */
export type TaskFilters = Record<TaskFilterKey, string[]>;

/** Ключ localStorage — единый на все 6 групп (один JSON-объект). */
const STORAGE_KEY = "vibelog.tasks.filters";

/** Порядок групп соответствует порядку кнопок в панели. */
const FILTER_KEYS: TaskFilterKey[] = ["status", "priority", "type", "labels", "milestone", "assignee"];

/** Пустые фильтры — состояние «ничего не отфильтровано». */
export function emptyFilters(): TaskFilters {
  return {
    status: [],
    priority: [],
    type: [],
    labels: [],
    milestone: [],
    assignee: [],
  };
}

/**
 * Читает фильтры из localStorage: битый JSON, чужой формат или исключение
 * (приватный режим) → пустые фильтры, UI продолжает работать без сохранения.
 */
function loadFilters(): TaskFilters {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyFilters();
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return emptyFilters();
    const record = parsed as Record<string, unknown>;
    const result = emptyFilters();
    for (const key of FILTER_KEYS) {
      const value = record[key];
      // Только массивы строк; не-строки отбрасываем — JSON мог прийти «снаружи»
      if (Array.isArray(value)) {
        result[key] = value.filter((item): item is string => typeof item === "string");
      }
    }
    return result;
  } catch {
    // localStorage может бросить (приватный режим, quota) — не роняем UI
    return emptyFilters();
  }
}

/** Сохраняет фильтры; исключение игнорируется — фильтры работают и без записи. */
function saveFilters(filters: TaskFilters): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filters));
  } catch {
    // Приватный режим/quota — UI не должен падать из-за невозможности сохранить
  }
}

/**
 * Чистая функция фильтрации (без React): AND между группами, OR внутри.
 * Пустая группа не фильтрует. labels/assignee — пересечение массивов задачи
 * с выбранными непустое; milestone/status/priority/type — точное равенство
 * одному из выбранных. Входной массив не мутируется; при отсутствии активных
 * групп возвращается тот же массив (без копии — фильтр не нужен).
 */
export function filterTasks(tasks: KanbanTask[], filters: TaskFilters): KanbanTask[] {
  const active = FILTER_KEYS.filter((key) => filters[key].length > 0);
  if (active.length === 0) return tasks;
  return tasks.filter((task) =>
    active.every((key) => {
      const selected = filters[key];
      switch (key) {
        // Массивные поля: достаточно одного совпадения (OR внутри группы)
        case "labels":
          return task.labels.some((value) => selected.includes(value));
        case "assignee":
          return task.assignee.some((value) => selected.includes(value));
        // Строковые поля: точное равенство одному из выбранных
        case "status":
          return selected.includes(task.status);
        case "priority":
          return selected.includes(task.priority);
        case "type":
          return selected.includes(task.type);
        case "milestone":
          return selected.includes(task.milestone);
      }
    }),
  );
}

/**
 * Хук фильтров: состояние + localStorage (чтение при инициализации, запись
 * в effect) + toggle/сброс. setFilter переключает значение в своей группе
 * (повторный клик снимает), clearFilter снимает всю группу (крестик в меню),
 * reset возвращает пустые фильтры. isEmpty — «активных фильтров нет»
 * (управляет видимостью кнопки «Сбросить фильтры»).
 */
export function useTaskFilters() {
  // Ленивая инициализация: localStorage доступен только в браузере
  const [filters, setFilters] = React.useState<TaskFilters>(loadFilters);

  // Запись при каждой смене фильтров; StrictMode-перерисовка идемпотентна
  // (сериализуется тот же JSON). setState в effect нет — линтер не ругается.
  React.useEffect(() => {
    saveFilters(filters);
  }, [filters]);

  /** Toggle значения в группе: есть — снять, нет — добавить. */
  const setFilter = React.useCallback((key: TaskFilterKey, value: string) => {
    setFilters((prev) => {
      const group = prev[key];
      const nextGroup = group.includes(value)
        ? group.filter((item) => item !== value)
        : [...group, value];
      return { ...prev, [key]: nextGroup };
    });
  }, []);

  /** Снять всю группу (крестик внутри меню). */
  const clearFilter = React.useCallback((key: TaskFilterKey) => {
    setFilters((prev) => ({ ...prev, [key]: [] }));
  }, []);

  /** «Сбросить фильтры» — пустые значения всех групп. */
  const reset = React.useCallback(() => {
    setFilters(emptyFilters());
  }, []);

  const isEmpty = FILTER_KEYS.every((key) => filters[key].length === 0);

  return { filters, setFilter, clearFilter, reset, isEmpty };
}
