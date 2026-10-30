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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  fetchSettings,
  putSettings,
  fetchModels,
  putModelDefault,
  type SettingsData,
  type ModelsData,
} from "./api";

/** Локальное состояние формы: текст числовых полей — как есть (пусто = сброс). */
interface FormState {
  default_agent: "qwen" | "vb";
  max_wall_time: string;
  max_requests: string;
  branch_mode: boolean;
  compact: boolean;
  code_same_session: boolean;
  /* VL-269: лимиты веб-чата — текст числовых полей (пусто/0 = сброс) */
  chat_max_iterations: string;
  chat_max_wall_time: string;
  chat_max_auto_continue: string;
  chat_call_timeout: string;
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
    // VL-269: числа секции chat → строки; отсутствие ключа = дефолт чата
    chat_max_iterations: s.chat?.max_iterations != null ? String(s.chat.max_iterations) : "",
    chat_max_wall_time: s.chat?.max_wall_time != null ? String(s.chat.max_wall_time) : "",
    chat_max_auto_continue: s.chat?.max_auto_continue != null ? String(s.chat.max_auto_continue) : "",
    chat_call_timeout: s.chat?.call_timeout != null ? String(s.chat.call_timeout) : "",
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
  // VL-209: реестр моделей/провайдеров для селекта активной модели
  const [models, setModels] = React.useState<ModelsData | null>(null);
  const [modelError, setModelError] = React.useState<string | null>(null);
  const [modelSaving, setModelSaving] = React.useState(false);

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
    // Секции models могут отсутствовать — тогда fetchModels вернёт пустые
    // списки, ошибка только при недоступности сервера
    fetchModels()
      .then((d) => {
        if (!cancelled) setModels(d);
      })
      .catch((err: Error) => {
        if (!cancelled) setModelError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Переключение models.default: PUT /api/models → обновление состояния. */
  const handleModelChange = async (id: string) => {
    setModelSaving(true);
    setModelError(null);
    try {
      await putModelDefault(id);
      setModels((prev) => (prev ? { ...prev, default: id } : prev));
    } catch (err) {
      setModelError((err as Error).message);
    } finally {
      setModelSaving(false);
    }
  };

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
        // VL-269: секция chat передаётся целиком (полная замена, как в API);
        // пустое/0 → null — сервер удаляет ключ, чат берёт дефолт
        chat: {
          max_iterations: parseLimit(form.chat_max_iterations),
          max_wall_time: parseLimit(form.chat_max_wall_time),
          max_auto_continue: parseLimit(form.chat_max_auto_continue),
          call_timeout: parseLimit(form.chat_call_timeout),
        },
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
          <CardTitle>Модель LLM</CardTitle>
          <CardDescription>
            Активная модель для фаз и чата (секции models/providers
            settings.json). Ключи хранятся в env — здесь не отображаются.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {models && models.available.length > 0 ? (
            <>
              <div className="space-y-2">
                <Label>Активная модель</Label>
                <Select
                  value={models.default ?? ""}
                  onValueChange={handleModelChange}
                  disabled={modelSaving}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Выберите модель" />
                  </SelectTrigger>
                  <SelectContent>
                    {models.available.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.label} ({m.provider}, {m.api_mode})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(() => {
                const active = models.available.find((m) => m.id === models.default);
                const provider = active && models.providers.find((p) => p.id === active.provider);
                if (!provider) return null;
                return (
                  <p className="text-muted-foreground text-xs">
                    Провайдер {provider.id}: {provider.base_url} — ключ{" "}
                    {provider.keySet ? "задан" : "НЕ ЗАДАН (env / .env / settings.json)"}
                  </p>
                );
              })()}
              {modelError && <p className="text-destructive text-sm">{modelError}</p>}
            </>
          ) : (
            <p className="text-muted-foreground text-sm">
              {modelError
                ? `Ошибка загрузки моделей: ${modelError}`
                : "Модели не настроены — используется env VIBELOG_LLM_MODEL (fallback)."}
            </p>
          )}
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

      {/* VL-269: лимиты хода веб-чата — читаются на каждый ход, рестарт не нужен */}
      <Card>
        <CardHeader>
          <CardTitle>Лимиты веб-чата</CardTitle>
          <CardDescription>
            Применяются к следующему ходу чата без перезапуска сервера. Пусто или 0 —
            сброс к дефолту: 8 итераций, 120 с на ход, 3 авто-продолжения, 90 с на вызов
            модели.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="chat-max-iterations">Итераций на ход</Label>
              <Input
                id="chat-max-iterations"
                type="number"
                min={0}
                placeholder="8"
                value={form.chat_max_iterations}
                onChange={(e) => update("chat_max_iterations", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Один ответ модели + его tool-вызовы = одна итерация. Дефолт 8, максимум 200.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-max-wall-time">Бюджет хода, с</Label>
              <Input
                id="chat-max-wall-time"
                type="number"
                min={0}
                placeholder="120"
                value={form.chat_max_wall_time}
                onChange={(e) => update("chat_max_wall_time", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Общее время одного хода. По исчерпании ход не обрывается ошибкой — клиент
                продолжит его сам.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-max-auto-continue">Авто-продолжений подряд</Label>
              <Input
                id="chat-max-auto-continue"
                type="number"
                min={0}
                placeholder="3"
                value={form.chat_max_auto_continue}
                onChange={(e) => update("chat_max_auto_continue", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Сколько раз чат продолжит ход сам. Дальше — кнопка «Продолжить».
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="chat-call-timeout">Таймаут вызова модели, с</Label>
              <Input
                id="chat-call-timeout"
                type="number"
                min={0}
                placeholder="90"
                value={form.chat_call_timeout}
                onChange={(e) => update("chat_call_timeout", e.target.value)}
              />
              <p className="text-muted-foreground text-xs">
                Ожидание без единого токена. Живой стрим таймаут не срабатывает.
              </p>
            </div>
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
