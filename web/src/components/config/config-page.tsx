/**
 * Страница «Конфиг проекта» (VL-165): редактирует backlog/config.yml.
 *
 * Отдельно от страницы настроек бота (.vibelog/settings.json, VL-156):
 * это разные файлы с разной валидацией. Патч уходит одним PUT /api/config,
 * сервер валидирует whitelist ключей и типы (зеркало CLI config set).
 *
 * Поля ввода соответствуют ключам defaultConfig (snake_case, как в
 * оригинале Backlog.md). Массивы редактируются как список через запятую,
 * definition_of_done — по строке на пункт. Числовые поля, оставленные
 * пустыми или не изменившиеся, в патч не попадают.
 *
 * Стиль — shadcn по образцу ref-2 (Card + Input + Switch, Tailwind-токены).
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
import { fetchConfig, putConfig, type ConfigData } from "./api";

/** Стиль нативного textarea в стиле shadcn Input (ui/textarea.tsx в ref-2 нет). */
const TEXTAREA_CLASS =
  "w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30";

/** Локальное состояние формы: массивы — строки через запятую, числа — как есть. */
interface FormState {
  project_name: string;
  task_prefix: string;
  default_status: string;
  statuses: string;
  priorities: string;
  types: string;
  labels: string;
  max_column_width: string;
  definition_of_done: string;
  date_format: string;
  default_editor: string;
  default_port: string;
  active_branch_days: string;
  auto_open_browser: boolean;
  remote_operations: boolean;
  auto_commit: boolean;
  bypass_git_hooks: boolean;
  check_active_branches: boolean;
}

/** Массив конфига → строка формы; undefined → пустая строка. */
function arrToText(arr: unknown): string {
  return Array.isArray(arr) ? arr.join(", ") : "";
}

