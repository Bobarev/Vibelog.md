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
 * 'references' (#/references — список sources, VL-174), 'reference'
 * (#/reference/<id> — детальная страница, VL-174), 'documents'
 * (#/documents — список документов, VL-181) и 'document'
 * (#/document/<id> — просмотр/редактирование документа, VL-181),
 * 'lessons' (#/lessons — список lessons, VL-182) и 'lesson'
 * (#/lesson/<id> — просмотр/редактирование lesson, VL-182).
 */

import * as React from 'react';

/** Страницы веб-интерфейса. */
export type Route =
  | 'board'
  | 'tasks'
  | 'chat'
  | 'settings'
  | 'config'
  | 'references'
  | 'reference'
  | 'documents'
  | 'document'
  | 'lessons'
  | 'lesson';

/** Текущий маршрут по location.hash. */
function parseHash(hash: string): Route {
  const path = hash.replace(/^#/, '').replace(/^\//, '');
  if (path === 'settings') return 'settings';
  if (path === 'config') return 'config';
  if (path === 'tasks') return 'tasks';
  // Чат с LLM (VL-204): точное совпадение до детальных префиксов
  if (path === 'chat') return 'chat';
  if (path === 'references') return 'references';
  // ВАЖНО: списки — точным совпадением ДО детальных префиксов
  // ('documents' — список, 'document/<id>' — детальная страница VL-181)
  if (path === 'documents') return 'documents';
  // ВАЖНО: 'lessons' — списком точным совпадением ДО детального префикса
  // 'lesson/<id>' (паттерн documents/document; сам по себе 'lessons' не
  // начинается с 'lesson/', но порядок фиксируем явно — VL-182)
  if (path === 'lessons') return 'lessons';
  // ВАЖНО: 'reference/<id>' — после 'references' (не пересекаются, но рядом:
  // 'references' — список, 'reference/ref-N' — детальная страница VL-174)
  if (path.startsWith('reference/')) return 'reference';
  if (path.startsWith('document/')) return 'document';
  if (path.startsWith('lesson/')) return 'lesson';
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

/** id документа из хеша `#/document/<id>` (null, если маршрут другой). */
function parseDocumentId(hash: string): string | null {
  const match = hash.match(/^#\/document\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Подписка на id документа из хеша (VL-181): детальная страница
 * `#/document/<id>` перерисовывается при смене id (навигация из списка
 * без перезагрузки — тот же паттерн, что useReferenceId).
 */
export function useDocumentId(): string | null {
  const [id, setId] = React.useState<string | null>(() => parseDocumentId(window.location.hash));
  React.useEffect(() => {
    const onChange = () => setId(parseDocumentId(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}

/** id lesson из хеша `#/lesson/<id>` (null, если маршрут другой). */
function parseLessonId(hash: string): string | null {
  const match = hash.match(/^#\/lesson\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Подписка на id lesson из хеша (VL-182): детальная страница
 * `#/lesson/lesson-N` перерисовывается при смене id (навигация из списка
 * без перезагрузки; guard пустого id — на стороне компонента, lesson-22).
 */
export function useLessonId(): string | null {
  const [id, setId] = React.useState<string | null>(() => parseLessonId(window.location.hash));
  React.useEffect(() => {
    const onChange = () => setId(parseLessonId(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return id;
}
