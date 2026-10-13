/**
 * Тесты renderPrompt и шаблона close-worktree (VL-109, VL-112; чистка VL-130).
 *
 * Проверяются только СТРУКТУРНЫЕ свойства: подстановка {{taskId}}/{{branch}}/
 * {{worktreeDir}}, отсутствие неподставленных {{...}}, различие собранных
 * промптов close с опцией closeWorktree и без (сравнением промптов, а не по
 * конкретной фразе шаблона). Assert-ы на конкретные формулировки текста
 * шаблонов удалены (VL-130): правка любого текста templates/qwen-commands/*.md
 * не должна ломать тесты. Исключение — точечные инварианты VL-142 (правила
 * phase-2 «только целевой код» и «отчёт/статус после записи плана»):
 * добавлены осознанно по AC, не удалять при рефакторинге.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderPrompt,
  formatChecklist,
  taskExtraVars,
  taskBlockText,
} from '../../dist/web/phase-prompt.js';
import { addComment, createTaskFile } from '../../dist/core/store.js';

const templatesDir = fileURLToPath(new URL('../../templates/qwen-commands/', import.meta.url));

/**
 * Полный набор task-переменных (VL-137): renderPrompt подставляет только
 * переданные ключи — без них в промпте остаются литеральные {{task...}},
 * и проверки «неподставленных {{...}} нет» были бы ложными.
 */
const TASK_VARS = {
  taskDescription: '(нет)',
  taskPlan: '(нет)',
  taskAC: '(нет)',
  taskDoD: '(нет)',
  taskModifiedFiles: '(нет)',
  taskLastComment: '(нет комментариев)',
  taskTitle: 'Тестовая задача',
  taskType: 'task',
  taskStatus: 'Planned',
};

describe('renderPrompt — подстановка taskId (VL-109)', () => {
  it('taskId подставляется, неподставленных {{taskId}} не остаётся', () => {
    const prompt = renderPrompt('code', 'VL-109');
    assert.ok(prompt.includes('VL-109'), 'taskId должен подставиться');
    assert.ok(!prompt.includes('{{taskId}}'), 'неподставленный {{taskId}} не должен остаться');
    assert.ok(prompt.length > 0, 'промпт собран не пустой');
  });
});

describe('close в worktree — отдельный шаблон (VL-112)', () => {
  it('шаблон phase-close-worktree.md существует и содержит все подстановки', () => {
    const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');
    assert.ok(text.includes('{{taskId}}'), 'подстановка taskId в шаблоне');
    assert.ok(text.includes('{{branch}}'), 'подстановка branch в шаблоне');
    assert.ok(text.includes('{{worktreeDir}}'), 'подстановка worktreeDir в шаблоне');
  });

  it('renderPrompt({ closeWorktree: true }) использует другой шаблон, чем обычный close', () => {
    const vars = { ...TASK_VARS, branch: 'vb/vl-77', worktreeDir: '.vibelog/worktrees/vl-77' };
    const p = renderPrompt('close', 'VL-77', vars, { closeWorktree: true });
    const plain = renderPrompt('close', 'VL-77', vars);
    // Различие шаблонов проверяем сравнением собранных промптов,
    // а не по конкретной фразе worktree-шаблона (VL-130)
    assert.ok(p !== plain, 'closeWorktree-промпт должен отличаться от обычного close');
    assert.ok(p.includes('VL-77'), 'taskId подставлен');
    assert.ok(p.includes('vb/vl-77'), '{{branch}} подставлен');
    assert.ok(p.includes('.vibelog/worktrees/vl-77'), '{{worktreeDir}} подставлен');
    assert.ok(!p.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('обычный close без опции — прежний шаблон без подстановок worktree', () => {
    const p = renderPrompt('close', 'VL-77', TASK_VARS);
    assert.ok(p.includes('VL-77'), 'taskId подставлен');
    assert.ok(!p.includes('{{'), 'неподставленных подстановок не остаться');
  });
});

// ── VL-137: подстановка полей задачи в первый промпт фазы ──

describe('VL-137 — блок подстановки задачи в шаблонах', () => {
  const phaseTemplates = [
    'phase-1.md',
    'phase-2.md',
    'phase-3.md',
    'phase-close.md',
    'phase-close-worktree.md',
    'phase-comment.md',
  ];

  it('все шаблоны фаз содержат блок «Задача (подставлена автоматически)»', () => {
    for (const file of phaseTemplates) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('Задача (подставлена автоматически)'), `${file}: блок подстановки`);
      // Все 9 переменных (VL-137 + taskModifiedFiles из правки AC)
      for (const key of ['taskType', 'taskStatus', 'taskTitle', 'taskDescription', 'taskPlan', 'taskAC', 'taskDoD', 'taskModifiedFiles', 'taskLastComment']) {
        assert.ok(text.includes(`{{${key}}}`), `${file}: подстановка {{${key}}}`);
      }
    }
  });

  it('фолбэк-инструкция «неподставленные {{...}} → прочитай через MCP» удалена (решение Pavel)', () => {
    for (const file of phaseTemplates) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(!text.includes('остались неподставленные'), `${file}: фолбэк-инструкции быть не должно`);
    }
  });

  it('phase-3 и оба close-шаблона содержат правило пакетирования shell-команд', () => {
    for (const file of ['phase-3.md', 'phase-close.md', 'phase-close-worktree.md']) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('Пакетируй последовательные git/shell-команды'), `${file}: правило пакетирования`);
      assert.ok(text.includes(' через && '), `${file}: объединение команд через &&`);
    }
  });
});

