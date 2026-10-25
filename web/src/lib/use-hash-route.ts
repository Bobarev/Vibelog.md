/**
 * Хеш-роутинг SPA веб-интерфейса (VL-156).
 *
 * Без react-router: сервер (src/web/static.ts) отдаёт index.html только на «/»,
 * поэтому хеш-маршруты (#/settings) не требуют серверной поддержки и работают
 * при любой выдаче статики (в т.ч. npm-пакет без web/dist перезагрузок).
 *
 * Маршруты: 'board' (#/ и всё, кроме явных), 'tasks' (#/tasks — таблица
 * задач с сортировкой/пагинацией, VL-175), 'settings' (#/settings,
 * .vibelog/settings.json), 'config' (#/config, backlog/config.yml — VL-165),
 * 'references' (#/references — список sources, VL-174) и 'reference'
 * (#/reference/<id> — детальная страница, VL-174).
 */

import * as React from 'react';

/** Страницы веб-интерфейса. */
export type Route = 'board' | 'tasks' | 'settings' | 'config' | 'references' | 'reference';

/** Текущий маршрут по location.hash. */
function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  if (path === 'settings') return 'settings';
  if (path === 'config') return 'config';
  if (path === 'tasks') return 'tasks';
  if (path === 'references') return 'references';
  // ВАЖНО: 'reference/<id>' — после 'references' (не пересекаются, но рядом:
  // 'references' — список, 'reference/ref-N' — детальная страница VL-174)
  if (path.startsWith('reference/')) return 'reference';
  return 'board';
}

/**
 * Подписка на хеш-маршрут: меняется адресная строка (клик по ссылке сайдбара
 * или ручной ввод) — компонент перерисовывается.
 */
export function useHashRoute(): Route {
  const [route, setRoute] = React.useState<Route>(() => parseHash(window.location.hash));
  React.useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

/** id reference из хеша `#/reference/<id>` (null, если маршрут другой). */
function parseReferenceId(hash: string): string | null {
  const match = hash.match(/^#\/reference\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Подписка на id reference из хеша (VL-174): детальная страница
 * `#/reference/ref-N` перерисовывается при смене id (навигация из списка
 * без перезагрузки — тот же паттерн, что useHashRoute).
 */
export function useReferenceId(): string | null {
  const [id, setId] = React.useState<string | null>(() => parseReferenceId(window.location.hash));
  React.useEffect(() => {
    const onChange = () => setId(parseReferenceId(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}
