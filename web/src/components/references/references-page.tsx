/**
 * Страница «References» (VL-174): список внешних источников + Sync.
 *
 * Роут #/references. Показывает для каждого reference: title (ссылка на
 * детальную страницу), type, url/path, tags, linked_tasks. Кнопка Sync
 * (POST /api/references/sync) клонирует отсутствующие репо И обновляет
 * markdown-кэш url/doc-референсов (VL-358) — оба итога выводятся отдельными
 * строками, ошибки кэша — с ref-id и текстом (destructive). Все fetch —
 * в try/catch с выводом ошибки в state: консоль браузера остаётся без
 * ошибок (lesson-16).
 */

import * as React from "react";

import { RefreshCw } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  fetchReferences,
  syncReferences,
  type ReferenceListItem,
  type SyncResult,
} from "./api";

/** Итог sync в виде, готовом к рендеру: клоны, кэш и ошибки кэша отдельно. */
interface SyncSummary {
  repos: string;
  cache: string;
  cacheErrors: { id: string; error: string }[];
}

/** Форматирует итог sync: клоны и кэш — разными строками (VL-358, AC3). */
function formatSyncResult(result: SyncResult): SyncSummary {
  // VL-417: клон теперь обновляется pull'ом — «обновлено» отдельно от «без изменений»
  const repos = [
    `Репозитории — клонировано: ${result.cloned.length}`,
    `обновлено: ${(result.updated ?? []).length}`,
    `без изменений: ${result.skipped.length}`,
    `ошибок: ${result.failed.length}`,
  ].join(", ");
  const reposFailed = result.failed.map((f) => `${f.id}: ${f.error}`).join("; ");

  const cache = result.cache;
  const cacheText = cache
    ? [
        `Кэш — обновлено: ${cache.updated.length}`,
        `без изменений: ${cache.skipped.length}`,
        `ошибок: ${cache.failed.length}`,
      ].join(", ")
    : "Кэш — нет данных";

  return {
    repos: reposFailed ? `${repos}. ${reposFailed}` : repos,
    cache: cacheText,
    cacheErrors: cache?.failed ?? [],
  };
}

export function ReferencesPage() {
  const [entries, setEntries] = React.useState<ReferenceListItem[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [syncing, setSyncing] = React.useState(false);
  const [syncMessage, setSyncMessage] = React.useState<SyncSummary | null>(null);

  /** Загрузка списка (повторно — после sync). */
  const load = React.useCallback(async () => {
    try {
      setEntries(await fetchReferences());
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка списка при монтировании: setState уходят в async-продолжение
    // load (после await), паттерн VL-174 — подавление ложного срабатывания
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    setSyncMessage(null);
    setError(null);
    try {
      const result = await syncReferences();
      setSyncMessage(formatSyncResult(result));
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold">References</h1>
          <p className="text-sm text-muted-foreground">
            Внешние источники знаний (backlog/references/)
          </p>
        </div>
        <Button
          onClick={handleSync}
          disabled={syncing}
          title="Клонировать отсутствующие репо и обновить кэш url/doc-референсов"
        >
          <RefreshCw className={syncing ? "animate-spin" : undefined} />
          {syncing ? "Синхронизация…" : "Sync"}
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {syncMessage && (
        <div className="space-y-1 text-sm">
          <p className="text-muted-foreground">{syncMessage.repos}</p>
          <p
            className={
              syncMessage.cacheErrors.length > 0 ? "text-destructive" : "text-muted-foreground"
            }
          >
            {syncMessage.cache}
          </p>
          {syncMessage.cacheErrors.map((failure) => (
            <p key={failure.id} className="text-sm text-destructive">
              {failure.id}: {failure.error}
            </p>
          ))}
        </div>
      )}

      {entries === null ? (
        !error && <p className="text-sm text-muted-foreground">Загрузка…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          References пока нет. Добавьте их CLI: vibelog reference add
        </p>
      ) : (
        <div className="space-y-2">
          {entries.map(({ reference: ref, path }) => (
            <Card key={ref.id} className="py-3">
              <CardContent className="px-4">
                <div className="flex flex-wrap items-center gap-2">
                  <a
                    href={`#/reference/${encodeURIComponent(ref.id)}`}
                    className="font-medium hover:underline"
                  >
                    {ref.title}
                  </a>
                  <Badge variant="secondary">{ref.type}</Badge>
                  <span className="truncate text-xs text-muted-foreground" title={ref.url || ref.path || path}>
                    {ref.url || ref.path || path}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  {ref.tags.map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                  {ref.linked_tasks.map((taskId) => (
                    // Без ссылки: deep-link на задачу в вебе не реализован
                    // (роутер таких маршрутов не знает) — только индикация
                    <Badge key={taskId} variant="outline">
                      {taskId}
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
