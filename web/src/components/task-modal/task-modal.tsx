/**
 * Модальное окно задачи: просмотр/создание/редактирование (VL-163, VL-172).
 *
 * Управляемый компонент (open/onOpenChange, как Sheet в ref-14:
 * TaskCreateSheet/TaskEditSheet), один примитив + режимы внутри —
 * паттерн ref-3 (vibe-kanban: Dialog.tsx + специализированные диалоги).
 *
 * Весь изменяемый state живёт в TaskModalBody — mount-only компоненте,
 * который сам рендерит <Dialog> (а не лежит его child): так body владеет
 * обёрткой onOpenChange и сбрасывает state при закрытии ЛЮБЫМ способом
 * (Escape/оверлей/кнопки) — повторное открытие всегда стартует с пропа
 * mode (AC3 VL-172: reopen после «Редактировать» → просмотр).
 *
 * Режимы:
 * - view: табы-секции по образцу карточки бота (TaskView), md-рендер,
 *   поле комментария и кнопки по статусу (nextPhaseForStatus из бота:
 *   Review → ✅ Close + 💬 Комментарий; To Do → ▶ Spec + ✖ Reject);
 *   комментарий при нажатии кнопки фазы пишется в задачу и уходит в
 *   {{comment}} промпта (POST trigger, VL-172);
 * - create/edit: общая форма (TaskForm), Save/Cancel; «Отмена» в edit
 *   возвращает в просмотр без сохранения (AC3); в edit дополнительно
 *   «Архивировать» с подтверждением (window.confirm, как reject в assets.ts).
 *
 * Ошибки сети показываются текстом в модалке (text-destructive) —
 * без console.error (lesson-16: консоль браузера без ошибок).
 */

import * as React from 'react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  archiveTask,
  createTask,
  fetchTask,
  patchTask,
  rejectTask,
  triggerPhase,
} from '@/components/kanban/api';
import { phaseButtonLabel } from '@/lib/phase-buttons';
import type { KanbanTask, TaskDetail } from '@/types/kanban';

import { TaskForm, emptyTaskForm, taskToForm, type TaskFormData } from './task-form';
import { TaskView } from './task-view';

/** Режим модалки: просмотр существующей, создание, редактирование. */
export type TaskModalMode = 'view' | 'create' | 'edit';

/** Общие пропсы управляющего компонента и mount-only тела. */
interface TaskModalSharedProps {
  mode: TaskModalMode;
  /** Задача для view/edit; для create — null. */
  task: KanbanTask | null;
  /** Статусы колонок (columnOrder доски) — для селекта статуса. */
  statuses: string[];
  /** Вызывается после успешного создания/сохранения/архивирования. */
  onSaved: () => void;
  /** Запуск фазы из модалки → поллинг завершения на доске (VL-172). */
  onTriggered?: (taskId: string) => void;
}

export function TaskModal({
  open,
  onOpenChange,
  ...shared
}: TaskModalSharedProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <TaskModalBody
      // key — страховка: новое тело при смене mode/задачи без закрытия
      key={`${shared.mode}:${shared.task?.id ?? 'new'}`}
      open={open}
      onOpenChange={onOpenChange}
      {...shared}
    />
  );
}

/**
 * Mount-only тело модалки: state инициализируется из пропсов при рендере;
 * при закрытии (handleOpenChange) сбрасывается к пропу mode — reopen
 * без «залипшего» edit-режима (AC3 VL-172).
 */
