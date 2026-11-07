/**
 * Страница «Активность» (#/activity, VL-347) — единый лог работ.
 *
 * Обратная хронология событий из всех источников (billing, меты сессий,
 * задачи, автоочередь, grant-ы супервизора) с группировкой по дням
 * («Сегодня» / «Вчера» / дата), фильтрами (период, тип, источник, поиск по
 * ID задачи) и догрузкой «Показать ещё» (AC7–AC11).
 *
 * Данные — серверные: фильтры уходят в GET /api/activity, поэтому лента не
 * тянет тысячи записей сразу (AC10). Ошибки — в state, не в консоль
 * (lesson-16).
 */

import * as React from "react";
import { ListFilter, RefreshCw, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

import { ActivityItem } from "./activity-item";
import {
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_TYPES,
  ACTIVITY_TYPE_LABELS,
  fetchActivity,
  type ActivityEvent,
  type ActivitySource,
  type ActivityType,
} from "./api";

/** Размер страницы ленты (AC10: не грузим всё сразу). */
const PAGE_SIZE = 50;

/** Значение Select «Все источники»: Radix не принимает пустой value. */
const ALL_SOURCES = "__all__";

/** Периоды фильтра: подпись + сколько дней назад (undefined — всё время). */
const PERIODS: { id: string; label: string; days?: number }[] = [
  { id: "today", label: "Сегодня", days: 0 },
  { id: "7d", label: "7 дней", days: 7 },
  { id: "30d", label: "30 дней", days: 30 },
  { id: "all", label: "Всё время" },
];

/** Начало периода в ISO (для since). */
function periodSince(periodId: string): string | undefined {
  const period = PERIODS.find((p) => p.id === periodId);
  if (!period || period.days === undefined) return undefined;
  const date = new Date();
  if (period.days === 0) {
    date.setHours(0, 0, 0, 0);
  } else {
    date.setDate(date.getDate() - period.days);
  }
  return date.toISOString();
}

/** Ключ дня события (локальная дата) — база группировки. */
function dayKey(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** Подпись группы дня: Сегодня / Вчера / «12 ноября». */
function dayLabel(key: string): string {
  const today = dayKey(new Date().toISOString());
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterday = dayKey(yesterdayDate.toISOString());
  if (key === today) return "Сегодня";
  if (key === yesterday) return "Вчера";
  const [year, month, day] = key.split("-").map(Number);
  if (!year || !month || !day) return key;
  return new Date(year, month - 1, day).toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
  });
}

/** Группировка событий по дням с сохранением порядка (лента уже отсортирована). */
function groupByDay(events: ActivityEvent[]): { key: string; label: string; events: ActivityEvent[] }[] {
  const groups: { key: string; label: string; events: ActivityEvent[] }[] = [];
  for (const event of events) {
    const key = dayKey(event.at);
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.events.push(event);
      continue;
    }
    groups.push({ key, label: dayLabel(key), events: [event] });
  }
  return groups;
}

