/**
 * Страница «Персоны» (VL-403): список ролей веб-чата.
 *
 * Роут #/personas. Показывает все роли реестра (встроенные + проектные):
 * label, id, признак встроенной/проектной, description, размер памяти с
 * лимитом и предупреждением при превышении. Клик по строке → #/persona/<id>.
 *
 * Кнопка «Создать персону» открывает Dialog: id, label, description, промпт,
 * default_status. Создание пишет запись в settings.json.chat_personas и файл
 * промпта в .vibelog/prompts/personas/<id>.md (сервер, POST /api/personas).
 *
 * Все fetch — в try/catch с выводом ошибки в state: консоль браузера без
 * ошибок (lesson-16).
 */

import * as React from "react";

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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { createPersona, fetchPersonas, type PersonasData } from "./api";

/** Значение Select «не задан»: Radix не принимает пустой value у Item. */
const NO_STATUS = "__none__";

/** Форма создания роли. */
interface CreateForm {
  id: string;
  label: string;
  description: string;
  promptText: string;
  defaultStatus: string;
}

const EMPTY_FORM: CreateForm = {
  id: "",
  label: "",
  description: "",
  promptText: "",
  defaultStatus: NO_STATUS,
};

export function PersonasPage() {
  const [data, setData] = React.useState<PersonasData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);
  // Статусы проекта нужны форме создания: берём из детальной страницы любой
  // роли не хочется — отдельный лёгкий запрос к конфигу (GET /api/config).
  const [statuses, setStatuses] = React.useState<string[]>([]);

  const load = React.useCallback(async () => {
    try {
      setData(await fetchPersonas());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка при монтировании: setState уходят в async-продолжение load
    // (после await), паттерн VL-174 — подавление ложного срабатывания
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  React.useEffect(() => {
    let cancelled = false;
    fetch("/api/config")
      .then((res) => (res.ok ? res.json() : null))
      .then((cfg: { statuses?: unknown } | null) => {
        if (cancelled || !cfg) return;
        const list = Array.isArray(cfg.statuses)
          ? cfg.statuses.filter((s): s is string => typeof s === "string")
          : [];
        setStatuses(list);
      })
      .catch(() => {
        // Конфиг недоступен — форма создания работает без выбора статуса
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const created = await createPersona({
        id: form.id.trim(),
        label: form.label.trim(),
        ...(form.description.trim() !== "" ? { description: form.description.trim() } : {}),
        promptText: form.promptText,
        ...(form.defaultStatus !== NO_STATUS ? { defaultStatus: form.defaultStatus } : {}),
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      // Переход на детальную страницу созданной роли: пользователь сразу
      // видит результат и может дописать память
      window.location.hash = `#/persona/${encodeURIComponent(created.persona.id)}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return (
      <div className="grid gap-3 p-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-2">
      <Card>
        <CardHeader>
          <CardTitle>Персоны</CardTitle>
          <CardDescription>
            Роли веб-чата: промпт роли и память о вас. Встроенные роли можно переопределить,
            проектные — создать и удалить. Промпты лежат в{" "}
            <code>.vibelog/prompts/personas/</code>.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error !== null && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {data.errors.length > 0 && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium">Проблемы секции chat_personas:</p>
              <ul className="mt-1 list-disc pl-5">
                {data.errors.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setForm(EMPTY_FORM);
                setCreateOpen(true);
              }}
            >
              Создать персону
            </Button>
            <span className="text-sm text-muted-foreground">
              Роль по умолчанию: <code>{data.default}</code>
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Роль</TableHead>
                <TableHead>Тип</TableHead>
                <TableHead>Описание</TableHead>
                <TableHead>Память</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.personas.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer"
                  onClick={() => {
                    window.location.hash = `#/persona/${encodeURIComponent(p.id)}`;
                  }}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <a
                        href={`#/persona/${encodeURIComponent(p.id)}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {p.label}
                      </a>
                      <span className="font-mono text-xs text-muted-foreground">{p.id}</span>
                      {p.id === data.default && (
                        <span className="text-xs text-muted-foreground">по умолчанию</span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    {p.builtin ? (
                      <Badge variant="secondary">встроенная</Badge>
                    ) : (
                      <Badge variant="default">проектная</Badge>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[320px] text-sm text-muted-foreground">
                    {p.description ?? "—"}
                  </TableCell>
                  <TableCell>
                    {p.memory.exists ? (
                      <span className="text-sm">
                        {p.memory.chars} симв.
                        {p.memory.truncated && (
                          <Badge variant="destructive" className="ml-2">
                            сверх лимита
                          </Badge>
                        )}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">пусто</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Создать персону</DialogTitle>
            <DialogDescription>
              Проектная роль: запись в <code>chat_personas</code> и файл промпта в{" "}
              <code>.vibelog/prompts/personas/&lt;id&gt;.md</code>.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="persona-id">id</Label>
              <Input
                id="persona-id"
                value={form.id}
                onChange={(e) => setForm({ ...form, id: e.target.value })}
                placeholder="psychologist"
              />
              <span className="text-xs text-muted-foreground">
                Строчная латиница, цифры и дефис. Используется как имя файла промпта.
              </span>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="persona-label">Название</Label>
              <Input
                id="persona-label"
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Психолог"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="persona-description">Описание</Label>
              <Input
                id="persona-description"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                placeholder="Короткая строка для пикера роли"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="persona-status">Статус создаваемой задачи</Label>
              <Select
                value={form.defaultStatus}
                onValueChange={(value) => setForm({ ...form, defaultStatus: value })}
              >
                <SelectTrigger id="persona-status" className="w-[240px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_STATUS}>не задан (Spec)</SelectItem>
                  {statuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="persona-prompt">Промпт роли</Label>
              <Textarea
                id="persona-prompt"
                rows={12}
                value={form.promptText}
                onChange={(e) => setForm({ ...form, promptText: e.target.value })}
                placeholder="Ты — психолог. Помогаешь разобраться в личных делах…"
              />
              <span className="text-xs text-muted-foreground">
                {form.promptText.length} символов. Общие правила чата добавляются сервером.
              </span>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} disabled={busy}>
              Отмена
            </Button>
            <Button
              onClick={() => void handleCreate()}
              disabled={
                busy ||
                form.id.trim() === "" ||
                form.label.trim() === "" ||
                form.promptText.trim() === ""
              }
            >
              {busy ? "Создание…" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
