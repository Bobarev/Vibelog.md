/**
 * Детальная страница персоны (VL-403): правка роли, промпта и памяти.
 *
 * Роут #/persona/<id>. Три секции:
 * 1. «Основное» — label, description, default_status (Select из статусов
 *    backlog/config.yml), allow_tools (мультиселект из известных инструментов).
 * 2. «Промпт роли» — Textarea с текстом, счётчик символов, «Сохранить».
 *    Правка попадает в `.vibelog/prompts/personas/<prompt>.md` — файл
 *    коммитится в git (VL-329).
 * 3. «Память» — Textarea с текстом памяти, счётчик `N / лимит`, предупреждение
 *    при превышении. Сохранение сверх лимита сервер отклоняет (400) — обрезки
 *    нет (AC7). Файл `*.memory.md` в git НЕ попадает (VL-401) — подпись под
 *    секцией это объясняет.
 *
 * Встроенную роль удалить нельзя (кнопки нет), но переопределить можно:
 * сервер сохраняет запись в chat_personas, и страница это сообщает.
 *
 * Все fetch — в try/catch с выводом ошибки в state: консоль браузера без
 * ошибок (lesson-16).
 */

import * as React from "react";

import { ArrowLeft, Trash2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import {
  deletePersona,
  fetchPersona,
  updatePersona,
  type DeletePersonaResult,
  type PersonaDetailData,
} from "./api";

/** Значение Select «не задан»: Radix не принимает пустой value у Item. */
const NO_STATUS = "__none__";

export function PersonaDetail({ id }: { id: string }) {
  const [data, setData] = React.useState<PersonaDetailData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Поля формы (по секциям — сохраняются независимо)
  const [label, setLabel] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [defaultStatus, setDefaultStatus] = React.useState(NO_STATUS);
  const [allowTools, setAllowTools] = React.useState<string[]>([]);
  const [promptText, setPromptText] = React.useState("");
  const [memoryText, setMemoryText] = React.useState("");

  const [deleteOpen, setDeleteOpen] = React.useState(false);
  const [deleted, setDeleted] = React.useState<DeletePersonaResult | null>(null);

  /** Раскладывает ответ сервера по полям формы. */
  const applyData = React.useCallback((next: PersonaDetailData) => {
    setData(next);
    setLabel(next.persona.label);
    setDescription(next.persona.description);
    setDefaultStatus(next.persona.defaultStatus === "" ? NO_STATUS : next.persona.defaultStatus);
    setAllowTools(next.persona.allowTools);
    setPromptText(next.promptText);
    setMemoryText(next.memoryText);
  }, []);

  // Загрузка при смене id. Пустой id (момент между роутом 'persona' и
  // парсингом хеша) — не ходим в API: иначе transient-404 (lesson-22).
  React.useEffect(() => {
    if (!id) return;
    let cancelled = false;
    // Сброс предыдущей роли перед загрузкой новой — паттерн VL-174;
    // синхронный сброс подавлен как ложное срабатывание
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setError(null);
    setNotice(null);
    setDeleted(null);
    fetchPersona(id)
      .then((next) => {
        if (!cancelled) applyData(next);
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, [id, applyData]);

  /** Общее сохранение: собирает патч из переданных полей. */
  async function save(patch: Parameters<typeof updatePersona>[1], message: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await updatePersona(id, patch);
      applyData(next);
      setNotice(message);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      const result = await deletePersona(id);
      setDeleted(result);
      setDeleteOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (error !== null && data === null) {
    return (
      <div className="mx-auto max-w-3xl space-y-3 p-4">
        <a href="#/personas" className="inline-flex items-center gap-1 text-sm hover:underline">
          <ArrowLeft className="h-4 w-4" /> К списку персон
        </a>
        <p className="text-sm text-destructive">Ошибка загрузки: {error}</p>
      </div>
    );
  }

  if (data === null) {
    return (
      <div className="mx-auto grid max-w-3xl gap-3 p-4">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const persona = data.persona;
  const memoryChars = memoryText.trim().length;
  const overLimit = memoryChars > data.memory.limit;

  /** Переключение инструмента в мультиселекте allow_tools. */
  function toggleTool(name: string) {
    setAllowTools((prev) =>
      prev.includes(name) ? prev.filter((t) => t !== name) : [...prev, name],
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <a href="#/personas" className="inline-flex items-center gap-1 text-sm hover:underline">
        <ArrowLeft className="h-4 w-4" /> К списку персон
      </a>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-xl font-semibold">{persona.label}</h1>
          <span className="font-mono text-xs text-muted-foreground">{persona.id}</span>
          <Badge variant={persona.builtin ? "secondary" : "default"}>
            {persona.builtin ? "встроенная" : "проектная"}
          </Badge>
        </div>
        {!persona.builtin && (
          <Button variant="destructive" onClick={() => setDeleteOpen(true)} disabled={busy}>
            <Trash2 /> Удалить
          </Button>
        )}
      </div>

      {persona.builtin && (
        <p className="text-sm text-muted-foreground">
          Встроенная роль — изменения сохраняются как переопределение в{" "}
          <code>chat_personas</code>. Удалить её нельзя.
        </p>
      )}

      {error !== null && <p className="text-sm text-destructive">{error}</p>}
      {notice !== null && <p className="text-sm text-muted-foreground">{notice}</p>}

      {deleted !== null && (
        <div className="rounded-md border bg-muted/40 p-3 text-sm">
          <p className="font-medium">Роль «{deleted.deleted}» удалена из chat_personas.</p>
          <p className="mt-1 text-muted-foreground">{deleted.note}</p>
          <ul className="mt-1 list-disc pl-5 font-mono text-xs text-muted-foreground">
            <li>{deleted.promptPath}</li>
            <li>{deleted.memoryPath}</li>
          </ul>
          <a href="#/personas" className="mt-2 inline-block text-sm hover:underline">
            Вернуться к списку
          </a>
        </div>
      )}

      {/* Секция «Основное» */}
      <Card>
        <CardHeader>
          <CardTitle>Основное</CardTitle>
          <CardDescription>
            Название и описание видны в пикере роли; статус — статус создаваемой из чата задачи.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="persona-label">Название</Label>
            <Input
              id="persona-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="persona-description">Описание</Label>
            <Input
              id="persona-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="persona-status">Статус создаваемой задачи</Label>
            <Select value={defaultStatus} onValueChange={setDefaultStatus}>
              <SelectTrigger id="persona-status" className="w-[240px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_STATUS}>не задан (Spec)</SelectItem>
                {data.statuses.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5">
            <Label>Разрешённые инструменты</Label>
            <p className="text-xs text-muted-foreground">
              Пусто — роль получает все инструменты чата. Отметьте хотя бы один, чтобы
              ограничить набор: невыбранные инструменты модель не увидит, а вызов вне
              списка получит отказ. <code>memory_remember</code> доступен всегда — это
              память самой роли, а не инструмент проекта.
            </p>
            <div className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto rounded-md border p-2">
              {data.tools.map((tool) => {
                const active = allowTools.includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    onClick={() => toggleTool(tool)}
                    aria-pressed={active}
                    className={`rounded-md border px-2 py-1 font-mono text-xs transition-colors ${
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <Button
              disabled={busy || label.trim() === ""}
              onClick={() =>
                void save(
                  {
                    label: label.trim(),
                    description: description.trim(),
                    defaultStatus: defaultStatus === NO_STATUS ? "" : defaultStatus,
                    allowTools,
                  },
                  "Основное сохранено",
                )
              }
            >
              {busy ? "Сохранение…" : "Сохранить основное"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Секция «Промпт роли» */}
      <Card>
        <CardHeader>
          <CardTitle>Промпт роли</CardTitle>
          <CardDescription>
            Файл <code>{data.promptPath}</code> — коммитится в git. Общие правила чата
            добавляются сервером, дублировать их не нужно.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {data.promptError !== null && (
            <p className="text-sm text-destructive">{data.promptError}</p>
          )}
          <Textarea
            rows={16}
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            aria-label="Текст промпта роли"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || promptText.trim() === ""}
              onClick={() => void save({ promptText }, "Промпт сохранён")}
            >
              {busy ? "Сохранение…" : "Сохранить промпт"}
            </Button>
            <span className="text-xs text-muted-foreground">{promptText.length} символов</span>
          </div>
        </CardContent>
      </Card>

      {/* Секция «Память» */}
      <Card>
        <CardHeader>
          <CardTitle>Память</CardTitle>
          <CardDescription>
            Файл <code>{data.memoryPath}</code> — в git НЕ попадает (личные заметки). Память
            подставляется в каждый ход чата, поэтому у неё есть лимит.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Textarea
            rows={12}
            value={memoryText}
            onChange={(e) => setMemoryText(e.target.value)}
            aria-label="Текст памяти персоны"
            placeholder="- Не использовать англицизмы без перевода. (2026-11-10)"
          />
          <div className="flex flex-wrap items-center gap-3">
            <Button
              disabled={busy || overLimit}
              onClick={() => void save({ memoryText }, "Память сохранена")}
            >
              {busy ? "Сохранение…" : "Сохранить память"}
            </Button>
            <span
              className={`text-xs ${overLimit ? "text-destructive" : "text-muted-foreground"}`}
            >
              {memoryChars} / {data.memory.limit} символов
            </span>
            {overLimit && (
              <span className="text-xs text-destructive">
                Превышен лимит — сократите текст (обрезки не будет)
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Лимит задаётся ключом <code>persona_memory.max_chars</code> в{" "}
            <code>.vibelog/settings.json</code>.
          </p>
        </CardContent>
      </Card>

      {/* Подтверждение удаления: файлы не удаляются — показываем пути */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить персону «{persona.label}»?</DialogTitle>
            <DialogDescription>
              Запись будет удалена из <code>chat_personas</code>. Файлы промпта и памяти
              останутся на диске — удалите их отдельно, если они больше не нужны:
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 font-mono text-xs text-muted-foreground">
            <li>{data.promptPath}</li>
            <li>{data.memoryPath}</li>
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
              {busy ? "Удаление…" : "Удалить роль"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