/** Строка формы (список через запятую) → массив для патча. */
function textToArr(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** definition_of_done: по строке на пункт. */
function dodToText(arr: unknown): string {
  return Array.isArray(arr) ? arr.join("\n") : "";
}

function dodToArr(raw: string): string[] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Числовое поле → значение патча: пусто/мусор → undefined (не менять). */
function parseNum(raw: string): number | undefined {
  const n = Number(raw.trim());
  return raw.trim() !== "" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Конфиг → состояние формы. */
function toFormState(c: ConfigData): FormState {
  return {
    project_name: c.project_name ?? "",
    task_prefix: c.task_prefix ?? "",
    default_status: c.default_status ?? "",
    statuses: arrToText(c.statuses),
    priorities: arrToText(c.priorities),
    types: arrToText(c.types),
    labels: arrToText(c.labels),
    max_column_width: c.max_column_width != null ? String(c.max_column_width) : "",
    definition_of_done: dodToText(c.definition_of_done),
    date_format: c.date_format ?? "",
    default_editor: c.default_editor ?? "",
    default_port: c.default_port != null ? String(c.default_port) : "",
    active_branch_days: c.active_branch_days != null ? String(c.active_branch_days) : "",
    auto_open_browser: c.auto_open_browser === true,
    remote_operations: c.remote_operations === true,
    auto_commit: c.auto_commit === true,
    bypass_git_hooks: c.bypass_git_hooks === true,
    check_active_branches: c.check_active_branches === true,
  };
}

/**
 * Форма → патч: только изменённые относительно загруженного конфига поля.
 *
 * Ограничение: удалить ключ через веб нельзя (пустое строковое поле =
 * «не менять»); пустой labels — явный []. Числа и строки сверяются с
 * исходным конфигом, чтобы не слать серверу заведомо невалидные значения.
 */
function buildPatch(initial: ConfigData, form: FormState): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const setIfChanged = (key: string, formValue: unknown, current: unknown) => {
    if (formValue !== current) patch[key] = formValue;
  };

  setIfChanged("project_name", form.project_name.trim(), initial.project_name ?? "");
  setIfChanged("task_prefix", form.task_prefix.trim(), initial.task_prefix ?? "");
  setIfChanged("default_status", form.default_status.trim(), initial.default_status ?? "");
  setIfChanged("statuses", textToArr(form.statuses), initial.statuses ?? []);
  setIfChanged("priorities", textToArr(form.priorities), initial.priorities ?? []);
  setIfChanged("types", textToArr(form.types), initial.types ?? []);
  setIfChanged("labels", textToArr(form.labels), initial.labels ?? []);
  setIfChanged("definition_of_done", dodToArr(form.definition_of_done), initial.definition_of_done ?? []);
  setIfChanged("max_column_width", parseNum(form.max_column_width), initial.max_column_width);
  setIfChanged("default_port", parseNum(form.default_port), initial.default_port);
  setIfChanged("active_branch_days", parseNum(form.active_branch_days), initial.active_branch_days);
  setIfChanged("date_format", form.date_format.trim(), initial.date_format ?? "");
  setIfChanged("default_editor", form.default_editor.trim(), initial.default_editor ?? "");
  setIfChanged("auto_open_browser", form.auto_open_browser, initial.auto_open_browser === true);
  setIfChanged("remote_operations", form.remote_operations, initial.remote_operations === true);
  setIfChanged("auto_commit", form.auto_commit, initial.auto_commit === true);
  setIfChanged("bypass_git_hooks", form.bypass_git_hooks, initial.bypass_git_hooks === true);
  setIfChanged(
    "check_active_branches",
    form.check_active_branches,
    initial.check_active_branches === true,
  );
  return patch;
}

/** Клиентская проверка до отправки: обязательные строки непустые, списки не пусты. */
function validateForm(form: FormState): string | null {
  for (const [key, label] of [
    ["project_name", "Имя проекта"],
    ["task_prefix", "Префикс ID"],
    ["default_status", "Статус по умолчанию"],
  ] as const) {
    if (!form[key].trim()) return `${label}: не может быть пустым`;
  }
  for (const [key, label] of [
    ["statuses", "Статусы"],
    ["priorities", "Приоритеты"],
    ["types", "Типы"],
  ] as const) {
    if (textToArr(form[key]).length === 0) return `${label}: нужен хотя бы один пункт`;
  }
  return null;
}

/** Поле-строка с лейблом. */
function TextRow(props: {
  id: string;
  label: string;
  value: string;
  placeholder?: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={props.id}>{props.label}</Label>
      <Input
        id={props.id}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
      />
    </div>
  );
}

/** Переключатель с описанием. */
function SwitchRow(props: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <Label htmlFor={props.id}>{props.label}</Label>
        <p className="text-muted-foreground text-xs">{props.hint}</p>
      </div>
      <Switch id={props.id} checked={props.checked} onCheckedChange={props.onCheckedChange} />
    </div>
  );
}

