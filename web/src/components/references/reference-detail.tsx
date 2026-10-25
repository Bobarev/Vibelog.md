/**
 * Детальная страница reference (VL-174): просмотр + редактирование.
 *
 * Роут #/reference/<id>. Просмотр: title, type, url, path, tags, body,
 * linked_tasks. Кнопка «Редактировать» → форма (title, tags через запятую,
 * url, body) → сохранение через PATCH /api/references/:id (только эти
 * поля — по AC; type/path/read-only). Все fetch — в try/catch с выводом
 * ошибки в state: консоль браузера без ошибок (lesson-16).
 */

import * as React from "react";

import { ArrowLeft, Pencil } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  fetchReference,
  patchReference,
  type ReferenceDetailData,
} from "./api";

/** Локальная форма редактирования (tags — строка «через запятую»). */
interface FormState {
  title: string;
  tags: string;
  url: string;
  content: string;
}

function toForm(data: ReferenceDetailData): FormState {
  return {
    title: data.reference.title,
    tags: data.reference.tags.join(", "),
    url: data.reference.url ?? "",
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

export function ReferenceDetail({ id }: { id: string }) {
  const [entry, setEntry] = React.useState<ReferenceDetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Загрузка при смене id (навигация из списка без перезагрузки).
  // Пустой id (момент между роутом 'reference' и парсингом хеша) — не ходим
  // в API: раньше давал transient-404 GET /api/references/ в сеть.
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Сброс состояния предыдущего entry перед загрузкой нового id —
    // паттерн VL-174 (загрузка по смене роута); синхронный сброс в effect
    // подавлен как ложное срабатывание: setState в fetch-колбэках асинхронны
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry(null);
    setError(null);
    setEditing(false);
    setSaved(false);
    fetchReference(id)
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
      const updated = await patchReference(id, {
        title: form.title.trim(),
        tags: parseTags(form.tags),
        url: form.url.trim(),
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
        <a href="#/references" className="inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft className="h-4 w-4" /> К списку references
        </a>
        <p className="text-sm text-destructive">Ошибка загрузки: {error}</p>
      </div>
    );
  }

  if (!entry) {
    return <div className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">Загрузка…</div>;
  }

  const ref = entry.reference;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <a href="#/references" className="inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> К списку references
      </a>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{ref.title}</h1>
          <Badge variant="secondary">{ref.type}</Badge>
        </div>
        {!editing && (
          <Button variant="outline" onClick={() => { setForm(toForm(entry)); setEditing(true); setSaved(false); setError(null); }}>
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
              <Label htmlFor="ref-title">Заголовок</Label>
              <Input id="ref-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-tags">Теги (через запятую)</Label>
              <Input id="ref-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-url">URL</Label>
              <Input id="ref-url" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ref-body">Тело</Label>
              <Textarea
                id="ref-body"
                rows={14}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Отмена
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Путь файла: {entry.path} (type и путь не редактируются)
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 px-4 py-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">URL</dt>
              <dd className="break-all">{ref.url ?? "—"}</dd>
              <dt className="text-muted-foreground">Путь</dt>
              <dd className="break-all">{ref.path ?? entry.path}</dd>
              <dt className="text-muted-foreground">Теги</dt>
              <dd className="flex flex-wrap gap-1.5">
                {ref.tags.length === 0 && "—"}
                {ref.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </dd>
              <dt className="text-muted-foreground">Задачи</dt>
              <dd className="flex flex-wrap gap-1.5">
                {ref.linked_tasks.length === 0 && "—"}
                {ref.linked_tasks.map((taskId) => (
                  <Badge key={taskId} variant="outline">
                    {taskId}
                  </Badge>
                ))}
              </dd>
            </dl>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Тело</p>
              <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">
                {entry.body || "(пусто)"}
              </pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
