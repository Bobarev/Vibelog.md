/**
 * Слой данных глобального поиска в шапке (VL-185).
 *
 * Ходит в REST API Vibelog (src/web/api.ts):
 * - GET /api/search?q=... — результаты, сгруппированные по 4 типам
 *   сущностей (tasks/lessons/references/documents), лимит 5 на тип и 20
 *   суммарно; Decisions не ищутся.
 *
 * Типы — зеркало src/core/search.ts (SearchTaskHit/…/GlobalSearchResults);
 * слим-ответ без description/body — экономия трафика (паттерн VL-174/181/182).
 */

/** Хит задачи: метаданные для рендера в dropdown (без description/планов). */
export interface SearchTaskHit {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: string;
  labels: string[];
}

/** Хит lesson: метаданные без body. */
export interface SearchLessonHit {
  id: string;
  title: string;
  status: string;
  tags: string[];
}

/** Хит reference: метаданные без body; url пуст у path-референсов. */
export interface SearchReferenceHit {
  id: string;
  title: string;
  type: string;
  url: string;
  tags: string[];
}

/** Хит документа: метаданные без body. */
export interface SearchDocumentHit {
  id: string;
  title: string;
  type: string;
  tags: string[];
}

/** Сгруппированный ответ GET /api/search. */
export interface SearchResults {
  query: string;
  tasks: SearchTaskHit[];
  lessons: SearchLessonHit[];
  references: SearchReferenceHit[];
  documents: SearchDocumentHit[];
}

/**
 * Глобальный поиск: GET /api/search?q=….
 *
 * Бросает Error при !res.ok — вызывающий код глушит ошибку тихо
 * (lesson-16: консоль без ошибок, dropdown просто не открывается).
 *
 * @param query — поисковый запрос (экранируется через encodeURIComponent)
 */
export async function fetchGlobalSearch(query: string): Promise<SearchResults> {
  const res = await fetch('/api/search?q=' + encodeURIComponent(query));
  if (!res.ok) throw new Error(`GET /api/search: ${res.status}`);
  return (await res.json()) as SearchResults;
}
