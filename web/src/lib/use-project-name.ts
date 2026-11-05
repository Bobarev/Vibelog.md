/**
 * Название проекта из backlog/config.yml для веб-интерфейса (VL-345).
 *
 * Зачем: при нескольких открытых проектах интерфейс не показывал, к какому
 * проекту он относится — в сайдбаре и в титле вкладки было литеральное
 * «Vibelog». Бэкенд уже отдаёт project_name в GET /api/config
 * (src/web/api.ts), не хватало только чтения на фронте.
 *
 * Запрос идёт через общий кэш lib/project-config: тот же /api/config
 * используют доска и таблица задач, поэтому на всю страницу уходит один
 * запрос (AC 9). Ошибка сети/не-200 не логируется в консоль (lesson-16) —
 * возвращается fallback, интерфейс остаётся рабочим.
 */

import * as React from "react";

import { loadProjectConfig } from "@/lib/project-config";

/** Запасное название: статичный титл из index.html и текст в сайдбаре. */
export const FALLBACK_PROJECT_NAME = "Vibelog";

/** project_name из конфига; пустое/нестроковое значение → fallback (AC 10). */
async function loadProjectName(): Promise<string> {
  try {
    const config = await loadProjectConfig();
    const name =
      typeof config.project_name === "string" ? config.project_name.trim() : "";
    return name || FALLBACK_PROJECT_NAME;
  } catch {
    return FALLBACK_PROJECT_NAME;
  }
}

/** Название проекта; до загрузки конфига и при ошибке — «Vibelog». */
export function useProjectName(): string {
  const [projectName, setProjectName] = React.useState<string>(FALLBACK_PROJECT_NAME);

  React.useEffect(() => {
    let alive = true;
    loadProjectName().then((name) => {
      // Компонент мог размонтироваться до ответа — состояние не трогаем
      if (alive) setProjectName(name);
    });
    return () => {
      alive = false;
    };
  }, []);

  return projectName;
}
