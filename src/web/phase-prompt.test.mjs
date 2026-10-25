/**
 * Тесты renderPrompt и шаблона close-worktree (VL-109, VL-112; чистка VL-130).
 *
 * Проверяются только СТРУКТУРНЫЕ свойства: подстановка {{taskId}}/{{branch}}/
 * {{worktreeDir}}, отсутствие неподставленных {{...}}, различие собранных
 * промптов close с опцией closeWorktree и без (сравнением промптов, а не по
 * конкретной фразе шаблона). Assert-ы на конкретные формулировки текста
 * шаблонов удалены (VL-130): правка любого текста templates/phases/*.md
 * не должна ломать тесты. Исключение — точечные инварианты VL-142 (правила
 * phase-2 «только целевой код» и «отчёт/статус после записи плана»):
 * добавлены осознанно по AC, не удалять при рефакторинге.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
import { DEFAULT_TASK_TYPES } from '../../dist/core/config.js';
import { createLessonFile } from '../../dist/core/lesson.js';

const templatesDir = fileURLToPath(new URL('../../templates/phases/', import.meta.url));

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
  taskReferences: '(нет)',
  taskTitle: 'Тестовая задача',
  taskType: 'task',
  taskStatus: 'Planned',
  // VL-188: статус после фазы — подстановка из workflow оркестратором/CLI
  producesStatus: 'Review',
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

// ── VL-144: фаза reject ──

describe('VL-144 — renderPrompt фазы reject', () => {
  it('reject: подстановки taskId/comment/полей задачи, без неподставленных {{...}}', () => {
    const prompt = renderPrompt('reject', 'VL-1', { ...TASK_VARS, comment: 'причина X' });
    assert.ok(prompt.includes('VL-1'), 'taskId подставлен');
    assert.ok(prompt.includes('причина X'), 'comment подставлен');
    assert.ok(prompt.includes(TASK_VARS.taskDescription), 'текст задачи подставлен');
    assert.ok(!prompt.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('reject: без {{comment}} в extraVars остаётся литерал (контракт VL-80)', () => {
    const prompt = renderPrompt('reject', 'VL-1', TASK_VARS);
    assert.ok(prompt.includes('{{comment}}'), 'литеральный {{comment}} сохраняется');
    assert.ok(prompt.includes('VL-1'), 'taskId подставлен');
  });
});

// ── VL-137: подстановка полей задачи в первый промпт фазы ──

describe('VL-137 — блок подстановки задачи в шаблонах', () => {
  const phaseTemplates = [
    'phase-spec.md',
    'phase-plan.md',
    'phase-code.md',
    'phase-close.md',
    'phase-close-worktree.md',
    'phase-comment.md',
    // VL-144: reject — откат начатых изменений для задач, бывших в Code
    'phase-reject.md',
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

  it('phase-plan и phase-code содержат {{taskReferences}} (VL-152: Plan читает, Code добавляет)', () => {
    for (const file of ['phase-plan.md', 'phase-code.md']) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('{{taskReferences}}'), `${file}: подстановка {{taskReferences}}`);
    }
  });

  it('фолбэк-инструкция «неподставленные {{...}} → прочитай через MCP» удалена (решение Pavel)', () => {
    for (const file of phaseTemplates) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(!text.includes('остались неподставленные'), `${file}: фолбэк-инструкции быть не должно`);
    }
  });

  it('phase-code и оба close-шаблона содержат правило пакетирования shell-команд', () => {
    for (const file of ['phase-code.md', 'phase-close.md', 'phase-close-worktree.md']) {
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

  it('taskExtraVars: задача читается → 14 подстановок с нумерованными AC и последним комментарием', () => {
    const root = makeRoot();
    try {
      const vars = taskExtraVars(root, 'VL-901');
      assert.ok(vars, 'vars должны подобраться');
      assert.equal(Object.keys(vars).length, 14, 'ровно 14 подстановок');
      assert.equal(vars.taskTitle, 'Заголовок VL-901');
      assert.equal(vars.taskType, 'task');
      assert.equal(vars.taskStatus, 'Planned');
      assert.equal(vars.taskDescription, 'Описание задачи');
      assert.equal(vars.taskPlan, 'Шаг 1: сделать');
      assert.ok(vars.taskAC.includes('1. [x] Первый критерий'), `taskAC: ${vars.taskAC}`);
      assert.ok(vars.taskDoD.includes('1. [ ] Пункт DoD'), `taskDoD: ${vars.taskDoD}`);
      assert.equal(vars.taskModifiedFiles, 'src/a.ts, docs/b.md');
      assert.equal(vars.taskReferences, '(нет)', 'references по умолчанию пустые');
      assert.equal(vars.taskLessons, '(нет)', 'lessons по умолчанию нет (нет tags/совпадений)');
      assert.equal(vars.availableLabels, '', 'конфиг без labels → пустая строка (VL-154)');
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

// VL-154: {{availableLabels}} — labels из backlog/config.yml для Spec-фазы
describe('VL-154 — availableLabels', () => {
  /** Мини-проект с config.yml; labelsIn — YAML-фрагмент labels или ''. */
  const makeRoot = (labelsIn) => {
    const root = mkdtempSync(join(tmpdir(), 'vl154-labels-'));
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), `project_name: VL-154\n${labelsIn}`, 'utf-8');
    createTaskFile(root, { id: 'VL-902', title: 'Задача VL-154', status: 'To Do' });
    return root;
  };

  it('config с labels → строка через запятую', () => {
    const root = makeRoot('labels:\n  - core\n  - mcp\n');
    try {
      const vars = taskExtraVars(root, 'VL-902');
      assert.ok(vars, 'vars подбираются');
      assert.equal(vars.availableLabels, 'core, mcp', 'labels из конфига через запятую');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('config без labels → пустая строка (fallback)', () => {
    const root = makeRoot('');
    try {
      assert.equal(taskExtraVars(root, 'VL-902').availableLabels, '', 'нет labels в конфиге → пусто');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('битый config.yml → пустая строка (fallback, фаза не падает)', () => {
    const root = makeRoot('labels: [oops\n  bad');
    try {
      assert.equal(taskExtraVars(root, 'VL-902').availableLabels, '', 'битый YAML → пусто, не исключение');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('шаблон phase-spec содержит {{availableLabels}}; renderPrompt без остатков', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    assert.ok(text.includes('{{availableLabels}}'), 'phase-spec.md: блок «Доступные labels»');
    const prompt = renderPrompt('spec', 'VL-902', { ...TASK_VARS, availableLabels: 'core, mcp' });
    assert.ok(prompt.includes('Доступные labels: core, mcp'), 'labels подставились в промпт');
    assert.ok(!prompt.includes('{{availableLabels}}'), 'неподставленного {{availableLabels}} не остаётся');
  });
});

// VL-184: {{availableTypes}}/{{availablePriorities}} — типы и приоритеты
// из backlog/config.yml для Spec-фазы
describe('VL-184 — availableTypes/availablePriorities', () => {
  /** Мини-проект; cfgIn — YAML-фрагмент конфига или ''. */
  const makeRoot = (cfgIn) => {
    const root = mkdtempSync(join(tmpdir(), 'vl184-types-'));
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), `project_name: VL-184\n${cfgIn}`, 'utf-8');
    createTaskFile(root, { id: 'VL-903', title: 'Задача VL-184', status: 'To Do' });
    return root;
  };

  it('config с types/priorities → значения через запятую', () => {
    const root = makeRoot('types:\n  - bug\n  - task\npriorities:\n  - P0\n  - P1\n');
    try {
      const vars = taskExtraVars(root, 'VL-903');
      assert.ok(vars, 'vars подбираются');
      assert.equal(vars.availableTypes, 'bug, task', 'types из конфига через запятую');
      assert.equal(vars.availablePriorities, 'P0, P1', 'priorities из конфига через запятую');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('config без types/priorities → дефолты DEFAULT_TASK_TYPES и High/Medium/Low', () => {
    const root = makeRoot('');
    try {
      const vars = taskExtraVars(root, 'VL-903');
      assert.equal(
        vars.availableTypes,
        DEFAULT_TASK_TYPES.join(', '),
        'нет types → дефолтный список (зеркало normalizeTaskType)'
      );
      assert.equal(vars.availablePriorities, 'High, Medium, Low', 'нет priorities → дефолт');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('битый config.yml → дефолты (fallback, фаза не падает)', () => {
    const root = makeRoot('types: [oops\n  bad');
    try {
      const vars = taskExtraVars(root, 'VL-903');
      assert.equal(vars.availableTypes, DEFAULT_TASK_TYPES.join(', '), 'битый YAML → дефолтные типы');
      assert.equal(vars.availablePriorities, 'High, Medium, Low', 'битый YAML → дефолтные приоритеты');
      assert.equal(vars.availableLabels, '', 'битый YAML → labels пусто (VL-154)');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('шаблон phase-spec содержит {{availableTypes}}/{{availablePriorities}}; renderPrompt без остатков', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    assert.ok(text.includes('{{availableTypes}}'), 'phase-spec.md: блок «Доступные типы»');
    assert.ok(text.includes('{{availablePriorities}}'), 'phase-spec.md: блок «Доступные приоритеты»');
    const prompt = renderPrompt('spec', 'VL-903', {
      ...TASK_VARS,
      availableTypes: 'bug, task',
      availablePriorities: 'High, Medium, Low',
    });
    assert.ok(prompt.includes('Доступные типы: bug, task'), 'типы подставились в промпт');
    assert.ok(prompt.includes('Доступные приоритеты: High, Medium, Low'), 'приоритеты подставились');
    assert.ok(!prompt.includes('{{availableTypes}}'), 'неподставленного {{availableTypes}} не остаётся');
    assert.ok(!prompt.includes('{{availablePriorities}}'), 'неподставленного {{availablePriorities}} не остаётся');
  });
});

// Точечные инварианты VL-142 (см. шапку): ассерты на конкретные формулировки
// здесь осознанно, по AC задачи — в отличие от общих, удалённых в VL-130.
describe('VL-142 — phase-2: экономия ходов', () => {
  const text = readFileSync(join(templatesDir, 'phase-plan.md'), 'utf-8');

  it('правило: для плана читать только целевой код', () => {
    assert.ok(text.includes('только целевой код'),
      'phase-plan.md: блок «Экономия ходов» должен запрещать чтение всего подряд');
    assert.ok(text.includes('CHANGELOG, README, тест-файлы'),
      'phase-plan.md: явный запрет на контекстный мусор');
  });

  it('правило: отчёт и статус сразу после записи плана', () => {
    assert.ok(text.includes('Сразу после записи Implementation Plan'),
      'phase-plan.md: после plan — обязательно шаги 5 и 6');
    assert.ok(text.includes('не завершай фазу раньше'),
      'phase-plan.md: финальный ответ только после отчёта и смены статуса');
  });
});

// ── VL-141: фаза analyze — headless-разбор сессии агента без задачи ──

describe('VL-141 — фаза analyze', () => {
  it('renderPrompt: подстановки сессии (+ comment VL-169), неподставленных {{...}} не остаётся', () => {
    const prompt = renderPrompt('analyze', '', {
      sessionId: 'agent-123',
      sessionPhase: 'code',
      sessionCwd: '/tmp/proj',
      sessionPath: '.vibelog/agent-sessions/agent-123.jsonl',
      // VL-169: startAnalyze подставляет comment всегда (пустая строка без комментария)
      comment: '',
    });
    assert.ok(prompt.includes('agent-123'), 'sessionId подставился');
    assert.ok(prompt.includes('.vibelog/agent-sessions/agent-123.jsonl'), 'путь к jsonl подставился');
    assert.ok(prompt.includes('Дополнительный комментарий пользователя к разбору:'), 'строка комментария в шаблоне (VL-169)');
    assert.ok(!prompt.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('VL-169: непустой comment подставляется в {{comment}}', () => {
    const prompt = renderPrompt('analyze', '', {
      sessionId: 'agent-123',
      sessionPhase: 'code',
      sessionCwd: '/tmp/proj',
      sessionPath: '.vibelog/agent-sessions/agent-123.jsonl',
      comment: 'сверь объём с AC',
    });
    assert.ok(prompt.includes('сверь объём с AC'), 'текст комментария подставился');
    assert.ok(!prompt.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('шаблон содержит детерминированный протокол и финал «Готово»', () => {
    const text = readFileSync(join(templatesDir, 'phase-analyze.md'), 'utf-8');
    // Протокол статистики jsonl (node-скрипт, без внешних рантаймов)
    assert.ok(text.includes('node'), 'phase-analyze.md: статистика — node-скриптом');
    assert.ok(!text.includes('python') || text.includes('ЗАПРЕТ'), 'внешние рантаймы запрещены');
    // Вердикт + рекомендации с проверкой существующих задач
    assert.ok(text.includes('вердикт'), 'phase-analyze.md: шаг вердикта');
    assert.ok(text.includes('backlog_search'), 'phase-analyze.md: проверка открытых задач');
    assert.ok(text.includes('НОВЫХ задач НЕ создавать'), 'phase-analyze.md: без создания задач');
    // Терминальный вывод — одно слово
    assert.ok(text.includes('«Готово»'), 'phase-analyze.md: финал — «Готово»');
  });
});

// ── VL-153: {{taskLessons}} — подстановка lessons по tags задачи ──

describe('VL-153 — taskLessons', () => {
  it('phase-plan.md содержит {{taskLessons}} и пояснение про workflow-уроки', () => {
    const text = readFileSync(join(templatesDir, 'phase-plan.md'), 'utf-8');
    assert.ok(text.includes('{{taskLessons}}'), 'phase-plan.md: подстановка {{taskLessons}}');
    assert.ok(text.includes('Lessons learned'), 'phase-plan.md: заголовок блока Lessons');
  });

  /** Мини-проект: backlog/tasks + config.yml + lesson с tags; задача с labels. */
  const makeRoot = (taskLabels) => {
    const root = mkdtempSync(join(tmpdir(), 'vl153-lessons-'));
    mkdirSync(join(root, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(root, 'backlog', 'config.yml'), 'project_name: VL-153\n', 'utf-8');
    createTaskFile(root, { id: 'VL-905', title: 'Задача VL-153', labels: taskLabels, status: 'Planned' });
    createLessonFile(root, {
      id: 'lesson-1', title: 'Тесты батчами по 10', status: 'active', tags: ['tests', 'ci'],
    });
    createLessonFile(root, {
      id: 'lesson-2', title: 'Чужой урок', status: 'active', tags: ['other'],
    });
    createLessonFile(root, {
      id: 'lesson-3', title: 'Устаревший по tests', status: 'outdated', tags: ['tests'],
    });
    return root;
  };

  it('задача с совпавшим tags → компактные строки "- [lesson-N] title"', () => {
    const root = makeRoot(['tests']);
    try {
      const vars = taskExtraVars(root, 'VL-905');
      assert.ok(vars, 'vars подбираются');
      assert.ok(vars.taskLessons.includes('- [lesson-1] Тесты батчами по 10'), `taskLessons: ${vars.taskLessons}`);
      assert.ok(!vars.taskLessons.includes('lesson-2'), 'чужой tags не подставляется');
      assert.ok(!vars.taskLessons.includes('lesson-3'), 'outdated не подставляется');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('нет совпадений по tags → "(нет)"; ошибки чтения не роняют фазу', () => {
    const root = makeRoot(['nomatch']);
    try {
      assert.equal(taskExtraVars(root, 'VL-905').taskLessons, '(нет)', 'нет совпадений → фолбэк');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── VL-170: close коммитит refs и lessons ──

describe('VL-170 — close коммитит refs и lessons', () => {
  // Инвариант по AC VL-170, добавлен осознанно — не удалять при рефакторинге (паттерн VL-142):
  // после фазы close refs/lessons не должны оставаться незакоммиченными.
  for (const file of ['phase-close.md', 'phase-close-worktree.md']) {
    it(`${file}: шаг коммита refs/lessons`, () => {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('refs и lessons'), `${file}: формулировка шага коммита`);
      assert.ok(text.includes('backlog/lessons'), `${file}: путь lessons`);
      assert.ok(text.includes('backlog/references'), `${file}: путь references`);
      assert.ok(text.includes('git status --porcelain'), `${file}: проверка статуса перед коммитом`);
      assert.ok(text.includes('git add <явные пути>'), `${file}: коммит только явными путями`);
      // «никогда git add -A» — запрет в правилах; как коммит-шаг использоваться не должен
      assert.ok(!text.replaceAll('никогда git add -A', '').includes('git add -A'), `${file}: git add -A только в запретах`);
    });
  }
});

// ── VL-157: переносимость промптов — без внутренних ID задач репозитория ──

describe('VL-157 — переносимость промптов', () => {
  it('в шаблонах промптов нет внутренних ID задач (VL-N, VL-XX)', () => {
    // Промпты уходят во ВНЕШНИЕ проекты — их ID задач там ничего не значат.
    // Regex: VL- в качестве отдельного токена (VL-12, VL-XX), но не Vibelog.
    const vlPattern = /\bVL-\d|\bVL-XX/i;
    const templatesRoot = fileURLToPath(new URL('../../templates/', import.meta.url));
    const dirs = [templatesRoot, join(templatesRoot, 'phases')];
    for (const dir of dirs) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const text = readFileSync(join(dir, file), 'utf-8');
        assert.ok(!vlPattern.test(text), `${file}: не должно быть внутренних ID задач VL-*`);
      }
    }
  });

  it('phase-spec.md: регистрация references из текста пользователя', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    assert.ok(text.includes('{{taskReferences}}'), 'блок задачи: подстановка {{taskReferences}}');
    assert.ok(text.includes('reference_add'), 'шаг 5.6: reference_add для упомянутых источников');
    assert.ok(text.includes('reference_link'), 'шаг 5.6: связь reference ↔ задача');
    assert.ok(text.includes('reference_search'), 'шаг 5.6: поиск существующих refs перед регистрацией');
    assert.ok(text.includes('reference_list'), 'шаг 5.6: reference_list как дополнительная проверка');
    assert.ok(text.includes('НЕ создавай дубликат'), 'шаг 5.6: запрет дубликата reference');
    assert.ok(text.includes('"references"'), 'шаг 5: поле references в backlog_update_task');
  });

  it('phase-spec.md: чтение явно упомянутой задачи разрешено (пункт 3 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    assert.ok(text.includes('явно ссылается'), 'исключение backlog_view_task при явной ссылке пользователя');
    assert.ok(text.includes('Дополнительный комментарий пользователя'), 'блок {{comment}} для ссылок пользователя');
  });

  it('phase-spec.md: ведущие #теги → labels (пункт 5 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    assert.ok(text.includes('#тег'), 'инструкция про #теги в начале заголовка/описания');
    assert.ok(text.includes('labels пользователя'), 'теги — это labels пользователя');
  });

  it('phase-spec.md: предложение нового label видно в чате после «Готово» (пункт 4 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');
    // Формат финала: «Готово» + строка предложения — бот пересылает финал как есть
    assert.ok(text.includes('Предлагаю добавить label'), 'строка предложения в «Формат финала»');
  });
});

// ── VL-188: переименование шаблонов, phase-do, переопределение проектом ──

describe('VL-188 — шаблоны фаз: имена и переопределение', () => {
  it('переименованные шаблоны существуют: phase-spec/plan/code/do/reject', () => {
    for (const file of [
      'phase-spec.md',
      'phase-plan.md',
      'phase-code.md',
      'phase-do.md',
      'phase-reject.md',
      'phase-close.md',
      'phase-close-worktree.md',
      'phase-comment.md',
      'phase-analyze.md',
      'prompt.md',
    ]) {
      assert.ok(
        readFileSync(join(templatesDir, file), 'utf-8').length > 0,
        `${file} существует в templates/phases/`
      );
    }
  });

  it('старых имён (phase-1/2/3.md, reject.md) в templates/phases/ нет', () => {
    const files = readdirSync(templatesDir);
    for (const old of ['phase-1.md', 'phase-2.md', 'phase-3.md', 'reject.md']) {
      assert.ok(!files.includes(old), `${old} удалён (переименован)`);
    }
  });

  it('renderPrompt: PHASES включает do; фаза do собирается без остатков {{...}}', () => {
    const prompt = renderPrompt('do', 'VL-1', { ...TASK_VARS, comment: '' });
    assert.ok(prompt.includes('VL-1'), 'taskId подставлен');
    assert.ok(prompt.includes('Review'), 'producesStatus подставлен');
    assert.ok(!prompt.includes('{{'), 'неподставленных подстановок не остаться');
  });

  it('phase-do.md использует {{producesStatus}} (без хардкода Review)', () => {
    const text = readFileSync(join(templatesDir, 'phase-do.md'), 'utf-8');
    assert.ok(text.includes('{{producesStatus}}'), 'producesStatus в finish_phase');
    assert.ok(!/"status": "Review"/.test(text), 'хардкод Review отсутствует');
  });

  it('workflow-шаблоны используют {{producesStatus}} вместо хардкода статусов', () => {
    for (const file of ['phase-spec.md', 'phase-plan.md', 'phase-code.md', 'phase-close.md']) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('{{producesStatus}}'), `${file}: подстановка producesStatus`);
    }
    // Хардкод целевых статусов в finish_phase отсутствует
    for (const [file, status] of [
      ['phase-spec.md', '"status": "Spec"'],
      ['phase-plan.md', '"status": "Planned"'],
      ['phase-code.md', '"status": "Review"'],
      ['phase-close.md', '"status": "Done"'],
    ]) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(!text.includes(status), `${file}: хардкод ${status} удалён`);
    }
  });

  it('неизвестная фаза → throw (loadPhaseTemplate)', () => {
    assert.throws(() => renderPrompt('nope', 'VL-1'), /Неизвестная фаза/);
  });

  it('переопределение проектом: .vibelog/prompts/phases/phase-plan.md приоритетнее встроенного', () => {
    const root = mkdtempSync(join(tmpdir(), 'vl188-override-'));
    try {
      const dir = join(root, '.vibelog', 'prompts', 'phases');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'phase-plan.md'), 'ПРОЕКТ-ПЛАН {{taskId}} {{producesStatus}}', 'utf-8');
      const prompt = renderPrompt('plan', 'VL-9', { ...TASK_VARS }, { cwd: root });
      assert.ok(prompt.startsWith('ПРОЕКТ-ПЛАН'), 'взят шаблон проекта');
      assert.ok(prompt.includes('VL-9'), 'подстановка taskId работает');
      assert.ok(prompt.includes('Review'), 'подстановка producesStatus работает');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('переопределение проектом: worktree-вариант phase-close-worktree.md из проекта', () => {
    const root = mkdtempSync(join(tmpdir(), 'vl188-override-wt-'));
    try {
      const dir = join(root, '.vibelog', 'prompts', 'phases');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'phase-close-worktree.md'), 'ПРОЕКТ-WT {{branch}}', 'utf-8');
      const prompt = renderPrompt(
        'close',
        'VL-9',
        { ...TASK_VARS, branch: 'vb/vl-9', worktreeDir: '.vibelog/worktrees/vl-9' },
        { closeWorktree: true, cwd: root }
      );
      assert.ok(prompt.startsWith('ПРОЕКТ-WT'), 'worktree-шаблон проекта приоритетен');
      assert.ok(prompt.includes('vb/vl-9'), '{{branch}} подставлен');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('без переопределения cwd → встроенный шаблон (fallback)', () => {
    const root = mkdtempSync(join(tmpdir(), 'vl188-nooverride-'));
    try {
      const prompt = renderPrompt('plan', 'VL-9', { ...TASK_VARS }, { cwd: root });
      assert.ok(!prompt.startsWith('ПРОЕКТ'), 'встроенный шаблон, проектного файла нет');
      assert.ok(prompt.includes('VL-9'), 'taskId подставлен');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

// ── VL-105 (перенесено из skills.test.mjs при очистке qwen-commands, VL-188): инварианты шаблонов ──
// ============================================================
// VL-105 — ревизия промптов: дубли устранены, дрейф закрыт
// ============================================================

describe('VL-105 — инварианты промптов', () => {
  const tmplDir = join(__dirname, '..', '..', 'templates', 'phases');
  const phaseFiles = [
    'phase-spec.md', 'phase-plan.md', 'phase-code.md', 'phase-close.md',
    'phase-comment.md', 'phase-do.md', 'prompt.md', 'phase-reject.md',
  ];

  it('В шаблонах фаз нет pnpm и «Только Node.js» — правила проекта в AGENTS.md', () => {
    for (const name of phaseFiles) {
      const content = readFileSync(join(tmplDir, name), 'utf-8');
      assert.ok(!/pnpm/i.test(content), name + ': pnpm-правила не должны дублироваться');
      assert.ok(!/только node\.js/i.test(content), name + ': запрет рантаймов не должен дублироваться');
    }
  });

  // Хрупкие проверки формулировок шаблонов («"status": "Review"», «Planned»,
  // «задай вопросы») удалены в VL-130 — это текст инструкций, а не контракт.
  // Оставлены негативные политические инварианты (дубли правил проекта
  // в шаблонах запрещены) и проверка исходников TS.

  it('BASE_PROMPT не дублирует AGENTS.md: нет русского языка и pnpm', () => {
    const content = readFileSync(join(__dirname, '..', '..', 'src', 'agent', 'system-prompt.ts'), 'utf-8');
    assert.ok(!content.includes('Отвечай на русском'), 'русский язык — в AGENTS.md проекта');
    assert.ok(!/pnpm/i.test(content), 'pnpm-правила — в AGENTS.md проекта');
  });
});

