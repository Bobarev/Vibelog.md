/**
 * Детальная страница документа (VL-181): просмотр + редактирование.
 *
 * Роут #/document/<id>. Просмотр: title, type, tags, created_date, путь к
 * файлу, body (markdown через MarkdownView). Кнопка «Редактировать» →
 * форма (title, type — Select из 4 типов, tags через запятую, body) →
 * сохранение через PATCH /api/documents/:id (created_date read-only —
 * не входит в UpdateDocumentInput). Все fetch — в try/catch с выводом
 * ошибки в state: консоль браузера без ошибок (lesson-16).
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
import {
  DOCUMENT_TYPES,
  fetchDocument,
  patchDocument,
  type DocumentDetailData,
} from "./api";

/** Локальная форма редактирования (tags — строка «через запятую»). */
interface FormState {
  title: string;
  type: string;
  tags: string;
  content: string;
}

function toForm(data: DocumentDetailData): FormState {
  return {
    title: data.document.title,
    type: data.document.type,
    tags: data.document.tags.join(", "),
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

export function DocumentDetail({ id }: { id: string }) {
  const [entry, setEntry] = React.useState<DocumentDetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState(false);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);

  // Загрузка при смене id (навигация из списка без перезагрузки).
  // Пустой id (момент между роутом 'document' и парсингом хеша) — не ходим
  // в API: иначе transient-404 GET /api/documents/ в сеть (lesson-22).
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Сброс формы при смене id — до fetch ниже (паттерн VL-174)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setEntry(null);
    setError(null);
    setEditing(false);
    setSaved(false);
    fetchDocument(id)
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
      const updated = await patchDocument(id, {
        title: form.title.trim(),
        type: form.type,
        tags: parseTags(form.tags),
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
        <a href="#/documents" className="inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft className="h-4 w-4" /> К списку документов
        </a>
        <p className="text-sm text-destructive">Ошибка загрузки: {error}</p>
      </div>
    );
  }

  if (!entry) {
    return <div className="mx-auto max-w-3xl p-4 text-sm text-muted-foreground">Загрузка…</div>;
  }

  const doc = entry.document;

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <a href="#/documents" className="inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> К списку документов
      </a>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{doc.title}</h1>
          <Badge variant="secondary">{doc.type}</Badge>
          <span className="text-xs text-muted-foreground">{doc.created_date}</span>
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
              <Label htmlFor="doc-title">Заголовок</Label>
              <Input id="doc-title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-type">Тип</Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value })}>
                <SelectTrigger id="doc-type" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-tags">Теги (через запятую)</Label>
              <Input id="doc-tags" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-body">Тело (markdown)</Label>
              <Textarea
                id="doc-body"
                rows={14}
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleSave} disabled={saving || !form.title.trim()}>
                {saving ? "Сохранение…" : "Сохранить"}
              </Button>
              <Button variant="outline" onClick={() => setEditing(false)} disabled={saving}>
                Отмена
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Путь файла: {entry.path} (created_date не редактируется)
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="space-y-4 px-4 py-4">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted-foreground">Тип</dt>
              <dd>{doc.type}</dd>
              <dt className="text-muted-foreground">Создан</dt>
              <dd>{doc.created_date || "—"}</dd>
              <dt className="text-muted-foreground">Теги</dt>
              <dd className="flex flex-wrap gap-1.5">
                {doc.tags.length === 0 && "—"}
                {doc.tags.map((tag) => (
                  <Badge key={tag} variant="outline">
                    {tag}
                  </Badge>
                ))}
              </dd>
              <dt className="text-muted-foreground">Путь</dt>
              <dd className="break-all">{entry.path}</dd>
            </dl>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Тело</p>
              {entry.body.trim() ? (
                <MarkdownView>{entry.body}</MarkdownView>
              ) : (
                <p className="text-sm text-muted-foreground">(пусто)</p>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
