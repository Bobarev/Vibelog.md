/**
 * Глобальный поиск в шапке (VL-185).
 *
 * Input с debounce 300ms → GET /api/search → dropdown, сгруппированный
 * по типам (Задачи / Lessons / References / Документы). Клик:
 * - задача → requestOpenTask(id): маршрута #/task/<id> в роутере нет,
 *   открытие — доска + модалка (паттерн lesson-detail/quick-create);
 * - lesson/reference/document → существующие hash-роуты
 *   #/lesson/<id>, #/reference/<id>, #/document/<id>.
 *
 * Заменяет заглушку SearchButton из VL-166 (кнопка была неактивна).
 *
 * Гонки ответов при быстрой печати закрываются seq-guard: опоздавший
 * ответ не перетирает более свежий. Ошибки fetch глушатся тихо
 * (lesson-16 — консоль без ошибок).
 */

import * as React from "react";
import { Search } from "lucide-react";

import { Input } from "@/components/ui/input";
import { requestOpenTask } from "@/lib/open-task";
import {
  fetchGlobalSearch,
  type SearchResults,
} from "@/components/header/search-api";

/** Debounce ввода (мс) — не долбить API на каждой букве. */
const DEBOUNCE_MS = 300;

export function GlobalSearch() {
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SearchResults | null>(null);
  const [open, setOpen] = React.useState(false);

  // ref контейнера — для закрытия по клику вне (document mousedown)
  const containerRef = React.useRef<HTMLDivElement>(null);
  // seq-guard: номер запроса; ответ со старым seq игнорируется
  const seqRef = React.useRef(0);

  // Debounce 300ms: пустой ввод → сразу закрыть без запроса
  React.useEffect(() => {
    const q = query.trim();
    if (!q) {
      // Гасим seq: опоздавший ответ на очищенный запрос тоже игнорируется
      seqRef.current += 1;
      // Debounce-ветка эффекта: сброс dropdown при очистке ввода
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setResults(null);
      setOpen(false);
      return;
    }

    const seq = ++seqRef.current;
    const timer = setTimeout(async () => {
      try {
        const data = await fetchGlobalSearch(q);
        // Опоздавший ответ не перетирает более свежий (гонка при печати)
        if (seq !== seqRef.current) return;
        setResults(data);
        setOpen(true);
      } catch {
        // Тихий fallback: dropdown просто не открывается (lesson-16)
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  // Закрытие: Escape и клик вне контейнера
  React.useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onMouseDown = (e: MouseEvent) => {
      const el = containerRef.current;
      if (el && e.target instanceof Node && !el.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onMouseDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  /** Переход по пункту: задача → модалка, остальные → hash-роут. */
  const go = (kind: "task" | "lesson" | "reference" | "document", id: string) => {
    if (kind === "task") {
      requestOpenTask(id);
    } else {
      // Хэш-роутинг из обработчика клика — не рендер/эффект компонента
      // eslint-disable-next-line react-hooks/immutability
      window.location.hash = `#/${kind}/${encodeURIComponent(id)}`;
    }
    // Закрыть dropdown и очистить запрос после перехода
    setQuery("");
    setResults(null);
    setOpen(false);
  };

  const total = results
    ? results.tasks.length + results.lessons.length +
      results.references.length + results.documents.length
    : 0;
  const showDropdown = open && query.trim() !== "" && results !== null;

  /** Строка результата: заголовок + серый мета-хвост. */
  const item = (
    kind: "task" | "lesson" | "reference" | "document",
    id: string,
    title: string,
    meta: string,
  ) => (
    <button
      key={`${kind}:${id}`}
      type="button"
      className="flex w-full items-baseline gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
      onClick={() => go(kind, id)}
    >
      <span className="truncate font-medium">{title}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{meta}</span>
    </button>
  );

  /** Заголовок группы (как в списках сайдбара). */
  const group = (label: string, children: React.ReactNode) => (
    <div className="px-2 pt-2 first:pt-1">
      <div className="px-2 pb-1 text-xs font-medium text-muted-foreground">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );

  return (
    <div ref={containerRef} className="relative w-56 lg:w-64">
      <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        id="global-search"
        value={query}
        onChange={e => setQuery(e.target.value)}
        placeholder="Поиск (⌘J)…"
        aria-label="Глобальный поиск"
        className="h-8 pr-8 pl-8"
      />
      {showDropdown && (
        <div className="absolute top-full left-0 z-50 mt-1 max-h-96 w-80 overflow-y-auto rounded-md border bg-popover shadow-md">
          {total === 0 ? (
            <div className="px-3 py-2 text-sm text-muted-foreground">
              Ничего не найдено
            </div>
          ) : (
            <>
              {results!.tasks.length > 0 &&
                group(
                  "Задачи",
                  results!.tasks.map(t =>
                    item("task", t.id, t.title, t.id),
                  ),
                )}
              {results!.lessons.length > 0 &&
                group(
                  "Lessons",
                  results!.lessons.map(l =>
                    item("lesson", l.id, l.title, l.status),
                  ),
                )}
              {results!.references.length > 0 &&
                group(
                  "References",
                  results!.references.map(r =>
                    item("reference", r.id, r.title, r.type),
                  ),
                )}
              {results!.documents.length > 0 &&
                group(
                  "Документы",
                  results!.documents.map(d =>
                    item("document", d.id, d.title, d.type),
                  ),
                )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
