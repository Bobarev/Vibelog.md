/**
 * Общий кэш GET /api/config для веб-интерфейса (VL-345).
 *
 * Зачем: конфиг проекта нужен сразу нескольким потребителям — название
 * проекта в сайдбаре и титле (lib/use-project-name), статусы колонок доски
 * (components/kanban/api), статусы/приоритеты/типы таблицы задач
 * (components/tasks/api). До VL-345 каждый модуль дёргал /api/config сам,
 * и при загрузке страницы уходило 2–3 одинаковых запроса.
 *
 * Здесь промис кэшируется на уровне модуля: сколько бы потребителей ни
 * вызвало loadProjectConfig(), сеть дёргается один раз за жизнь страницы.
 * Ошибка не кэшируется как «успех» — потребители получают reject и берут
 * свои fallback-значения (lesson-16: в консоль ничего не пишем).
 */

/** Сырой конфиг проекта (ключи backlog/config.yml, snake_case). */
export type RawProjectConfig = Record<string, unknown>;

/** Кэш промиса запроса — общий для всех потребителей. */
let cachedConfig: Promise<RawProjectConfig> | null = null;

/** GET /api/config с кэшированием промиса (один запрос за жизнь страницы). */
export function loadProjectConfig(): Promise<RawProjectConfig> {
  if (!cachedConfig) {
    cachedConfig = (async () => {
      const res = await fetch("/api/config");
      if (!res.ok) throw new Error(`GET /api/config: ${res.status}`);
      return (await res.json()) as RawProjectConfig;
    })();
    // Неудачный запрос не должен «залипнуть» в кэше навсегда: следующий
    // вызов после ошибки попробует снова (например, сервер поднялся позже)
    cachedConfig.catch(() => {
      cachedConfig = null;
    });
  }
  return cachedConfig;
}

/**
 * Сброс кэша конфига.
 *
 * Нужен после сохранения конфига на #/config: значения могли измениться,
 * и следующий потребитель должен получить свежие данные.
 */
export function resetProjectConfigCache(): void {
  cachedConfig = null;
}
