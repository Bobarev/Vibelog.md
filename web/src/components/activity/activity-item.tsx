/**
 * Одна запись ленты активности (VL-347).
 *
 * Иконка типа + время + summary + бейджи источника/фазы; `phase_failed`
 * выделен destructive-акцентом и показывает причину текстом (AC12), а не
 * только иконкой. Клик по записи ведёт на сущность (AC8): задача — модалка
 * на доске через requestOpenTask (VL-182), остальные — хеш-маршруты
 * #/reference/<id>, #/document/<id>, #/lesson/<id>.
 */

import * as React from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDot,
  FileText,
  Lightbulb,
  Library,
  ListChecks,
  MessageSquare,
  Play,
  ShieldCheck,
  ShieldX,
  Square,
  XCircle,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { requestOpenTask } from "@/lib/open-task";

import {
  ACTIVITY_SOURCE_LABELS,
  ACTIVITY_TYPE_LABELS,
  type ActivityEvent,
  type ActivityLink,
  type ActivityType,
} from "./api";

/** Иконка по типу события. */
const TYPE_ICONS: Record<ActivityType, React.ComponentType<{ className?: string }>> = {
  phase_started: Play,
  phase_finished: CheckCircle2,
  phase_failed: AlertTriangle,
  task_created: CircleDot,
  task_status_changed: ListChecks,
  task_closed: CheckCircle2,
  comment: MessageSquare,
  queue_started: Play,
  queue_stopped: Square,
  queue_failed: XCircle,
  grant_started: ShieldCheck,
  grant_revoked: ShieldX,
};

/** Иконка по типу ссылки. */
const LINK_ICONS: Record<ActivityLink["kind"], React.ComponentType<{ className?: string }>> = {
  task: ListChecks,
  reference: Library,
  document: FileText,
  lesson: Lightbulb,
};

/** Время события в формате HH:MM (локальная зона). */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "--:--";
  return date.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Хеш-маршрут для ссылки (задача открывается модалкой, не маршрутом). */
function linkHref(link: ActivityLink): string {
  switch (link.kind) {
    case "reference":
      return `#/reference/${encodeURIComponent(link.id)}`;
    case "document":
      return `#/document/${encodeURIComponent(link.id)}`;
    case "lesson":
      return `#/lesson/${encodeURIComponent(link.id)}`;
    default:
      return "#/";
  }
}

/** Пропсы записи ленты. */
export interface ActivityItemProps {
  event: ActivityEvent;
}

export function ActivityItem({ event }: ActivityItemProps) {
  const [expanded, setExpanded] = React.useState(false);
  const Icon = TYPE_ICONS[event.type] ?? CircleDot;
  const failed = event.type === "phase_failed";
  const reason = typeof event.details?.reason === "string" ? event.details.reason : "";
  const approximate = event.details?.approximate === true;
  const links = event.links ?? [];
  const taskLink = links.find((l) => l.kind === "task");
  const otherLinks = links.filter((l) => l.kind !== "task");

  /** Переход по записи: задача — модалка на доске, прочее — хеш-маршрут. */
  function handleOpen() {
    if (taskLink) {
      requestOpenTask(taskLink.id);
      return;
    }
    if (otherLinks.length > 0) {
      window.location.hash = linkHref(otherLinks[0]);
    }
  }

  const clickable = Boolean(taskLink) || otherLinks.length > 0;

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border px-3 py-2 transition-colors",
        failed && "border-destructive/50 bg-destructive/5",
        clickable && "cursor-pointer hover:bg-muted/60",
      )}
      onClick={clickable ? handleOpen : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                handleOpen();
              }
            }
          : undefined
      }
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <Icon
        className={cn(
          "mt-0.5 size-4 shrink-0",
          failed ? "text-destructive" : "text-muted-foreground",
        )}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-muted-foreground">{formatTime(event.at)}</span>
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sm",
              failed && "font-medium text-destructive",
            )}
            title={event.summary}
          >
            {event.summary}
          </span>
          {event.phase && <Badge variant="outline">{event.phase}</Badge>}
          {event.source && (
            <Badge variant="secondary">
              {ACTIVITY_SOURCE_LABELS[event.source] ?? event.source}
            </Badge>
          )}
          {approximate && (
            <Badge variant="outline" title="Восстановлено по updated_date — не точное время">
              ≈
            </Badge>
          )}
        </div>

        {/* AC12: причина падения — текстом, а не только иконкой */}
        {failed && reason && (
          <p className="mt-1 whitespace-pre-wrap text-xs text-destructive">{reason}</p>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {ACTIVITY_TYPE_LABELS[event.type] ?? event.type}
          </span>
          {taskLink && (
            <span className="font-mono text-xs text-muted-foreground">{taskLink.id}</span>
          )}
          {otherLinks.map((link) => {
            const LinkIcon = LINK_ICONS[link.kind];
            return (
              <a
                key={`${link.kind}:${link.id}`}
                href={linkHref(link)}
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:underline"
                onClick={(e) => e.stopPropagation()}
              >
                <LinkIcon className="size-3" />
                {link.id}
              </a>
            );
          })}
          {event.details && Object.keys(event.details).length > 0 && (
            <button
              type="button"
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded((prev) => !prev);
              }}
            >
              {expanded ? "Свернуть" : "Подробнее"}
            </button>
          )}
        </div>

        {expanded && event.details && (
          <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted/50 p-2 text-xs">
            {JSON.stringify(event.details, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}
