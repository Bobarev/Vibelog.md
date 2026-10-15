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
import { createLessonFile } from '../../dist/core/lesson.js';

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
  taskReferences: '(нет)',
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
    'phase-1.md',
    'phase-2.md',
    'phase-3.md',
    'phase-close.md',
    'phase-close-worktree.md',
    'phase-comment.md',
    // VL-144: reject — откат начатых изменений для задач, бывших в Code
    'reject.md',
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

  it('phase-2 и phase-3 содержат {{taskReferences}} (VL-152: Plan читает, Code добавляет)', () => {
    for (const file of ['phase-2.md', 'phase-3.md']) {
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

  it('taskExtraVars: задача читается → 12 подстановок с нумерованными AC и последним комментарием', () => {
    const root = makeRoot();
    try {
      const vars = taskExtraVars(root, 'VL-901');
      assert.ok(vars, 'vars должны подобраться');
      assert.equal(Object.keys(vars).length, 12, 'ровно 12 подстановок');
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

  it('шаблон phase-1 содержит {{availableLabels}}; renderPrompt без остатков', () => {
    const text = readFileSync(join(templatesDir, 'phase-1.md'), 'utf-8');
    assert.ok(text.includes('{{availableLabels}}'), 'phase-1.md: блок «Доступные labels»');
    const prompt = renderPrompt('spec', 'VL-902', { ...TASK_VARS, availableLabels: 'core, mcp' });
    assert.ok(prompt.includes('Доступные labels: core, mcp'), 'labels подставились в промпт');
    assert.ok(!prompt.includes('{{availableLabels}}'), 'неподставленного {{availableLabels}} не остаётся');
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
  it('phase-2.md содержит {{taskLessons}} и пояснение про workflow-уроки', () => {
    const text = readFileSync(join(templatesDir, 'phase-2.md'), 'utf-8');
    assert.ok(text.includes('{{taskLessons}}'), 'phase-2.md: подстановка {{taskLessons}}');
    assert.ok(text.includes('Lessons learned'), 'phase-2.md: заголовок блока Lessons');
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

// ── VL-157: переносимость промптов — без внутренних ID задач репозитория ──

describe('VL-157 — переносимость промптов', () => {
  it('в шаблонах промптов нет внутренних ID задач (VL-N, VL-XX)', () => {
    // Промпты уходят во ВНЕШНИЕ проекты — их ID задач там ничего не значат.
    // Regex: VL- в качестве отдельного токена (VL-12, VL-XX), но не Vibelog.
    const vlPattern = /\bVL-\d|\bVL-XX/i;
    const templatesRoot = fileURLToPath(new URL('../../templates/', import.meta.url));
    const dirs = [templatesRoot, join(templatesRoot, 'qwen-commands')];
    for (const dir of dirs) {
      for (const file of readdirSync(dir)) {
        if (!file.endsWith('.md')) continue;
        const text = readFileSync(join(dir, file), 'utf-8');
        assert.ok(!vlPattern.test(text), `${file}: не должно быть внутренних ID задач VL-*`);
      }
    }
  });

  it('phase-1.md: регистрация references из текста пользователя', () => {
    const text = readFileSync(join(templatesDir, 'phase-1.md'), 'utf-8');
    assert.ok(text.includes('{{taskReferences}}'), 'блок задачи: подстановка {{taskReferences}}');
    assert.ok(text.includes('reference_add'), 'шаг 5.6: reference_add для упомянутых источников');
    assert.ok(text.includes('reference_link'), 'шаг 5.6: связь reference ↔ задача');
    assert.ok(text.includes('reference_search'), 'шаг 5.6: поиск существующих refs перед регистрацией');
    assert.ok(text.includes('reference_list'), 'шаг 5.6: reference_list как дополнительная проверка');
    assert.ok(text.includes('НЕ создавай дубликат'), 'шаг 5.6: запрет дубликата reference');
    assert.ok(text.includes('"references"'), 'шаг 5: поле references в backlog_update_task');
  });

  it('phase-1.md: чтение явно упомянутой задачи разрешено (пункт 3 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-1.md'), 'utf-8');
    assert.ok(text.includes('явно ссылается'), 'исключение backlog_view_task при явной ссылке пользователя');
    assert.ok(text.includes('Дополнительный комментарий пользователя'), 'блок {{comment}} для ссылок пользователя');
  });

  it('phase-1.md: ведущие #теги → labels (пункт 5 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-1.md'), 'utf-8');
    assert.ok(text.includes('#тег'), 'инструкция про #теги в начале заголовка/описания');
    assert.ok(text.includes('labels пользователя'), 'теги — это labels пользователя');
  });

  it('phase-1.md: предложение нового label видно в чате после «Готово» (пункт 4 ТЗ)', () => {
    const text = readFileSync(join(templatesDir, 'phase-1.md'), 'utf-8');
    // Формат финала: «Готово» + строка предложения — бот пересылает финал как есть
    assert.ok(text.includes('Предлагаю добавить label'), 'строка предложения в «Формат финала»');
  });
});
