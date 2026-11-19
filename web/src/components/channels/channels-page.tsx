/**
 * Страница «Каналы» (VL-438): список interbot-каналов + глобальные параметры.
 *
 * Роут #/channels. Показывает каналы (id, label, group_id, addressing,
 * approval, admin_chat, признак default) и бейдж секретов «настроен/нет»
 * (только булевы флаги — значений bot_token/proxy UI не видит и не правит).
 *
 * Секция «Глобальные параметры» — sync_timeout_sec, default_channel,
 * лимиты/таймаут гейта (секция interbot_limits comms.yaml): правка через
 * PUT /api/comms/settings, горячее применение ботом без перезапуска.
 *
 * Кнопка «Создать канал» — Dialog (id, label, group_id, addressing).
 * Клик по строке → #/channel/<id>.
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
import {
  createChannel,
  fetchChannels,
  updateSettings,
  type ChannelsData,
} from "./api";

/** Значение Select «не задан»: Radix не принимает пустой value у Item. */
const NO_VALUE = "__none__";

/** Форма создания канала. */
interface CreateForm {
  id: string;
  label: string;
  groupId: string;
  addressing: "mention" | "all";
}

const EMPTY_FORM: CreateForm = { id: "", label: "", groupId: "", addressing: "mention" };

/** Числовое поле лимита: строка поля → число | undefined (пусто = дефолт). */
function num(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function ChannelsPage() {
  const [data, setData] = React.useState<ChannelsData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [createOpen, setCreateOpen] = React.useState(false);
  const [form, setForm] = React.useState<CreateForm>(EMPTY_FORM);
  const [busy, setBusy] = React.useState(false);

  // Форма глобальных параметров (заполняется из data при загрузке)
  const [syncTimeout, setSyncTimeout] = React.useState("");
  const [defaultChannel, setDefaultChannel] = React.useState(NO_VALUE);
  const [limits, setLimits] = React.useState<Record<string, string>>({});

  const load = React.useCallback(async () => {
    try {
      const d = await fetchChannels();
      setData(d);
      setError(null);
      setSyncTimeout(String(d.sync_timeout_sec));
      setDefaultChannel(d.default_channel ?? NO_VALUE);
      setLimits({
        dedup_ttl_sec: d.interbot_limits.dedup_ttl_sec?.toString() ?? "",
        bot_rate_per_min: d.interbot_limits.bot_rate_per_min?.toString() ?? "",
        human_rate_per_min: d.interbot_limits.human_rate_per_min?.toString() ?? "",
        global_runs_per_hour: d.interbot_limits.global_runs_per_hour?.toString() ?? "",
        max_depth: d.interbot_limits.max_depth?.toString() ?? "",
        gate_timeout_sec: d.interbot_limits.gate_timeout_sec?.toString() ?? "",
      });
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

  async function handleCreate() {
    setBusy(true);
    setError(null);
    try {
      const groupId = Number(form.groupId.trim());
      if (!Number.isInteger(groupId) || groupId === 0) {
        throw new Error("group_id: ожидается целое число (id Telegram-группы, не 0)");
      }
      const created = await createChannel({
        id: form.id.trim(),
        ...(form.label.trim() !== "" ? { label: form.label.trim() } : {}),
        group_id: groupId,
        addressing: form.addressing,
      });
      setCreateOpen(false);
      setForm(EMPTY_FORM);
      window.location.hash = `#/channel/${encodeURIComponent(created.channel.id)}`;
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveSettings() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const parsed: Record<string, number> = {};
      for (const [key, value] of Object.entries(limits)) {
        const n = num(value);
        if (value.trim() !== "" && n === undefined) {
          throw new Error(`${key}: ожидается положительное целое число`);
        }
        if (n !== undefined) parsed[key] = n;
      }
      const sync = Number(syncTimeout.trim());
      if (!Number.isInteger(sync) || sync <= 0) {
        throw new Error("sync_timeout_sec: ожидается положительное целое число");
      }
      await updateSettings({
        sync_timeout_sec: sync,
        default_channel: defaultChannel === NO_VALUE ? null : defaultChannel,
        interbot_limits: parsed,
      });
      setNotice("Сохранено. Бот подхватит изменения без перезапуска (чтение на каждое сообщение).");
      await load();
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
          <CardTitle>Каналы</CardTitle>
          <CardDescription>
            Межпроектная interbot-связь через Telegram-группы. Конфиг живёт в{" "}
            <code>.vibelog/comms.yaml</code>; секреты (bot_token/proxy) правятся там же руками —
            из интерфейса доступен только статус «настроен».
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error !== null && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {notice !== null && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
              {notice}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setForm(EMPTY_FORM);
                setCreateOpen(true);
              }}
            >
              Создать канал
            </Button>
            <Badge variant={data.secrets.bot_token ? "secondary" : "destructive"}>
              bot_token: {data.secrets.bot_token ? "настроен" : "не настроен"}
            </Badge>
            <Badge variant={data.secrets.proxy ? "secondary" : "outline"}>
              proxy: {data.secrets.proxy ? "настроен" : "не задан"}
            </Badge>
            <span className="text-sm text-muted-foreground">
              секреты — <code>.vibelog/comms.yaml</code> (руками)
            </span>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Канал</TableHead>
                <TableHead>Группа</TableHead>
                <TableHead>Адресация</TableHead>
                <TableHead>Согласование</TableHead>
                <TableHead>Admin chat</TableHead>
                <TableHead>Лимиты</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.channels.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer"
                  onClick={() => {
                    window.location.hash = `#/channel/${encodeURIComponent(c.id)}`;
                  }}
                >
                  <TableCell>
                    <div className="flex flex-col">
                      <a
                        href={`#/channel/${encodeURIComponent(c.id)}`}
                        className="font-medium hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {c.label || c.id}
                      </a>
                      <span className="font-mono text-xs text-muted-foreground">{c.id}</span>
                    </div>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{c.group_id}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{c.addressing}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={c.approval === "admin" ? "default" : "secondary"}>
                      {c.approval}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-sm">{c.admin_chat ?? "—"}</TableCell>
                  <TableCell>
                    {c.limits && Object.keys(c.limits).length > 0 ? (
                      <Badge variant="secondary">переопределение</Badge>
                    ) : (
                      <span className="text-sm text-muted-foreground">глобальные</span>
                    )}
                    {data.default_channel === c.id && (
                      <Badge variant="default" className="ml-2">
                        default
                      </Badge>
                    )}
                  </TableCell>
                </TableRow>
              ))}
              {data.channels.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                    Каналов нет — создайте первый (или заполните comms.yaml руками)
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Глобальные параметры</CardTitle>
          <CardDescription>
            Секция <code>interbot_limits</code> и поля <code>sync_timeout_sec</code>/
            <code>default_channel</code> в comms.yaml. Пустое поле лимита = дефолт кода.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="sync-timeout">sync_timeout_sec (ожидание ответа, с)</Label>
              <Input
                id="sync-timeout"
                type="number"
                min={1}
                value={syncTimeout}
                onChange={(e) => setSyncTimeout(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>default_channel</Label>
              <Select
                value={defaultChannel}
                onValueChange={(v) => setDefaultChannel(v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="не задан" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NO_VALUE}>не задан</SelectItem>
                  {data.channels.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.label || c.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-3">
            {(
              [
                ["dedup_ttl_sec", "dedup, с"],
                ["bot_rate_per_min", "лимит бота/мин"],
                ["human_rate_per_min", "лимит человека/мин"],
                ["global_runs_per_hour", "ранов/час"],
                ["max_depth", "глубина reply"],
                ["gate_timeout_sec", "таймаут гейта, с"],
              ] as const
            ).map(([key, title]) => (
              <div key={key} className="grid gap-1.5">
                <Label htmlFor={`limit-${key}`}>{title}</Label>
                <Input
                  id={`limit-${key}`}
                  type="number"
                  min={1}
                  placeholder="дефолт"
                  value={limits[key] ?? ""}
                  onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>

          <div>
            <Button onClick={() => void handleSaveSettings()} disabled={busy}>
              Сохранить параметры
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Создать канал</DialogTitle>
            <DialogDescription>
              Запись появится в .vibelog/comms.yaml. Секреты уже должны быть настроены там же.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="ch-id">id (латиница, цифры, дефис)</Label>
              <Input
                id="ch-id"
                placeholder="lb-link"
                value={form.id}
                onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ch-label">Название</Label>
              <Input
                id="ch-label"
                placeholder="Связь с LB"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ch-group">group_id (Telegram-группы)</Label>
              <Input
                id="ch-group"
                type="number"
                placeholder="-1001234567890"
                value={form.groupId}
                onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Адресация</Label>
              <Select
                value={form.addressing}
                onValueChange={(v) => setForm((f) => ({ ...f, addressing: v as "mention" | "all" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mention">mention — только /cmd@Bot и reply</SelectItem>
                  <SelectItem value="all">all — вся группа</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              Отмена
            </Button>
            <Button onClick={() => void handleCreate()} disabled={busy}>
              Создать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
