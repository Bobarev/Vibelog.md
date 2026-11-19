/**
 * Детальная страница канала (VL-438): #/channel/<id>.
 *
 * Три секции:
 * 1. **Поля канала** — label/group_id/addressing/approval/admin_chat →
 *    PUT /api/comms/channels/:id. Кнопка удаления: если канал является
 *    default_channel — предупреждение и подтверждение (force, AC5).
 * 2. **Лимиты и таймауты** — per-channel override (doc-32 §2), поверх
 *    глобальных; пустое поле = «как глобальный». Эффективные значения из
 *    GET показывают, что реально применяется.
 * 3. **Промпты** — тексты .vibelog/prompts/interbot/{incoming,gate}.md:
 *    редактирование (PUT) и сброс на дефолт пакета (reset). Изменение
 *    применяется горячо — файл читается на каждый вызов.
 *
 * Секреты не редактируются: бейдж «настроен» + подсказка править comms.yaml.
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
  deleteChannel,
  fetchChannel,
  fetchPrompts,
  resetPrompt,
  savePrompt,
  updateChannel,
  type ChannelDetailData,
  type PromptsData,
} from "./api";

/** Опции числовых полей limits: значение строки либо пусто (= дефолт). */
function num(v: string): number | undefined {
  const t = v.trim();
  if (t === "") return undefined;
  const n = Number(t);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function ChannelDetail({ id }: { id: string }) {
  const [detail, setDetail] = React.useState<ChannelDetailData | null>(null);
  const [prompts, setPrompts] = React.useState<PromptsData | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Поля формы
  const [label, setLabel] = React.useState("");
  const [groupId, setGroupId] = React.useState("");
  const [addressing, setAddressing] = React.useState<"mention" | "all">("mention");
  const [approval, setApproval] = React.useState<"auto" | "admin">("auto");
  const [adminChat, setAdminChat] = React.useState("");
  const [limits, setLimits] = React.useState<Record<string, string>>({});

  // Тексты промптов (черновики редактора)
  const [incomingText, setIncomingText] = React.useState("");
  const [gateText, setGateText] = React.useState("");

  const applyDetail = React.useCallback((d: ChannelDetailData) => {
    setDetail(d);
    setLabel(d.channel.label);
    setGroupId(String(d.channel.group_id));
    setAddressing(d.channel.addressing);
    setApproval(d.channel.approval);
    setAdminChat(d.channel.admin_chat !== null ? String(d.channel.admin_chat) : "");
    setLimits({
      dedup_ttl_sec: d.channel.limits?.dedup_ttl_sec?.toString() ?? "",
      bot_rate_per_min: d.channel.limits?.bot_rate_per_min?.toString() ?? "",
      human_rate_per_min: d.channel.limits?.human_rate_per_min?.toString() ?? "",
      global_runs_per_hour: d.channel.limits?.global_runs_per_hour?.toString() ?? "",
      max_depth: d.channel.limits?.max_depth?.toString() ?? "",
      gate_timeout_sec: d.channel.limits?.gate_timeout_sec?.toString() ?? "",
    });
  }, []);

  const load = React.useCallback(async () => {
    try {
      const [d, p] = await Promise.all([fetchChannel(id), fetchPrompts()]);
      applyDetail(d);
      setPrompts(p);
      setIncomingText(p.incoming.text);
      setGateText(p.gate.text);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [id, applyDetail]);

  React.useEffect(() => {
    if (id === "") return;
    // Загрузка при монтировании/смене id: setState в async-продолжении,
    // паттерн VL-174 — подавление ложного срабатывания
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [id, load]);

  async function handleSaveFields() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const gid = Number(groupId.trim());
      if (!Number.isInteger(gid) || gid === 0) {
        throw new Error("group_id: ожидается целое число (не 0)");
      }
      let admin: number | null = null;
      if (adminChat.trim() !== "") {
        const a = Number(adminChat.trim());
        if (!Number.isInteger(a)) throw new Error("admin_chat: ожидается целое число");
        admin = a;
      }
      const res = await updateChannel(id, {
        label: label.trim(),
        group_id: gid,
        addressing,
        approval,
        admin_chat: admin,
      });
      setNotice(`Канал «${res.channel.id}» сохранён.`);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveLimits() {
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
      await updateChannel(id, { limits: parsed });
      setNotice("Лимиты канала сохранены (переопределение поверх глобальных).");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    if (detail?.is_default) {
      const ok = window.confirm(
        `Канал «${id}» является default_channel!\n\n` +
          "Удаление сломает /ask и interbot_ask, пока default_channel не выбран заново " +
          "(он будет сброшен). Продолжить?",
      );
      if (!ok) return;
      setBusy(true);
      setError(null);
      try {
        const res = await deleteChannel(id, true);
        window.location.hash = "#/channels";
        void res; // default_channel_cleared/warning — на списке покажет следующая загрузка
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setBusy(false);
      }
      return;
    }
    const ok = window.confirm(`Удалить канал «${id}»? Файл comms.yaml будет изменён.`);
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      await deleteChannel(id);
      window.location.hash = "#/channels";
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleSavePrompt(name: "incoming" | "gate") {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const text = name === "incoming" ? incomingText : gateText;
      const saved = await savePrompt(name, text);
      setPrompts((prev) => (prev ? { ...prev, [name]: saved } : prev));
      if (name === "incoming") setIncomingText(saved.text);
      else setGateText(saved.text);
      setNotice(`Промпт «${name}» сохранён в ${saved.path} — применяется горячо.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetPrompt(name: "incoming" | "gate") {
    const ok = window.confirm(
      `Сбросить промпт «${name}» на дефолт пакета? Проектный файл будет удалён.`,
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const saved = await resetPrompt(name);
      setPrompts((prev) => (prev ? { ...prev, [name]: saved } : prev));
      if (name === "incoming") setIncomingText(saved.text);
      else setGateText(saved.text);
      setNotice(`Промпт «${name}» сброшен на дефолт пакета.`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (id === "") {
    return <div className="p-2 text-sm text-muted-foreground">Канал не указан</div>;
  }
  if (detail === null) {
    return (
      <div className="grid gap-3 p-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  return (
    <div className="grid gap-4 p-2">
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Канал <code>{detail.channel.id}</code>
            {detail.is_default && <Badge variant="default">default_channel</Badge>}
            <Badge variant="outline">{detail.channel.transport}</Badge>
          </CardTitle>
          <CardDescription>
            Секреты канала: bot_token {detail.secrets.bot_token ? "настроен" : "не настроен"}, proxy{" "}
            {detail.secrets.proxy ? "настроен" : "не задан"}. Редактирование секретов из UI
            недоступно — правьте <code>.vibelog/comms.yaml</code> руками.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="f-label">Название</Label>
              <Input id="f-label" value={label} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-group">group_id</Label>
              <Input
                id="f-group"
                type="number"
                value={groupId}
                onChange={(e) => setGroupId(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Адресация</Label>
              <Select value={addressing} onValueChange={(v) => setAddressing(v as "mention" | "all")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="mention">mention — /cmd@Bot и reply</SelectItem>
                  <SelectItem value="all">all — вся группа</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label>Согласование</Label>
              <Select value={approval} onValueChange={(v) => setApproval(v as "auto" | "admin")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">auto — бот отвечает сам</SelectItem>
                  <SelectItem value="admin">admin — inline-кнопки</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="f-admin">admin_chat (пусто = нет)</Label>
              <Input
                id="f-admin"
                type="number"
                placeholder="—"
                value={adminChat}
                onChange={(e) => setAdminChat(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => void handleSaveFields()} disabled={busy}>
              Сохранить
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()} disabled={busy}>
              Удалить канал
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Лимиты и таймауты</CardTitle>
          <CardDescription>
            Переопределение поверх глобальных (doc-32 §2): пустое поле = глобальное значение.{" "}
            {detail.is_default && detail.channel.id !== "" && (
              <>
                Сейчас эффективно: бот {detail.effective_limits.botRatePerMin}/мин, человек{" "}
                {detail.effective_limits.humanRatePerMin}/мин,{" "}
                {detail.effective_limits.globalRunsPerHour} ранов/час, глубина{" "}
                {detail.effective_limits.maxDepth}, dedup{" "}
                {Math.round(detail.effective_limits.dedupTtlMs / 1000)} с.
              </>
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
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
                <Label htmlFor={`cl-${key}`}>{title}</Label>
                <Input
                  id={`cl-${key}`}
                  type="number"
                  min={1}
                  placeholder="глобальный"
                  value={limits[key] ?? ""}
                  onChange={(e) => setLimits((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              </div>
            ))}
          </div>
          <div>
            <Button onClick={() => void handleSaveLimits()} disabled={busy}>
              Сохранить лимиты
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Промпты</CardTitle>
          <CardDescription>
            Проектные шаблоны <code>.vibelog/prompts/interbot/</code> поверх дефолтов пакета
            (templates/prompts/interbot/). Сохранение и сброс применяются горячо — файл читается
            на каждый вызов.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {prompts !== null && (
            <>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="p-incoming">Входящий ран (incoming.md)</Label>
                  <Badge variant={prompts.incoming.source === "project" ? "default" : "secondary"}>
                    {prompts.incoming.source === "project" ? "проектный" : "дефолт пакета"}
                  </Badge>
                </div>
                <Textarea
                  id="p-incoming"
                  rows={10}
                  className="font-mono text-sm"
                  value={incomingText}
                  onChange={(e) => setIncomingText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleSavePrompt("incoming")} disabled={busy}>
                    Сохранить incoming
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleResetPrompt("incoming")}
                    disabled={busy || prompts.incoming.source !== "project"}
                  >
                    Сброс на дефолт
                  </Button>
                </div>
              </div>
              <div className="grid gap-1.5">
                <div className="flex items-center gap-2">
                  <Label htmlFor="p-gate">Гейт (gate.md)</Label>
                  <Badge variant={prompts.gate.source === "project" ? "default" : "secondary"}>
                    {prompts.gate.source === "project" ? "проектный" : "дефолт пакета"}
                  </Badge>
                </div>
                <Textarea
                  id="p-gate"
                  rows={9}
                  className="font-mono text-sm"
                  value={gateText}
                  onChange={(e) => setGateText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={() => void handleSavePrompt("gate")} disabled={busy}>
                    Сохранить gate
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleResetPrompt("gate")}
                    disabled={busy || prompts.gate.source !== "project"}
                  >
                    Сброс на дефолт
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