export function ActivityPage() {
  const [events, setEvents] = React.useState<ActivityEvent[]>([]);
  const [total, setTotal] = React.useState(0);
  const [hasMore, setHasMore] = React.useState(false);
  const [loading, setLoading] = React.useState(true);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  // Фильтры (AC9)
  const [period, setPeriod] = React.useState("7d");
  const [types, setTypes] = React.useState<ActivityType[]>([]);
  const [source, setSource] = React.useState(ALL_SOURCES);
  const [taskQuery, setTaskQuery] = React.useState("");

  /** Параметры запроса из текущего состояния фильтров. */
  const buildParams = React.useCallback(
    (offset: number) => ({
      ...(periodSince(period) ? { since: periodSince(period) as string } : {}),
      ...(types.length > 0 ? { types } : {}),
      ...(source !== ALL_SOURCES ? { source } : {}),
      ...(taskQuery.trim() ? { taskId: taskQuery.trim() } : {}),
      limit: PAGE_SIZE,
      offset,
    }),
    [period, types, source, taskQuery],
  );

  /** Первая загрузка/перезагрузка при смене фильтров. */
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchActivity(buildParams(0));
      setEvents(data.events);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка загрузки");
      setEvents([]);
      setTotal(0);
      setHasMore(false);
    } finally {
      setLoading(false);
    }
  }, [buildParams]);

  React.useEffect(() => {
    // setState уходят в async-продолжение load (после await) — паттерн VL-174
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** «Показать ещё» — догрузка следующей страницы по offset (AC10). */
  async function loadMore() {
    setLoadingMore(true);
    try {
      const data = await fetchActivity(buildParams(events.length));
      setEvents((prev) => [...prev, ...data.events]);
      setTotal(data.total);
      setHasMore(data.hasMore);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Неизвестная ошибка загрузки");
    } finally {
      setLoadingMore(false);
    }
  }

  /** Toggle типа в мультивыборе. */
  function toggleType(type: ActivityType) {
    setTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  }

  const groups = React.useMemo(() => groupByDay(events), [events]);
  const filtersActive =
    types.length > 0 || source !== ALL_SOURCES || taskQuery.trim() !== "" || period !== "all";

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">Активность</h1>
          <p className="text-sm text-muted-foreground">
            Единый лог работ: фазы, задачи, очередь, супервизор
          </p>
        </div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}>
          <RefreshCw data-icon="inline-start" className={cn(loading && "animate-spin")} />
          Обновить
        </Button>
      </div>

      {/* Фильтры в одну строку (AC9) */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={period} onValueChange={setPeriod}>
          <SelectTrigger className="w-[150px]" aria-label="Период">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PERIODS.map((p) => (
              <SelectItem key={p.id} value={p.id}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "border-dashed",
                types.length > 0 && "border-solid bg-muted text-foreground",
              )}
            >
              <ListFilter data-icon="inline-start" />
              Тип{types.length > 0 ? ` (${types.length})` : ""}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-60">
            <DropdownMenuGroup>
              {ACTIVITY_TYPES.map((type) => (
                <DropdownMenuCheckboxItem
                  key={type}
                  checked={types.includes(type)}
                  onCheckedChange={() => toggleType(type)}
                  onSelect={(event) => event.preventDefault()}
                >
                  {ACTIVITY_TYPE_LABELS[type]}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
            {types.length > 0 && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuGroup>
                  <DropdownMenuItem
                    onSelect={() => setTypes([])}
                    className="justify-center text-center"
                  >
                    <X />
                    Сбросить типы
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>

        <Select value={source} onValueChange={setSource}>
          <SelectTrigger className="w-[170px]" aria-label="Источник запуска">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL_SOURCES}>Все источники</SelectItem>
            {(Object.keys(ACTIVITY_SOURCE_LABELS) as ActivitySource[]).map((key) => (
              <SelectItem key={key} value={key}>
                {ACTIVITY_SOURCE_LABELS[key]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={taskQuery}
          onChange={(e) => setTaskQuery(e.target.value)}
          placeholder="ID задачи (VL-123)"
          className="w-[180px]"
          aria-label="Поиск по ID задачи"
        />

        {filtersActive && (
          <Button
            variant="destructive"
            onClick={() => {
              setPeriod("all");
              setTypes([]);
              setSource(ALL_SOURCES);
              setTaskQuery("");
            }}
          >
            <X data-icon="inline-start" />
            Сбросить
          </Button>
        )}
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}

      {loading ? (
        <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : events.length === 0 ? (
        // AC11: пустое состояние с подсказкой расширить период
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">Событий за период нет.</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Попробуйте расширить период (например, «Всё время») или снять фильтры.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {groups.map((group) => (
            <div key={group.key} className="space-y-2">
              <h2 className="sticky top-0 z-10 bg-background/95 py-1 text-xs font-medium uppercase tracking-wide text-muted-foreground backdrop-blur">
                {group.label}
              </h2>
              <div className="space-y-1.5">
                {group.events.map((event, index) => (
                  <ActivityItem key={`${event.at}-${event.type}-${index}`} event={event} />
                ))}
              </div>
            </div>
          ))}

          <div className="flex items-center justify-between gap-2 pt-2">
            <span className="text-xs text-muted-foreground">
              Показано {events.length} из {total}
            </span>
            {hasMore && (
              <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Загрузка…" : "Показать ещё"}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