function TaskModalBody({
  open,
  onOpenChange,
  mode,
  task,
  statuses,
  onSaved,
  onTriggered,
}: TaskModalSharedProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  // Внутренний режим: view → edit переключается кнопкой «Редактировать»
  const [internalMode, setInternalMode] = React.useState<TaskModalMode>(mode);
  const [form, setForm] = React.useState<TaskFormData>(() =>
    mode !== 'create' && task ? taskToForm(task) : emptyTaskForm(statuses),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Полная задача для табов view-режима (VL-172): GET /api/tasks/:id
  const [detail, setDetail] = React.useState<TaskDetail | null>(null);
  // Флаг «fetch завершился ошибкой»: без него detail===null неотличим от
  // «грузится» и плейсхолдер «Загрузка…» висел бы вечно (react-hooks v7
  // set-state-in-effect запрещает синхронный setDetailLoading(true) в
  // эффекте — loading выводится при рендере как detail===null && !failed)
  const [detailFailed, setDetailFailed] = React.useState(false);
  const [commentText, setCommentText] = React.useState('');

  const canSubmit = form.title.trim().length > 0 && !submitting;
  const detailLoading = internalMode === 'view' && detail === null && !detailFailed;

  /**
   * Закрытие окна любым способом: сброс к пропу mode — при следующем
   * открытии (key body не меняется) режим берётся из пропса, а не из
   * «залипшего» internalMode (AC3 VL-172). Вызывается ВСЕМИ путями
   * закрытия: Escape/оверлей (через Dialog onOpenChange) и кнопками.
   */
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setInternalMode(mode);
      setForm(mode !== 'create' && task ? taskToForm(task) : emptyTaskForm(statuses));
      setError(null);
      setCommentText('');
      setDetail(null);
      setDetailFailed(false);
    }
    onOpenChange(next);
  };

  /**
   * Загрузка полной задачи для табов: setState только в .then-колбэках
   * (асинхронно) — иначе eslint react-hooks v7 set-state-in-effect флагает
   * вызов async-функции с setState из тела эффекта. stale-флаг защищает
   * от гонки при быстрой смене открытой задачи.
   */
  React.useEffect(() => {
    if (!open || internalMode !== 'view' || !task) return;
    let stale = false;
    fetchTask(task.id)
      .then(d => {
        if (stale) return;
        setDetail(d);
        setDetailFailed(false);
      })
      .catch(() => {
        // Тихий fallback (lesson-16): остаются данные карточки (description),
        // ошибка не сыплется в консоль — секции просто покажутся пустыми
        if (stale) return;
        setDetail(null);
        setDetailFailed(true);
      });
    return () => {
      stale = true;
    };
  }, [open, internalMode, task]);

  /** Сохранение: POST для create, PATCH для edit; успех — onSaved + закрытие. */
  async function handleSave() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      if (internalMode === 'create') {
        await createTask(form);
      } else if (task) {
        await patchTask(task.id, form);
      }
      onSaved();
      handleOpenChange(false);
    } catch (err) {
      // Тихая обработка: ошибка видна пользователю внутри модалки
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка сохранения');
    } finally {
      setSubmitting(false);
    }
  }

  /** Архивирование (только edit): подтверждение + DELETE. */
  async function handleArchive() {
    if (!task || submitting) return;
    if (!window.confirm(`Архивировать задачу ${task.id}? Она уйдёт из backlog/tasks/ в completed/.`)) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await archiveTask(task.id);
      onSaved();
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка архивирования');
    } finally {
      setSubmitting(false);
    }
  }

  /**
   * Кнопка фазы по статусу (▶ Spec/📋 Plan/💻 Code/✅ Close) или
   * «Комментарий» (phase='comment'). Непустой комментарий → сервер пишет
   * его в задачу и подставляет в {{comment}} промпта (VL-172, AC2).
   * Ошибка (409 и др.) — текст в модалке, окно открыто: при 409 сервер
   * уже сохранил комментарий («Комментарий добавлен, но запуск не
   * удался: …» — семантика бота VL-60).
   */
  async function handlePhase(phase: string) {
    if (!task || submitting) return;
    if (phase === 'comment' && !commentText.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await triggerPhase(task.id, phase, { comment: commentText });
      onSaved();
      onTriggered?.(task.id);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка запуска фазы');
    } finally {
      setSubmitting(false);
    }
  }

  /** ▶ Взять в работу (VL-188): ручной переход Backlog → initial_status, без фазы. */
  async function handleStart() {
    if (!task || !task.startTo || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await patchTask(task.id, { status: task.startTo });
      onSaved();
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка смены статуса');
    } finally {
      setSubmitting(false);
    }
  }

  /** ✖ Reject (кнопка есть, когда переход reject есть в workflow, VL-144/VL-188): подтверждение + POST reject с комментарием. */
  async function handleReject() {
    if (!task || submitting) return;
    if (!window.confirm(`Отклонить задачу ${task.id}? Она уйдёт из backlog/tasks/ в completed/.`)) {
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await rejectTask(task.id, commentText);
      onSaved();
      onTriggered?.(task.id); // LLM-путь reject асинхронен — поллинг дособерёт доску
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка отклонения');
    } finally {
      setSubmitting(false);
    }
  }

  // Кнопки view-режима по workflow (VL-188): фазы из статуса приходят с API
  // (getAvailablePhases на сервере), reject рендерится отдельной кнопкой,
  // startTo — ручной переход «Взять в работу» (Backlog → initial_status)
  const phases = (task?.availablePhases ?? []).filter((p) => p !== 'reject');
  const showReject = (task?.availablePhases ?? []).includes('reject');
  // VL-195: подписи/эмодзи кнопок фаз из настроек (enrich GET /api/tasks/:id);
  // fallback на дефолтный хардкод/имя фазы — внутри phaseButtonLabel
  const phaseLabel = (p: string): string =>
    phaseButtonLabel(p, { labels: task?.phaseLabels, emojis: task?.phaseEmojis });
  const startTo = task?.startTo ?? null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[calc(100%-2rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          {internalMode === 'create' ? (
            <DialogTitle>Создать задачу</DialogTitle>
          ) : internalMode === 'edit' && task ? (
            <DialogTitle>Редактировать {task.id}</DialogTitle>
          ) : task ? (
            <>
              <DialogTitle>{task.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-mono text-xs">{task.id}</span>
                  <Badge variant="secondary">{task.status}</Badge>
                  <Badge variant={task.priority === 'High' ? 'destructive' : 'outline'}>
                    {task.priority}
                  </Badge>
                  {task.due_date ? <span className="text-muted-foreground">срок: {task.due_date}</span> : null}
                  {task.labels.map(label => (
                    <Badge key={label} variant="outline" className="rounded-md px-1.5 text-[11px]">
                      {label}
                    </Badge>
                  ))}
                </div>
              </DialogDescription>
            </>
          ) : null}
        </DialogHeader>

        {internalMode === 'view' && task ? (
          <TaskView
            task={task}
            detail={detail}
            detailLoading={detailLoading}
            commentText={commentText}
            onCommentChange={setCommentText}
          />
        ) : (
          <TaskForm
            data={form}
            onChange={setForm}
            statuses={statuses}
            submitting={submitting}
          />
        )}

        {error ? <p className="text-destructive text-sm">{error}</p> : null}

        <DialogFooter className="flex-wrap">
          {internalMode === 'view' && task ? (
            <>
              {startTo ? (
                <Button
                  disabled={submitting}
                  onClick={() => void handleStart()}
                  title={`Взять в работу: ${task.status} → ${startTo} (без фазы)`}
                >
                  ▶ Взять в работу
                </Button>
              ) : null}
              {phases.map((phase) => (
                <Button
                  key={phase}
                  disabled={submitting}
                  onClick={() => void handlePhase(phase)}
                  title={`Запустить фазу ${phase}${commentText.trim() ? ' с комментарием' : ''}`}
                >
                  {phaseLabel(phase)}
                </Button>
              ))}
              {showReject ? (
                <Button variant="outline" disabled={submitting} onClick={() => void handleReject()}>
                  {phaseLabel('reject')}
                </Button>
              ) : null}
              <Button
                variant="outline"
                disabled={submitting || !commentText.trim()}
                onClick={() => void handlePhase('comment')}
                title="Записать комментарий в задачу и запустить Фазу Comment"
              >
                💬 Комментарий
              </Button>
              {task ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setInternalMode('edit');
                  }}
                >
                  Редактировать
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => handleOpenChange(false)}>
                Закрыть
              </Button>
            </>
          ) : (
            <>
              {internalMode === 'edit' && task ? (
                <Button variant="destructive" disabled={submitting} onClick={() => void handleArchive()}>
                  Архивировать
                </Button>
              ) : null}
              {/* AC3 VL-172: Отмена — назад в просмотр без сохранения */}
              <Button
                variant="ghost"
                disabled={submitting}
                onClick={() => {
                  if (task) setForm(taskToForm(task));
                  setError(null);
                  setInternalMode('view');
                }}
              >
                Отмена
              </Button>
              <Button disabled={!canSubmit} onClick={() => void handleSave()}>
                {submitting ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