export function ConfigPage() {
  const [initial, setInitial] = React.useState<ConfigData | null>(null);
  const [form, setForm] = React.useState<FormState | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [saved, setSaved] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Загрузка конфига; пустой initial state → Skeleton
  React.useEffect(() => {
    let cancelled = false;
    fetchConfig()
      .then((c) => {
        if (!cancelled) {
          setInitial(c);
          setForm(toFormState(c));
        }
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
    if (!form || !initial) return;
    const clientError = validateForm(form);
    if (clientError) {
      setError(clientError);
      return;
    }
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      // Патч только изменённых полей: остальной конфиг (и YAML-порядок
      // неизменённых ключей) не трогается
      const updated = await putConfig(buildPatch(initial, form));
      setInitial(updated);
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
          <p className="text-destructive text-sm">Ошибка загрузки конфига: {error}</p>
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
        <h1 className="text-lg font-semibold">Конфиг проекта</h1>
        <p className="text-muted-foreground text-sm">
          Тот же backlog/config.yml, что команда <code>vibelog config set</code>. Изменения
          применяются к доске и CLI без перезапуска.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Проект</CardTitle>
          <CardDescription>Идентификация проекта и префикс ID задач.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextRow
              id="project-name"
              label="Имя проекта"
              value={form.project_name}
              onChange={(v) => update("project_name", v)}
            />
            <TextRow
              id="task-prefix"
              label="Префикс ID"
              value={form.task_prefix}
              placeholder="VL"
              onChange={(v) => update("task_prefix", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Доска</CardTitle>
          <CardDescription>
            Статусы, приоритеты и типы — списки через запятую.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <TextRow
            id="default-status"
            label="Статус по умолчанию"
            value={form.default_status}
            onChange={(v) => update("default_status", v)}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextRow
              id="cfg-statuses"
              label="Статусы (колонки)"
              value={form.statuses}
              onChange={(v) => update("statuses", v)}
            />
            <TextRow
              id="cfg-priorities"
              label="Приоритеты"
              value={form.priorities}
              onChange={(v) => update("priorities", v)}
            />
            <TextRow
              id="cfg-types"
              label="Типы задач"
              value={form.types}
              onChange={(v) => update("types", v)}
            />
            <TextRow
              id="cfg-labels"
              label="Метки"
              value={form.labels}
              onChange={(v) => update("labels", v)}
            />
            <TextRow
              id="max-column-width"
              label="Макс. ширина колонки"
              value={form.max_column_width}
              placeholder="20"
              onChange={(v) => update("max_column_width", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workflow</CardTitle>
          <CardDescription>Definition of Done — по строке на пункт.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="dod">Definition of Done</Label>
            <textarea
              id="dod"
              rows={4}
              className={TEXTAREA_CLASS}
              value={form.definition_of_done}
              onChange={(e) => update("definition_of_done", e.target.value)}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextRow
              id="date-format"
              label="Формат дат"
              value={form.date_format}
              placeholder="yyyy-mm-dd hh:mm"
              onChange={(v) => update("date_format", v)}
            />
            <TextRow
              id="default-editor"
              label="Редактор по умолчанию"
              value={form.default_editor}
              placeholder="системный"
              onChange={(v) => update("default_editor", v)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Git и безопасность</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <SwitchRow
            id="auto-open-browser"
            label="Автозапуск браузера"
            hint="Открывать браузер при vibelog board/browser."
            checked={form.auto_open_browser}
            onCheckedChange={(v) => update("auto_open_browser", v)}
          />
          <Separator />
          <SwitchRow
            id="remote-operations"
            label="Удалённые операции"
            hint="Разрешить git push и другие необратимые операции."
            checked={form.remote_operations}
            onCheckedChange={(v) => update("remote_operations", v)}
          />
          <Separator />
          <SwitchRow
            id="auto-commit"
            label="Автокоммит"
            hint="Коммитить изменения после фаз агента."
            checked={form.auto_commit}
            onCheckedChange={(v) => update("auto_commit", v)}
          />
          <Separator />
          <SwitchRow
            id="bypass-git-hooks"
            label="Обход git-хуков"
            hint="Пропускать pre-commit хуки при коммитах агента."
            checked={form.bypass_git_hooks}
            onCheckedChange={(v) => update("bypass_git_hooks", v)}
          />
          <Separator />
          <SwitchRow
            id="check-active-branches"
            label="Проверка активных веток"
            hint="Предупреждать о ветках задач без активности дольше лимита."
            checked={form.check_active_branches}
            onCheckedChange={(v) => update("check_active_branches", v)}
          />
          <Separator />
          <div className="grid gap-4 sm:grid-cols-2">
            <TextRow
              id="default-port"
              label="Порт по умолчанию"
              value={form.default_port}
              placeholder="6420"
              onChange={(v) => update("default_port", v)}
            />
            <TextRow
              id="active-branch-days"
              label="Лимит активности ветки, дней"
              value={form.active_branch_days}
              placeholder="30"
              onChange={(v) => update("active_branch_days", v)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="flex items-center gap-3">
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        {saved && <span className="text-sm text-green-600">Сохранено</span>}
        {error && <span className="text-destructive text-sm">{error}</span>}
      </div>
    </div>
  );
}
