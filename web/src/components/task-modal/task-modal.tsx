/**
 * Модальное окно задачи: просмотр/создание/редактирование (VL-163).
 *
 * Управляемый компонент (open/onOpenChange, как Sheet в ref-14:
 * TaskCreateSheet/TaskEditSheet), один примитив + режимы внутри —
 * паттерн ref-3 (vibe-kanban: Dialog.tsx + специализированные диалоги).
 *
 * Весь изменяемый state живёт в TaskModalBody — mount-only компоненте
 * внутри DialogContent. Radix без forceMount размонтирует контент при
 * закрытии, поэтому при каждом открытии форма инициализируется заново —
 * без эффектов синхронизации setState-in-effect (правило eslint
 * react-hooks v7).
 *
 * Режимы:
 * - view: мета-строка (id, статус, приоритет, срок, метки) + описание,
 *   кнопки «Редактировать»/«Закрыть»;
 * - create/edit: общая форма (TaskForm), Save/Cancel; в edit дополнительно
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
import { Separator } from '@/components/ui/separator';
import { archiveTask, createTask, patchTask } from '@/components/kanban/api';
import type { KanbanTask } from '@/types/kanban';

import { TaskForm, emptyTaskForm, taskToForm, type TaskFormData } from './task-form';

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
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* key — страховка: новое тело при смене mode/задачи без закрытия */}
      <TaskModalBody
        key={`${shared.mode}:${shared.task?.id ?? 'new'}`}
        onOpenChange={onOpenChange}
        {...shared}
      />
    </Dialog>
  );
}

/**
 * Mount-only тело модалки: state инициализируется из пропсов при рендере,
 * сбрасывается «бесплатно» размонтированием при закрытии окна.
 */
function TaskModalBody({
  onOpenChange,
  mode,
  task,
  statuses,
  onSaved,
}: TaskModalSharedProps & {
  onOpenChange: (open: boolean) => void;
}) {
  // Внутренний режим: view → edit переключается кнопкой «Редактировать»
  const [internalMode, setInternalMode] = React.useState<TaskModalMode>(mode);
  const [form, setForm] = React.useState<TaskFormData>(() =>
    mode !== 'create' && task ? taskToForm(task) : emptyTaskForm(statuses),
  );
  const [submitting, setSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const canSubmit = form.title.trim().length > 0 && !submitting;

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
      onOpenChange(false);
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
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Неизвестная ошибка архивирования');
    } finally {
      setSubmitting(false);
    }
  }

  return (
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
        <div className="space-y-4 text-sm">
          <Separator />
          {task.description ? (
            <p className="text-foreground text-sm leading-6 whitespace-pre-wrap">{task.description}</p>
          ) : (
            <p className="text-muted-foreground text-sm">Описание отсутствует.</p>
          )}
          {task.assignee.length > 0 ? (
            <p className="text-muted-foreground text-sm">Исполнители: {task.assignee.join(', ')}</p>
          ) : null}
        </div>
      ) : (
        <TaskForm
          data={form}
          onChange={setForm}
          statuses={statuses}
          submitting={submitting}
        />
      )}

      {error ? <p className="text-destructive text-sm">{error}</p> : null}

      <DialogFooter>
        {internalMode === 'view' ? (
          <>
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
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
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
            <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
              Отмена
            </Button>
            <Button disabled={!canSubmit} onClick={() => void handleSave()}>
              {submitting ? 'Сохранение…' : 'Сохранить'}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  );
}