describe('VL-137 — taskExtraVars/taskBlockText', () => {
  /** Мини-проект: backlog/tasks + config.yml, задача VL-901 с AC/DoD/комментарием. */
  const makeRoot = () => {
    const root = mkdtempSync(join(tmpdir(), 'vl137-vars-'));
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-137 Vars\n', 'utf-8');
    createTaskFile(root, {
      id: 'VL-901',
      title: 'Заголовок VL-901',
      description: 'Описание задачи',
      type: 'task',
      status: 'Planned',
      acceptanceCriteria: [{ text: 'Первый критерий', checked: true }],
      definitionOfDone: [{ text: 'Пункт DoD', checked: false }],
      implementationPlan: 'Шаг 1: сделать',
      modified_files: ['src/a.ts', 'docs/b.md'],
    });
    addComment(root, 'VL-901', 'Текст последнего комментария', '@user');
    return root;
  };

  it('taskExtraVars: задача читается → 9 ключей с нумерованными AC и последним комментарием', () => {
    const root = makeRoot();
    try {
      const vars = taskExtraVars(root, 'VL-901');
      assert.ok(vars, 'vars должны подобраться');
      assert.equal(Object.keys(vars).length, 9, 'ровно 9 подстановок');
      assert.equal(vars.taskTitle, 'Заголовок VL-901');
      assert.equal(vars.taskType, 'task');
      assert.equal(vars.taskStatus, 'Planned');
      assert.equal(vars.taskDescription, 'Описание задачи');
      assert.equal(vars.taskPlan, 'Шаг 1: сделать');
      assert.ok(vars.taskAC.includes('1. [x] Первый критерий'), `taskAC: ${vars.taskAC}`);
      assert.ok(vars.taskDoD.includes('1. [ ] Пункт DoD'), `taskDoD: ${vars.taskDoD}`);
      assert.equal(vars.taskModifiedFiles, 'src/a.ts, docs/b.md');
      assert.ok(vars.taskLastComment.includes('Текст последнего комментария'), `taskLastComment: ${vars.taskLastComment}`);
      assert.ok(vars.taskLastComment.includes('@user'), 'автор комментария в подстановке');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('taskExtraVars: несуществующая задача и каталог без backlog → null (фаза не запускается)', () => {
    const root = makeRoot();
    const empty = mkdtempSync(join(tmpdir(), 'vl137-empty-'));
    try {
      assert.equal(taskExtraVars(root, 'VL-999'), null, 'несуществующая задача → null');
      assert.equal(taskExtraVars(empty, 'VL-901'), null, 'нет backlog → null');
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('formatChecklist: строки-форматы нумеруются как есть, пустой список → «(нет)»', () => {
    assert.equal(formatChecklist([]), '(нет)');
    assert.equal(formatChecklist(undefined), '(нет)');
    assert.equal(formatChecklist(['- [ ] #1 Готовый формат']), '1. - [ ] #1 Готовый формат');
  });

  it('taskBlockText: компактный блок для resume; без задачи → пустая строка', () => {
    const root = makeRoot();
    try {
      const block = taskBlockText(root, 'VL-901');
      assert.ok(block.includes('VL-901'), 'ID в блоке');
      assert.ok(block.includes('Заголовок VL-901'), 'заголовок в блоке');
      assert.ok(block.includes('статус: Planned'), 'статус в блоке');
      assert.ok(block.includes('Последний комментарий:'), 'последний комментарий в блоке');
      assert.equal(taskBlockText(root, 'VL-999'), '', 'нет задачи → пустой блок');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// Точечные инварианты VL-142 (см. шапку): ассерты на конкретные формулировки
// здесь осознанно, по AC задачи — в отличие от общих, удалённых в VL-130.
describe('VL-142 — phase-2: экономия ходов', () => {
  const text = readFileSync(join(templatesDir, 'phase-2.md'), 'utf-8');

  it('правило: для плана читать только целевой код', () => {
    assert.ok(text.includes('только целевой код'),
      'phase-2.md: блок «Экономия ходов» должен запрещать чтение всего подряд');
    assert.ok(text.includes('CHANGELOG, README, тест-файлы'),
      'phase-2.md: явный запрет на контекстный мусор');
  });

  it('правило: отчёт и статус сразу после записи плана', () => {
    assert.ok(text.includes('Сразу после записи Implementation Plan'),
      'phase-2.md: после plan — обязательно шаги 5 и 6');
    assert.ok(text.includes('не завершай фазу раньше'),
      'phase-2.md: финальный ответ только после отчёта и смены статуса');
  });
});
