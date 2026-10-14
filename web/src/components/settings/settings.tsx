/**
 * Страница настроек веб-интерфейса (VL-156).
 *
 * Редактирует тот же .vibelog/settings.json, что команда /set в боте:
 * формы эквивалентны опциям /set (агент, лимиты фаз, режим веток, компакшн,
 * code в сессии plan). Env-секция с секретами НЕ отображается и не
 * редактируется — только несекретные поля, которые валидирует PUT /api/settings.
 *
 * Стиль — shadcn по образцу ref-2 (Card + Switch + Input, Tailwind-токены).
 */

import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { fetchSettings, putSettings, type SettingsData } from "./api";

/** Локальное состояние формы: текст числовых полей — как есть (пусто = сброс). */
interface FormState {
  default_agent: "qwen" | "vb";
  max_wall_time: string;
  max_requests: string;
  branch_mode: boolean;
  compact: boolean;
  code_same_session: boolean;
}

/** Настройки → состояние формы: undefined-числа → пустая строка, compact default-on. */
function toFormState(s: SettingsData): FormState {
  return {
    // undefined агента = дефолт 'qwen' (resolveDefaultAgent)
    default_agent: s.default_agent ?? "qwen",
    max_wall_time: s.max_wall_time != null ? String(s.max_wall_time) : "",
    max_requests: s.max_requests != null ? String(s.max_requests) : "",
    // undefined = off (resolveBranchMode / resolveCodeSameSession)
    branch_mode: s.branch_mode === true,
    // compact: undefined = ВКЛ (VL-122) — читаем только строгое false
    compact: s.compact !== false,
    code_same_session: s.code_same_session === true,
  };
}

/** Текст числового поля → значение патча: пусто/0 → null (сброс ключа). */
function parseLimit(raw: string): number | null {
  const n = Number(raw.trim());
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function SettingsPage() {
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Загрузка текущих настроек; пустой initial state → Skeleton
  React.useEffect(() => {
    let cancelled = false;
    fetchSettings()
      .then((s) => {
        if (!cancelled) setForm(toFormState(s));
      })
      .catch((err: Error) => {
        if (!cancelled) setError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    setSaved(false);
    setError(null);
  };

  const handleSave = async () => {
    if (!form) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Патч содержит ВСЕ поля формы: 0/пусто → null сбрасывает лимит,
      // compact всегда явный boolean (вкл по умолчанию ≠ отсутствие ключа)
      const updated = await putSettings({
        default_agent: form.default_agent,
        max_wall_time: parseLimit(form.max_wall_time),
        max_requests: parseLimit(form.max_requests),
        branch_mode: form.branch_mode,
        compact: form.compact,
        code_same_session: form.code_same_session,
      });
      setForm(toFormState(updated));
      setSaved(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (!form) {
    return (
      <div className="mx-auto max-w-2xl space-y-3 p-4">
        {error ? (
          <p className="text-destructive text-sm">Ошибка загрузки настроек: {error}</p>
        ) : (
          <>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div>
        <h1 className="text-lg font-semibold">Настройки</h1>
        <p className="text-muted-foreground text-sm">
          Тот же .vibelog/settings.json, что команда /set в боте. Секреты (токены)
          хранятся в env-секции файла и здесь не отображаются.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Агент и лимиты фаз</CardTitle>
          <CardDescription>
            Применяются при следующем запуске фазы — перезапуск бота не нужен.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Агент по умолчанию</Label>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant={form.default_agent === "qwen" ? "default" : "outline"}
                onClick={() => update("default_agent", "qwen")}
              >
                qwen
              </Button>
              <Button
                size="sm"
                variant={form.default_agent === "vb" ? "default" : "outline"}
                onClick={() => update("default_agent", "vb")}
              >
                vb
              </Button>
            </div>
            <p className="text-muted-foreground text-xs">
              Команды фаз без суффикса :agent запускают выбранного агента.
            </p>
          </div>

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="max-wall-time">max-wall-time, сек</Label>
              <Input
                id="max-wall-time"
                type="number"
                min={0}
                placeholder="дефолт агента"
                value={form.max_wall_time}
                onChange={(e) => update("max_wall_time", e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="max-requests">max-requests</Label>
              <Input
                id="max-requests"
                type="number"
                min={0}
                placeholder="дефолт агента"
                value={form.max_requests}
                onChange={(e) => update("max_requests", e.target.value)}
              />
            </div>
          </div>
          <p className="text-muted-foreground text-xs">
            Лимиты встроенного агента (vb). 0 или пусто — сброс на дефолт агента.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Режимы</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="branch-mode">Режим параллельной разработки</Label>
              <p className="text-muted-foreground text-xs">
                Фазы выполняются в git-ветках vb/vl-N (worktree).
              </p>
            </div>
            <Switch
              id="branch-mode"
              checked={form.branch_mode}
              onCheckedChange={(v) => update("branch_mode", v)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="compact">Компакшн истории</Label>
              <p className="text-muted-foreground text-xs">
                Усечение длинных сессий LLM. По умолчанию включён.
              </p>
            </div>
            <Switch
              id="compact"
              checked={form.compact}
              onCheckedChange={(v) => update("compact", v)}
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between gap-4">
            <div>
              <Label htmlFor="code-same-session">Code в сессии Plan</Label>
              <p className="text-muted-foreground text-xs">
                Фаза code продолжает plan-сессию агента (--resume).
              </p>
            </div>
            <Switch
              id="code-same-session"
              checked={form.code_same_session}
              onCheckedChange={(v) => update("code_same_session", v)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        {saved && <span className="text-sm text-green-600 dark:text-green-500">Сохранено</span>}
        {error && <span className="text-destructive text-sm">{error}</span>}
      </div>
    </div>
  );
}
