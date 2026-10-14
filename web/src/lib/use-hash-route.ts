/**
 * Хеш-роутинг SPA веб-интерфейса (VL-156).
 *
 * Без react-router: сервер (src/web/static.ts) отдаёт index.html только на «/»,
 * поэтому хеш-маршруты (#/settings) не требуют серверной поддержки и работают
 * при любой выдаче статики (в т.ч. npm-пакет без web/dist перезагрузок).
 *
 * Маршруты: 'board' (#/ и всё, кроме #/settings) и 'settings' (#/settings).
 */

import * as React from 'react';

/** Страницы веб-интерфейса. */
export type Route = 'board' | 'settings';

/** Текущий маршрут по location.hash. */
function parseHash(hash: string): Route {
  return hash.replace(/^#/, '').replace(/^\//, '') === 'settings' ? 'settings' : 'board';
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
