/**
 * Страница «Lessons» (VL-182): список lessons + фильтры.
 *
 * Роут #/lessons. Показывает для каждого lesson: id, title (ссылка на
 * детальную страницу), status, tags, updated_date, путь к файлу.
 * Фильтры — клиентские (паттерн documents-page): status (Select, точное
 * совпадение) и tags (через запятую — все перечисленные подстроки должны
 * входить в tags). Все fetch — в try/catch с выводом ошибки в state:
 * консоль браузера остаётся без ошибок (lesson-16).
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { fetchLessons, LESSON_STATUSES, type LessonListItem } from "./api";

/** Значение Select «Все статусы»: Radix не принимает пустой value у Item. */
const ALL_STATUSES = "__all__";

/** Строка тегов → массив: trim, пустые куски отбрасываются. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function LessonsPage() {
  const [entries, setEntries] = React.useState<LessonListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Фильтры (AC-1): status — точное совпадение; tags — подстроки через
  // запятую, все перечисленные должны входить в tags lesson
  const [statusFilter, setStatusFilter] = React.useState<string>(ALL_STATUSES);
  const [tagFilter, setTagFilter] = React.useState<string>("");

  /** Загрузка списка. */
  const load = React.useCallback(async () => {
    try {
      setEntries(await fetchLessons());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка списка при монтировании: setState уходят в async-продолжение
    // load (после await), паттерн VL-174 — подавление ложного срабатывания
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Клиентская фильтрация — данные грузятся одним списком (метаданные без
  // тел, запросов на фильтр не добавляем)
  const needle = parseTags(tagFilter).map((t) => t.toLowerCase());
  const filtered = (entries ?? []).filter(({ lesson }) => {
    if (statusFilter !== ALL_STATUSES && lesson.status !== statusFilter) return false;
    if (needle.length === 0) return true;
    const tags = lesson.tags.map((t) => t.toLowerCase());
    return needle.every((n) => tags.some((t) => t.includes(n)));
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div>
        <h1 className="text-xl font-semibold">Lessons</h1>
        <p className="text-sm text-muted-foreground">
          Уроки из опыта задач (backlog/lessons/)
        </p>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {/* Фильтры (AC-1): статус + теги */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Фильтр по статусу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_STATUSES}>Все статусы</SelectItem>
            {LESSON_STATUSES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          value={tagFilter}
          onChange={(e) => setTagFilter(e.target.value)}
          placeholder="Теги через запятую"
          className="w-[220px]"
          aria-label="Фильтр по тегам"
        />
      </div>

      {entries === null ? (
        !error && <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {entries.length === 0
            ? "Lessons пока нет. Создайте первый: vibelog lesson create"
            : "Нет lessons, подходящих под фильтр."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ lesson, path }) => (
            <Card key={lesson.id} className="py-3">
              <CardContent className="px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`#/lesson/${encodeURIComponent(lesson.id)}`}
                    className="font-medium hover:underline"
                  >
                    {lesson.title}
                  </a>
                  <span className="font-mono text-xs text-muted-foreground">
                    {lesson.id}
                  </span>
                  <Badge variant="secondary">{lesson.status}</Badge>
                  <span className="text-xs text-muted-foreground">
                    {lesson.updated_date}
                  </span>
                  <span className="truncate text-xs text-muted-foreground" title={path}>
                    {path}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {lesson.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
