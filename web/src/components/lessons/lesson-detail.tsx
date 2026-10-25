/**
 * Детальная страница lesson (VL-182): просмотр + редактирование.
 *
 * Роут #/lesson/<id>. Просмотр: title, status, tags, body (markdown через
 * MarkdownView), source_tasks и linked_tasks ССЫЛКАМИ на задачи (клик →
 * requestOpenTask → модалка просмотра на доске), created/updated/supersedes,
 * путь файла. Кнопка «Редактировать» → форма (title, tags через запятую,
 * status Select, body) → сохранение через PATCH /api/lessons/:id (только эти
 * поля — по AC; source_tasks/linked_tasks read-only). Все fetch — в try/catch
 * с выводом ошибки в state: консоль браузера без ошибок (lesson-16).
 */

import * as React from "react";

import { ArrowLeft, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { MarkdownView } from "@/lib/markdown";
import { requestOpenTask } from "@/lib/open-task";
import { fetchLesson, patchLesson, LESSON_STATUSES, type LessonDetailData } from "./api";

/** Локальная форма редактирования (tags — строка «через запятую»). */
interface FormState {
  title: string;
  tags: string;
  status: string;
  content: string;
}

function toForm(data: LessonDetailData): FormState {
  return {
    title: data.lesson.title,
    tags: data.lesson.tags.join(", "),
    status: data.lesson.status,
    content: data.body,
  };
}

/** Строка тегов → массив: trim, пустые куски отбрасываются. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function LessonDetail({ id }: { id: string }) {
  const [entry, setEntry] = React.useState<LessonDetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Загрузка при смене id (навигация из списка без перезагрузки).
  // Пустой id (момент между роутом 'lesson' и парсингом хеша) — не ходим
  // в API: иначе transient-404 GET /api/lessons/ в сеть (lesson-22).
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Сброс состояния предыдущего entry перед загрузкой нового id —
    // паттерн VL-174; синхронный сброс подавлен как ложное срабатывание
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry(null);
    setError(null);
    setEditing(false);
    setSaved(false);
    fetchLesson(id)
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const updated = await patchLesson(id, {
        title: form.title.trim(),
        tags: parseTags(form.tags),
        status: form.status,
        content: form.content,
      });
      setEntry(updated);
      setEditing(false);
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (error && !entry) {
    // Ошибка загрузки (в т.ч. 404): ссылка назад к списку
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <a href="#/lessons" className="inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft className="h-4 w-4" /> К списку lessons
        </a>
        <p className="text-sm text-destructive">Ошибка загрузки: {error}</p>
      </div>
    );
  }

  if (!entry) {
    return <div className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">Загрузка…</div>;
  }

  const lesson = entry.lesson;

  /** Ссылка на задачу: переход на доску + открытие модалки просмотра. */
  const taskLink = (taskId: string) => (
    <a
      href="#/"
      onClick={(e) => {
        e.preventDefault();
        requestOpenTask(taskId);
      }}
      className="font-mono text-sm hover:underline"
    >
      {taskId}
    </a>
  );

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <a href="#/lessons" className="inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> К списку lessons
      </a>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{lesson.title}</h1>
          <Badge variant="secondary">{lesson.status}</Badge>
          <span className="font-mono text-xs text-muted-foreground">{lesson.id}</span>
        </div>
        {!editing && (
          <Button
            variant="outline"
            onClick={() => {
              setForm(toForm(entry));
              setEditing(true);
              setSaved(false);
              setError(null);
            }}
          >
            <Pencil /> Редактировать
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {saved && <p className="text-sm text-muted-foreground">Сохранено</p>}

      {editing && form ? (
        <Card>
          <CardContent className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="lesson-title">Заголовок</Label>
              <Input
                id="lesson-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lesson-tags">Теги (через запятую)</Label>
              <Input
                id="lesson-tags"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="web, ui"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lesson-status">Статус</Label>
              <Select
                value={form.status}
                onValueChange={(value) => setForm({ ...form, status: value })}
              >
                <SelectTrigger id="lesson-status" className="w-[200px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LESSON_STATUSES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="lesson-body">Тело (markdown)</Label>
              <Textarea
                id="lesson-body"
                rows={14}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button
                variant="outline"
                onClick={() => setEditing(false)}
                disabled={saving}
              >
                Отмена
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Путь файла: {entry.path} (source_tasks/linked_tasks не редактируются)
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 px-4 py-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Статус</dt>
              <dd>
                <Badge variant="secondary">{lesson.status}</Badge>
              </dd>
              <dt className="text-muted-foreground">Теги</dt>
              <dd className="flex flex-wrap gap-1.5">
                {lesson.tags.length === 0 && "—"}
                {lesson.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </dd>
              <dt className="text-muted-foreground">Источники (source_tasks)</dt>
              <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {lesson.source_tasks.length === 0 && "—"}
                {lesson.source_tasks.map((taskId) => (
                  <span key={taskId}>{taskLink(taskId)}</span>
                ))}
              </dd>
              <dt className="text-muted-foreground">Связанные (linked_tasks)</dt>
              <dd className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {lesson.linked_tasks.length === 0 && "—"}
                {lesson.linked_tasks.map((taskId) => (
                  <span key={taskId}>{taskLink(taskId)}</span>
                ))}
              </dd>
              <dt className="text-muted-foreground">Создан</dt>
              <dd>{lesson.created_date}</dd>
              <dt className="text-muted-foreground">Обновлён</dt>
              <dd>{lesson.updated_date}</dd>
              {lesson.supersedes && (
                <>
                  <dt className="text-muted-foreground">Заменяет</dt>
                  <dd>
                    <a
                      href={`#/lesson/${encodeURIComponent(lesson.supersedes)}`}
                      className="font-mono text-sm hover:underline"
                    >
                      {lesson.supersedes}
                    </a>
                  </dd>
                </>
              )}
              <dt className="text-muted-foreground">Путь</dt>
              <dd className="break-all">{entry.path}</dd>
            </dl>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Тело</p>
              <MarkdownView>{entry.body}</MarkdownView>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
