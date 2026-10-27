/**
 * Страница «Documents» (VL-181): список документов + фильтры + создание.
 *
 * Роут #/documents. Показывает для каждого документа: title (ссылка на
 * детальную страницу), type, created_date, tags. Фильтры — клиентские
 * (список без тел, маленький): по type (Select) и тегам (подстрока через
 * запятую — все перечисленные теги должны входить в tags документа).
 * Кнопка «+ Документ» открывает inline-форму → POST /api/documents →
 * переход к созданному (#/document/<id>). Все fetch — в try/catch с
 * выводом ошибки в state: консоль браузера остаётся без ошибок (lesson-16).
 */

import * as React from "react";

import { Plus } from "lucide-react";

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
import {
  DOCUMENT_TYPES,
  createDocument,
  fetchDocuments,
  type DocumentListItem,
} from "./api";

/** Значение Select «Все типы»: Radix не принимает пустой value у Item. */
const ALL_TYPES = "__all__";

/** Строка тегов → массив: trim, пустые куски отбрасываются. */
function parseTags(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function DocumentsPage() {
  const [entries, setEntries] = React.useState<DocumentListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Фильтры (AC-1): type — точное совпадение; tags — подстрока через запятую
  const [typeFilter, setTypeFilter] = React.useState<string>(ALL_TYPES);
  const [tagFilter, setTagFilter] = React.useState<string>("");
  // Создание (AC-3): inline-форма
  const [creating, setCreating] = React.useState(false);
  const [form, setForm] = React.useState({ title: "", type: ALL_TYPES, tags: "" });
  const [submitting, setSubmitting] = React.useState(false);

  /** Загрузка списка (повторно — после создания). */
  const load = React.useCallback(async () => {
    try {
      setEntries(await fetchDocuments());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка списка при монтировании: setState уходят в async-продолжение
    // load (после await), паттерн VL-174
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleCreate = async () => {
    const title = form.title.trim();
    if (!title) return;
    setSubmitting(true);
    setError(null);
    try {
      const doc = await createDocument({
        title,
        type: form.type === ALL_TYPES ? undefined : form.type,
        tags: parseTags(form.tags),
      });
      setCreating(false);
      setForm({ title: "", type: ALL_TYPES, tags: "" });
      // Переход к созданному документу (просмотр)
      window.location.hash = `#/document/${encodeURIComponent(doc.id)}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  /** Клиентская фильтрация (список без тел — маленький). */
  const filtered = (entries ?? []).filter(({ document: doc }) => {
    if (typeFilter !== ALL_TYPES && doc.type !== typeFilter) return false;
    const needle = tagFilter
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
    if (needle.length > 0) {
      const tags = doc.tags.map((t) => t.toLowerCase());
      if (!needle.every((n) => tags.some((t) => t.includes(n)))) return false;
    }
    return true;
  });

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Documents</h1>
          <p className="text-sm text-muted-foreground">
            Документы проекта (backlog/docs/)
          </p>
        </div>
        <Button onClick={() => { setCreating(true); setError(null); }} disabled={creating}>
          <Plus /> Документ
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {creating && (
        <Card>
          <CardContent className="space-y-4 px-4 py-4">
            <div className="space-y-1.5">
              <Label htmlFor="doc-new-title">Заголовок</Label>
              <Input
                id="doc-new-title"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="Название документа"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-new-type">Тип</Label>
              <Select
                value={form.type}
                onValueChange={(value) => setForm({ ...form, type: value })}
              >
                <SelectTrigger id="doc-new-type" className="w-[220px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_TYPES}>Все типы</SelectItem>
                  {DOCUMENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="doc-new-tags">Теги (через запятую)</Label>
              <Input
                id="doc-new-tags"
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                placeholder="guide, api"
              />
            </div>
            <div className="flex gap-2">
              <Button onClick={handleCreate} disabled={submitting || !form.title.trim()}>
                {submitting ? "Создание…" : "Создать"}
              </Button>
              <Button
                variant="outline"
                onClick={() => { setCreating(false); setError(null); }}
                disabled={submitting}
              >
                Отмена
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Фильтры (AC-1): тип + теги; клиентская фильтрация */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="w-[180px]" aria-label="Фильтр по типу">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_TYPES}>Все типы</SelectItem>
            {DOCUMENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
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
            ? "Документов пока нет. Создайте первый кнопкой «+ Документ» или CLI: vibelog doc create"
            : "Нет документов, подходящих под фильтр."}
        </p>
      ) : (
        <div className="space-y-2">
          {filtered.map(({ document: doc, path }) => (
            <Card key={doc.id} className="py-3">
              <CardContent className="px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`#/document/${encodeURIComponent(doc.id)}`}
                    className="font-medium hover:underline"
                  >
                    {doc.title}
                  </a>
                  <Badge variant="secondary">{doc.type}</Badge>
                  <span className="text-xs text-muted-foreground">{doc.created_date}</span>
                  <span className="truncate text-xs text-muted-foreground" title={path}>
                    {path}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {doc.tags.map((tag) => (
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
