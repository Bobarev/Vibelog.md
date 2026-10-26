/**
 * Режим просмотра задачи: табы-секции + md-рендер + поле комментария (VL-172).
 *
 * Секции и порядок табов — копия rich-рендера карточки бота
 * (src/bot/rich.ts, renderTaskRich): Описание, Acceptance Criteria,
 * Definition of Done, Implementation Plan, Implementation Notes,
 * Final Summary, Комментарии. «Описание» и «Комментарии» видны всегда
 * (пустые — с плейсхолдером), остальные — только при непустом содержимом
 * (как filled() в боте).
 *
 * Поле комментария рендерится ВНЕ <Tabs> (между контентом и футером
 * модалки) — доступно на всех вкладках, состояние живёт в TaskModalBody
 * и не теряется при переключении таба (AC2).
 *
 * Данные: detail из GET /api/tasks/:id (полный Task с секциями);
 * fallback на KanbanTask (только description), пока грузится/упал fetch.
 */

import { MarkdownView } from '@/lib/markdown';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { ChecklistItem, KanbanTask, TaskDetail } from '../../types/kanban';

interface TaskViewProps {
  /** Карточка с доски — fallback-данные, пока не пришёл detail. */
  task: KanbanTask;
  /** Полная задача из GET /api/tasks/:id; null — загрузка/ошибка. */
  detail: TaskDetail | null;
  detailLoading: boolean;
  /** Текст поля комментария (state владельца — TaskModalBody). */
  commentText: string;
  onCommentChange: (value: string) => void;
}

/**
 * Чеклист AC/DoD → md-строки `- [x] Текст` для GFM task-list.
 * Строки хранения («- [ ] #1 …») уходят как есть, объекты нумеруются с 1.
 */
function checklistToMd(items: (ChecklistItem | string)[]): string {
  return items
    .map((item, i) =>
      typeof item === 'string'
        ? item
        : `- [${item.checked ? 'x' : ' '}] ${i + 1}. ${item.text}`
    )
    .join('\n');
}

/** Заполнена ли секция (analog filled() из rich.ts). */
function filled(value: string | number | unknown[]): boolean {
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'string' ? value.trim().length > 0 : Boolean(value);
}

