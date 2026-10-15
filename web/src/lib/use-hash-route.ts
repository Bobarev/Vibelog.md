/**
 * Хеш-роутинг SPA веб-интерфейса (VL-156).
 *
 * Без react-router: сервер (src/web/static.ts) отдаёт index.html только на «/»,
 * поэтому хеш-маршруты (#/settings) не требуют серверной поддержки и работают
 * при любой выдаче статики (в т.ч. npm-пакет без web/dist перезагрузок).
 *
 * Маршруты: 'board' (#/ и всё, кроме #/settings и #/config),
 * 'settings' (#/settings, .vibelog/settings.json) и 'config' (#/config,
 * backlog/config.yml — VL-165).
 */

import * as React from 'react';

/** Страницы веб-интерфейса. */
export type Route = 'board' | 'settings' | 'config';

/** Текущий маршрут по location.hash. */
function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  if (path === 'settings') return 'settings';
  if (path === 'config') return 'config';
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
