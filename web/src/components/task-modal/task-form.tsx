/**
 * Общая форма задачи для модалки создания/редактирования (VL-163).
 *
 * Паттерн ref-14 (TaskFormContent.tsx из atomic-crm): переиспользуемое
 * содержимое формы, autoFocus первого поля, обязательный title,
 * парные поля в сетке grid-cols-1 md:grid-cols-2.
 *
 * Labels/Assignee вводятся текстом «через запятую» и хранятся в форме
 * массивами (split/trim здесь же — состояние формы всегда валидно).
 */

import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';

/** Данные формы задачи (подмножество полей Task для создания/правки). */
export interface TaskFormData {
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  labels: string[];
  assignee: string[];
}

/** Пустая форма для создания: статус — первый из списка, приоритет — Medium. */
export function emptyTaskForm(statuses: string[]): TaskFormData {
  return {
    title: '',
    description: '',
    status: statuses[0] ?? 'To Do',
    priority: 'Medium',
    due_date: '',
    labels: [],
    assignee: [],
  };
}

/** KanbanTask → данные формы (для edit-режима). */
export function taskToForm(task: {
  title: string;
  description: string;
  status: string;
  priority: string;
  due_date: string;
  labels: string[];
  assignee: string[];
}): TaskFormData {
  return {
    title: task.title,
    description: task.description,
    status: task.status,
    priority: task.priority,
    due_date: task.due_date,
    labels: [...task.labels],
    assignee: [...task.assignee],
  };
}

/** Массив → строка «через запятую» для текстового ввода. */
function listToText(list: string[]): string {
  return list.join(', ');
}

/** Текст «через запятую» → массив (split/trim/filter от пустых). */
function textToList(text: string): string[] {
  return text
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

const PRIORITIES = ['High', 'Medium', 'Low'] as const;

export function TaskForm({
  data,
  onChange,
  statuses,
  submitting,
}: {
  data: TaskFormData;
  onChange: (next: TaskFormData) => void;
  /** Статусы колонок из конфига проекта (columnOrder доски). */
  statuses: string[];
  /** Блокирует поля во время сабмита. */
  submitting: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="task-title">Заголовок *</Label>
        <Input
          id="task-title"
          value={data.title}
          onChange={e => onChange({ ...data, title: e.target.value })}
          placeholder="Краткое описание задачи"
          autoFocus
          disabled={submitting}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-description">Описание</Label>
        <Textarea
          id="task-description"
          value={data.description}
          onChange={e => onChange({ ...data, description: e.target.value })}
          placeholder="Подробности, ссылки, критерии…"
          rows={4}
          disabled={submitting}
        />
      </div>

      {/* Парные поля — сетка как в TaskFormContent из ref-14 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Статус</Label>
          <Select
            value={data.status}
            onValueChange={value => onChange({ ...data, status: value })}
            disabled={submitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {statuses.map(status => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Приоритет</Label>
          <Select
            value={data.priority}
            onValueChange={value => onChange({ ...data, priority: value })}
            disabled={submitting}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PRIORITIES.map(priority => (
                <SelectItem key={priority} value={priority}>
                  {priority}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-due-date">Срок</Label>
          <Input
            id="task-due-date"
            type="date"
            value={data.due_date}
            onChange={e => onChange({ ...data, due_date: e.target.value })}
            disabled={submitting}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="task-labels">Метки (через запятую)</Label>
          <Input
            id="task-labels"
            value={listToText(data.labels)}
            onChange={e => onChange({ ...data, labels: textToList(e.target.value) })}
            placeholder="bug, web"
            disabled={submitting}
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="task-assignee">Исполнители (через запятую)</Label>
        <Input
          id="task-assignee"
          value={listToText(data.assignee)}
          onChange={e => onChange({ ...data, assignee: textToList(e.target.value) })}
          placeholder="@alice, @bob"
          disabled={submitting}
        />
      </div>
    </div>
  );
}