export function TaskView({
  task,
  detail,
  detailLoading,
  commentText,
  onCommentChange,
}: TaskViewProps) {
  const d = detail;
  // Fallback: description из карточки, пока detail не загрузился
  const description = d?.description ?? task.description;
  const ac = d?.acceptanceCriteria ?? [];
  const dod = d?.definitionOfDone ?? [];
  const plan = d?.implementationPlan ?? '';
  const notes = d?.implementationNotes ?? '';
  const finalSummary = d?.finalSummary ?? '';
  const comments = d?.comments ?? [];
  // Агрегат токенов (VL-198): undefined/ноль → таб не показывается
  const tokenUsage = d?.token_usage;
  const hasTokens = Boolean(
    tokenUsage && (tokenUsage.total > 0 || tokenUsage.input > 0 || tokenUsage.requests > 0)
  );

  return (
    <div className="flex min-h-0 flex-col gap-3">
      {detailLoading ? (
        <p className="text-muted-foreground text-sm">Загрузка задачи…</p>
      ) : null}

      <Tabs defaultValue="description">
        <TabsList className="h-auto flex-wrap justify-start">
          <TabsTrigger value="description">Описание</TabsTrigger>
          {filled(ac) ? (
            <TabsTrigger value="ac">Acceptance Criteria</TabsTrigger>
          ) : null}
          {filled(dod) ? (
            <TabsTrigger value="dod">Definition of Done</TabsTrigger>
          ) : null}
          {filled(plan) ? <TabsTrigger value="plan">Implementation Plan</TabsTrigger> : null}
          {filled(notes) ? (
            <TabsTrigger value="notes">Implementation Notes</TabsTrigger>
          ) : null}
          {filled(finalSummary) ? (
            <TabsTrigger value="final">Final Summary</TabsTrigger>
          ) : null}
          {hasTokens ? <TabsTrigger value="tokens">Токены</TabsTrigger> : null}
          <TabsTrigger value="comments">Комментарии ({comments.length})</TabsTrigger>
        </TabsList>

        <TabsContent value="description">
          {filled(description) ? (
            <MarkdownView>{description}</MarkdownView>
          ) : (
            <p className="text-muted-foreground text-sm">Описание отсутствует.</p>
          )}
          {(d?.assignee ?? task.assignee).length > 0 ? (
            <p className="text-muted-foreground mt-2 text-sm">
              Исполнители: {(d?.assignee ?? task.assignee).join(', ')}
            </p>
          ) : null}
        </TabsContent>

        {filled(ac) ? (
          <TabsContent value="ac">
            <MarkdownView>{checklistToMd(ac)}</MarkdownView>
          </TabsContent>
        ) : null}
        {filled(dod) ? (
          <TabsContent value="dod">
            <MarkdownView>{checklistToMd(dod)}</MarkdownView>
          </TabsContent>
        ) : null}
        {filled(plan) ? (
          <TabsContent value="plan">
            <MarkdownView>{plan}</MarkdownView>
          </TabsContent>
        ) : null}
        {filled(notes) ? (
          <TabsContent value="notes">
            <MarkdownView>{notes}</MarkdownView>
          </TabsContent>
        ) : null}
        {filled(finalSummary) ? (
          <TabsContent value="final">
            <MarkdownView>{finalSummary}</MarkdownView>
          </TabsContent>
        ) : null}

        {/* Секция «Токены» (VL-198): totals + вклад по фазам. Деньги не
            показываем — считаются аналитикой по тарифу (calculateCost). */}
        {hasTokens && tokenUsage ? (
          <TabsContent value="tokens">
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 sm:grid-cols-3">
                <p>Input: <span className="font-medium tabular-nums">{tokenUsage.input}</span></p>
                <p>Output: <span className="font-medium tabular-nums">{tokenUsage.output}</span></p>
                <p>Cache: <span className="font-medium tabular-nums">{tokenUsage.cache}</span></p>
                <p>Total: <span className="font-medium tabular-nums">{tokenUsage.total}</span></p>
                <p>Запросы: <span className="font-medium tabular-nums">{tokenUsage.requests}</span></p>
                {tokenUsage.duration_ms ? (
                  <p>Длительность: <span className="font-medium tabular-nums">
                    {Math.round(tokenUsage.duration_ms / 1000)}с
                  </span></p>
                ) : null}
              </div>
              {tokenUsage.by_phase && Object.keys(tokenUsage.by_phase).length > 0 ? (
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">Фаза</th>
                      <th className="py-1 pr-3 text-right font-medium">Input</th>
                      <th className="py-1 pr-3 text-right font-medium">Output</th>
                      <th className="py-1 pr-3 text-right font-medium">Cache</th>
                      <th className="py-1 text-right font-medium">Запросы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(tokenUsage.by_phase).map(([phase, u]) => (
                      <tr key={phase} className="border-b last:border-0">
                        <td className="py-1 pr-3 font-medium">{phase}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{u.input}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{u.output}</td>
                        <td className="py-1 pr-3 text-right tabular-nums">{u.cache}</td>
                        <td className="py-1 text-right tabular-nums">{u.requests}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : null}
            </div>
          </TabsContent>
        ) : null}

        <TabsContent value="comments">
          {comments.length === 0 ? (
            <p className="text-muted-foreground text-sm">Комментариев нет.</p>
          ) : (
            <div className="space-y-3">
              {comments.map((c, i) => (
                <div key={`${c.created}-${i}`}>
                  <p className="font-medium text-xs">
                    {c.author} <span className="text-muted-foreground font-normal">· {c.created}</span>
                  </p>
                  <MarkdownView>{c.text}</MarkdownView>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Поле комментария вне Tabs — видно на любой вкладке (AC2) */}
      <div className="space-y-1.5 border-t pt-3">
        <Label htmlFor="task-comment">Комментарий</Label>
        <Textarea
          id="task-comment"
          value={commentText}
          onChange={e => onCommentChange(e.target.value)}
          placeholder="Комментарий к фазе: уйдёт в задачу и в промпт при нажатии кнопки фазы…"
          rows={3}
        />
      </div>
    </div>
  );
}
