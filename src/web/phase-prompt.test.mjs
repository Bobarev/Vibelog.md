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
 * добавлены осознанно по AC, не удалять при рефакторинге. Так же осознанно
 * добавлены инварианты VL-202 (пакетное чтение), VL-222 (один поисковый проход),
 * VL-227 (отчёт об исключённых тест-файлах при --exclude/--skip: правило
 * живёт в templates/phases/phase-code.md и AGENTS.md — менять их надо синхронно)
 * и VL-242 (полный прогон в фазе Close: обязательный, но один — после раннего
 * точечного фильтра и с классификацией падений; правило в обоих close-шаблонах
 * и AGENTS.md), VL-247 (аварийные ветки close-шаблонов оформляют провал явным
 * сигналом `aborted: true` + «не завершай цикл как успех» и запрещают продолжать
 * прерванную фазу по пользовательскому сообщению без нового рана; правило в
 * обоих close-шаблонах).
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  renderPrompt,
  PHASES,
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

  it('VL-307: фолбэк-строка про неподставленный {{comment}} удалена из 6 шаблонов', () => {
    // {{comment}} подставляется всегда («без комментария» при отсутствии) —
    // фолбэк-строка не нужна и только дублировала текст комментария
    for (const file of [
      'phase-spec.md',
      'phase-plan.md',
      'phase-code.md',
      'phase-do.md',
      'phase-investigate.md',
      'phase-materialize.md',
    ]) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(!text.includes('остался неподставленный'), `${file}: фолбэк-строки быть не должно`);
      assert.ok(text.includes('{{comment}}'), `${file}: подстановка {{comment}} остаётся`);
    }
  });

  it('VL-307: comment/reject — фолбэк на сравнение с «без комментария», не на литерал', () => {
    const comment = readFileSync(join(templatesDir, 'phase-comment.md'), 'utf-8');
    assert.ok(comment.includes('«без комментария»'), 'phase-comment: фолбэк по строке-заглушке');
    assert.ok(!comment.includes('если {{comment}} не подставлено'), 'phase-comment: проверки литерала нет');
    const reject = readFileSync(join(templatesDir, 'phase-reject.md'), 'utf-8');
    assert.ok(reject.includes('«без комментария»'), 'phase-reject: фолбэк по строке-заглушке');
    assert.ok(!reject.includes('Если {{comment}} не подставлено'), 'phase-reject: проверки литерала нет');
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

// Точечные инварианты VL-202 (паттерн VL-142, по AC задачи): правило
// пакетного чтения файлов в шаблонах фаз — один read_file с чанками
// offset/limit вместо промежуточных grep-выборок границ.
describe('VL-202 — пакетное чтение файлов', () => {
  const phaseFiles = ['phase-plan.md', 'phase-code.md', 'phase-do.md', 'phase-investigate.md'];

  it('правило есть во всех шаблонах фаз, читающих целевой код', () => {
    for (const file of phaseFiles) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('одним read_file'), `${file}: правило «одним read_file»`);
      assert.ok(text.includes('offset/limit'), `${file}: чанки offset/limit при >200 строк`);
    }
  });

  it('phase-do: старая формулировка «фрагментами (sed/grep)» удалена', () => {
    const text = readFileSync(join(templatesDir, 'phase-do.md'), 'utf-8');
    assert.ok(!text.includes('фрагментами (sed/grep)'),
      'phase-do.md: лимит >200 строк переформулирован на read_file');
  });

  it('phase-plan: шаг 2 ведёт к read_file после grep/glob-поиска', () => {
    const text = readFileSync(join(templatesDir, 'phase-plan.md'), 'utf-8');
    assert.ok(text.includes('grep/glob — найти нужный файл'),
      'phase-plan.md: шаг 2 — сначала grep/glob, затем read_file');
    assert.ok(text.includes('без промежуточного grep-поиска границ'),
      'phase-plan.md: явный запрет промежуточного поиска границ');
  });
});

// Точечные инварианты VL-222 (паттерн VL-202/VL-142): запрет повторных
// mass-glob/grep с теми же паттернами в промптах фаз.
describe('VL-222 — запрет повторных mass-glob/grep', () => {
  const phaseFiles = ['phase-plan.md', 'phase-code.md', 'phase-do.md', 'phase-investigate.md'];

  it('правило есть во всех шаблонах фаз, выполняющих поиск', () => {
    for (const file of phaseFiles) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(/повторн\w*\s+(массов\w*|перебор\w*|mass-?(glob|grep))|тех же (glob|grep|паттерн)|теми же паттерн|один целевой|одним? целевым/i.test(text),
        `${file}: запрет повторных glob/grep-переборов`);
    }
  });

  it('agent-prompt.md содержит правило одного поискового прохода', () => {
    const agentPromptPath = fileURLToPath(new URL('../../templates/agent-prompt.md', import.meta.url));
    const text = readFileSync(agentPromptPath, 'utf-8');
    assert.ok(text.includes('один целевой проход') || text.includes('одним целевым'),
      'agent-prompt.md: правило одного целевого прохода поиска');
    assert.ok(text.includes('не переоткрывай') || text.includes('не переоткрывать'),
      'agent-prompt.md: запрет переоткрытия найденного при resume');
  });

  it('phase-plan: правило против повторных переборов в «Экономии ходов»', () => {
    const text = readFileSync(join(templatesDir, 'phase-plan.md'), 'utf-8');
    assert.ok(text.includes('повторные массовые переборы') || text.includes('теми же паттерн'),
      'phase-plan.md: явный запрет повторных mass-переборов');
    assert.ok(text.includes('не переоткрывай') || text.includes('не переоткрывать'),
      'phase-plan.md: правило resume — уже найденное не переоткрывать');
  });
});

// Точечные инварианты VL-227 (паттерн VL-142/VL-202, по AC задачи): правило
// обязательного отчёта об исключённых тест-файлах. Живёт в двух местах —
// templates/phases/phase-code.md и AGENTS.md; при правке текста менять оба.
describe('VL-227 — отчёт об исключённых тест-файлах при --exclude', () => {
  const codeText = readFileSync(join(templatesDir, 'phase-code.md'), 'utf-8');

  it('phase-code.md: прогон с --exclude требует перечисления исключённых файлов', () => {
    assert.ok(codeText.includes('--exclude'), 'phase-code.md: упомянут флаг --exclude');
    assert.ok(codeText.includes('исключённых'), 'phase-code.md: требование перечислить исключённые тест-файлы');
  });

  it('phase-code.md: DoD «Тесты проходят» без полного прогона не отмечается', () => {
    assert.ok(codeText.includes('полного прогона'),
      'phase-code.md: запрет отметки DoD без полного прогона');
    assert.ok(codeText.includes('Тесты проходят'),
      'phase-code.md: правило привязано к пункту DoD «Тесты проходят»');
  });

  it('AGENTS.md: буллет «Полный прогон перед DoD» с упоминанием --exclude', () => {
    const agentsPath = fileURLToPath(new URL('../../AGENTS.md', import.meta.url));
    const text = readFileSync(agentsPath, 'utf-8');
    assert.ok(text.includes('Полный прогон перед DoD'),
      'AGENTS.md: буллет про обязательный полный прогон перед DoD');
    assert.ok(text.includes('--exclude'),
      'AGENTS.md: явное упоминание частичного прогона с --exclude/--skip');
    assert.ok(text.includes('Тесты проходят'),
      'AGENTS.md: правило привязано к DoD «Тесты проходят»');
  });
});

// VL-284: Close не правит код и не собирает дважды — инцидент close VL-280
// (цикл `edit tools.ts` + `pnpm build`, payload 508 КБ, 5 попыток без прогресса).
// Маркеры короткие и стабильные (lesson-130: не матчить целые абзацы).
describe('VL-284 — Close не правит код и собирает не больше одного раза', () => {
  const closeText = readFileSync(join(templatesDir, 'phase-close.md'), 'utf-8');
  const wtText = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');

  it('оба close-шаблона содержат запрет правки кода', () => {
    for (const [name, text] of [['phase-close.md', closeText], ['phase-close-worktree.md', wtText]]) {
      assert.ok(text.includes('Close не правит код'), `${name}: маркер запрета правки кода`);
      assert.ok(text.includes('aborted'), `${name}: падение сборки → аварийный итог`);
    }
  });

  it('оба close-шаблона ограничивают сборку одним запуском', () => {
    for (const [name, text] of [['phase-close.md', closeText], ['phase-close-worktree.md', wtText]]) {
      assert.ok(text.includes('не более одного раза за фазу'),
        `${name}: маркер «pnpm build — не более одного раза за фазу»`);
    }
  });
});

// Точечные инварианты VL-242 (паттерн VL-227): в фазе Close полный прогон
// тестов остаётся обязательным, но он один — перед ним ранний точечный фильтр,
// а повтор допускается только после классификации падений. Правило живёт в
// двух шаблонах Close (обычный и worktree — реальный Close идёт по worktree)
// и в AGENTS.md; при правке текста менять всё синхронно.
describe('VL-242 — полный прогон в фазе Close: один, после раннего фильтра', () => {
  const closeText = readFileSync(join(templatesDir, 'phase-close.md'), 'utf-8');
  const wtText = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');

  it('phase-close.md: обязательный полный прогон + ранний точечный фильтр', () => {
    assert.ok(closeText.includes('Полный прогон тестов обязателен'),
      'phase-close.md: полный прогон остаётся обязательным');
    assert.ok(closeText.includes('точечный'),
      'phase-close.md: ранний точечный фильтр перед полным прогоном');
    assert.ok(closeText.includes('*.test.mjs'),
      'phase-close.md: мэппинг модуль → соседний *.test.mjs');
    assert.ok(closeText.includes('весь каталог модуля'),
      'phase-close.md: фолбэк на весь каталог при отсутствии теста');
  });

  it('phase-close.md: запрет повторных полных прогонов с классификацией падений', () => {
    assert.ok(/повторн[а-яё]* полн[а-яё]* прогон[а-яё]* запрещен/i.test(closeText),
      'phase-close.md: явный запрет повторных полных прогонов');
    assert.ok(closeText.includes('классификация'),
      'phase-close.md: порядок диагностики при падении — сначала классификация');
    assert.ok(closeText.includes('HEAD^1'),
      'phase-close.md: сравнение с родительским коммитом');
    assert.ok(closeText.includes('vitest'),
      'phase-close.md: проверка параллельного vitest в другом worktree');
  });

  it('phase-close.md: оговорка про интеграционные и инвариант-тесты', () => {
    assert.ok(closeText.includes('интеграционные'),
      'phase-close.md: оговорка про интеграционные наборы');
    assert.ok(closeText.includes('phase-prompt'),
      'phase-close.md: упомянуты инвариант-тесты, читающие templates/AGENTS.md');
  });

  it('phase-close.md: исключение из полного прогона для чистых docs/backlog-правок', () => {
    assert.ok(closeText.includes('vitest.config.mts'),
      'phase-close.md: перечислены критичные пути в условии пропуска');
    assert.ok(closeText.includes('templates/'),
      'phase-close.md: templates/ входит в условие пропуска');
    assert.ok(closeText.includes('пропуск'),
      'phase-close.md: пропуск полного прогона фиксируется с причиной');
  });

  it('phase-close.md: правило отражено в «Экономия ходов» (без pnpm — инвариант VL-105)', () => {
    assert.ok(closeText.includes('Полный прогон тестов — один раз'),
      'phase-close.md: буллет в «Экономия ходов»');
    assert.ok(!/pnpm/i.test(closeText),
      'phase-close.md: pnpm-команды не дублируются (VL-105)');
  });

  it('phase-close-worktree.md: то же правило в шаге 5 и «Правилах»', () => {
    assert.ok(wtText.includes('Полный прогон тестов обязателен'),
      'phase-close-worktree.md: полный прогон обязателен');
    assert.ok(wtText.includes('точечный'),
      'phase-close-worktree.md: ранний точечный фильтр');
    assert.ok(/повторн[а-яё]* полн[а-яё]* прогон[а-яё]* запрещен/i.test(wtText),
      'phase-close-worktree.md: запрет повторных полных прогонов');
    assert.ok(wtText.includes('классификация'),
      'phase-close-worktree.md: порядок диагностики при падении');
  });

  it('AGENTS.md: требование VL-227 относится к Code и не отменяется в Close', () => {
    const agentsPath = fileURLToPath(new URL('../../AGENTS.md', import.meta.url));
    const text = readFileSync(agentsPath, 'utf-8');
    assert.ok(text.includes('не отменяется') && text.includes('в фазе Close'),
      'AGENTS.md: полнота прогона не отменяется в Close');
    assert.ok(text.includes('HEAD^1'),
      'AGENTS.md: классификация падений через родительский коммит');
  });
});

// ── VL-247: аварийные ветки close — явный сигнал провала ──
// Точечные инварианты VL-247 (паттерн VL-242/VL-227, по AC задачи): аварийные
// ветки обоих close-шаблонов оформляют провал фазы единым явным сигналом
// `backlog_finish_phase {id, comment, aborted: true}` (механизм VL-244,
// описан в doc-18). Удаление сигнала или формулировок «не завершай цикл как
// успех» / «без нового рана» из любого из шаблонов должно ронять тест.
describe('VL-247 — явный сигнал провала в аварийных ветках close', () => {
  const files = ['phase-close.md', 'phase-close-worktree.md'];

  it('оба close-шаблона: сигнал `aborted: true`, «не завершай цикл как успех» и запрет без нового рана', () => {
    for (const file of files) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('"aborted": true'),
        `${file}: явный сигнал провала backlog_finish_phase aborted: true`);
      assert.ok(text.includes('не завершай цикл как успех'),
        `${file}: отказ считать аварийный итог успехом`);
      assert.ok(text.includes('без нового рана'),
        `${file}: запрет продолжать прерванную фазу по сообщению пользователя`);
    }
  });

  it('phase-close-worktree.md: сигнал есть в обеих аварийных ветках (конфликт merge и сборка/тесты)', () => {
    const text = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');
    const signalCount = (text.match(/"aborted": true/g) ?? []).length;
    assert.ok(signalCount >= 2,
      'phase-close-worktree.md: aborted: true и в шаге 4 (конфликт merge), и в шаге 5 (сборка/тесты)');
  });

  it('phase-close.md: сигнал есть и в шаге проверки кода, и в шаге отчёта', () => {
    const text = readFileSync(join(templatesDir, 'phase-close.md'), 'utf-8');
    const signalCount = (text.match(/"aborted": true/g) ?? []).length;
    assert.ok(signalCount >= 2,
      'phase-close.md: aborted: true и в шаге 3.5 (сборка/тесты), и в шаге 5 (отчёт)');
  });

  it('формулировка о прерванной фазе согласована между шаблонами', () => {
    const [a, b] = files.map((file) => readFileSync(join(templatesDir, file), 'utf-8'));
    const lineOf = (text) => text.split('\n').find((l) => l.includes('Не завершай цикл как успех'));
    assert.ok(lineOf(a) && lineOf(b), 'оба шаблона: буллет «Аварийный итог» с формулой');
    assert.equal(lineOf(a), lineOf(b),
      'phase-close.md и phase-close-worktree.md: текст формулы аварийного итога дословно совпадает');
  });
});

// ── VL-277: файл задачи коммитит framework после записи token_usage ──
// Инвариант по templates/: пока фаза close коммитила файл задачи сама,
// token_usage (пишется пост-раном) оставался единственной грязной правкой
// после каждого закрытия. Правило живёт в ДВУХ шаблонах close — удаление
// запрета или возврат `git commit` файла {{taskId}} в шаг коммита роняет тест.
describe('VL-277 — файл задачи коммитит framework после записи token_usage', () => {
  const closeText = readFileSync(join(templatesDir, 'phase-close.md'), 'utf-8');
  const wtText = readFileSync(join(templatesDir, 'phase-close-worktree.md'), 'utf-8');

  it('оба close-шаблона: файл задачи {{taskId}} не коммитится агентом', () => {
    for (const [file, text] of [['phase-close.md', closeText], ['phase-close-worktree.md', wtText]]) {
      assert.ok(text.includes('его коммитит framework'),
        `${file}: явное указание, что файл задачи коммитит framework`);
      assert.ok(text.includes('token_usage'),
        `${file}: причина — token_usage пишется пост-раном`);
      // Старый шаг «git add <файл задачи> + git commit docs(task) — закрытие задачи» удалён
      assert.ok(!text.includes('git add backlog/tasks/{{taskId}}*.md'),
        `${file}: git add файла задачи агентом удалён`);
      assert.ok(!text.includes('git commit -m "docs(task): {{taskId}} — закрытие задачи (Done)"'),
        `${file}: агент больше не создаёт docs(task)-коммит файла задачи`);
    }
  });

  it('phase-close.md: шаг 6 коммитит только подзадачи, шаг 6.6 не трогает файл задачи', () => {
    assert.ok(closeText.includes('Файл ОСНОВНОЙ задачи {{taskId}} здесь НЕ коммить'),
      'phase-close.md: шаг 6 явно исключает файл основной задачи');
    assert.ok(!closeText.includes('ls backlog/tasks/{{taskId}}*'),
      'phase-close.md: ls файла основной задачи для git add больше не нужен');
    assert.ok(closeText.includes('ls backlog/tasks/<ID-дочерней-задачи>*'),
      'phase-close.md: подзадачи по-прежнему коммитятся по явному пути');
    assert.ok(closeText.includes('файл задачи (его `lessons`, статус, комментарий) в этот коммит НЕ добавляй')
      || closeText.includes('его коммитит framework после записи token_usage'),
      'phase-close.md: шаг 6.6 не добавляет файл задачи в коммит refs/lessons');
  });

  it('phase-close-worktree.md: шаг 10 не коммитит файл задачи в главном репо', () => {
    assert.ok(wtText.includes('Файл задачи {{taskId}} в главном репо здесь НЕ коммить'),
      'phase-close-worktree.md: шаг 10 исключает файл задачи');
    assert.ok(!wtText.includes('Коммит вида: docs(task): {{taskId}} — закрытие задачи (Done)'),
      'phase-close-worktree.md: старый коммит файла задачи удалён');
    assert.ok(wtText.includes('файлы ПОДЗАДАЧ'),
      'phase-close-worktree.md: остаётся коммит файлов подзадач');
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
      // VL-229 (AC3): startAnalyze подставляет топ повторов всегда
      repeatSummary: 'tool-вызовов всего 10, из них повторных 3 (30%)',
      repeatTop: '1. grep_search|foo — 4 обращений',
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
      repeatSummary: 'нет данных',
      repeatTop: '(нет данных)',
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
    // VL-229 (AC3): блок автоматических повторов + требование назвать топ в вердикте
    assert.ok(text.includes('{{repeatSummary}}'), 'phase-analyze.md: сводка повторов (VL-229)');
    assert.ok(text.includes('{{repeatTop}}'), 'phase-analyze.md: топ повторов (VL-229)');
    assert.ok(
      text.includes('долей повторных вызовов от всех tool-вызовов сессии'),
      'phase-analyze.md: доля повторов от всех tool-вызовов (AC1)'
    );
    assert.ok(
      text.includes('топ перечитываемых файлов и топ повторяющихся'),
      'phase-analyze.md: вердикт называет топ перечитываемых файлов и запросов (AC3)'
    );
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

// ── VL-292: один write-вызов в Spec (инварианты осознанно, не удалять при рефакторинге) ──
//
// Инцидент VL-291: модель дробила backlog_update_task на серию частичных вызовов
// (type → priority+type → labels+type → type → type…) и попадала под loop detection
// агента → фаза падала, AC оставались пустыми. Чинится ПРОМПТОМ (не детектором),
// поэтому инварианты проверяют именно текст шаблона: директива «одно поле — не повод
// для отдельного вызова», правило чтения `applied`/`skipped` и критерий завершения шага.
// Формулировки в шаблоне менять можно, но эти подстроки сохранять обязательно.

describe('VL-292 — один write-вызов в Spec', () => {
  const specText = () => readFileSync(join(templatesDir, 'phase-spec.md'), 'utf-8');

  it('все поля — в одном объекте аргументов одного вызова', () => {
    const text = specText();
    assert.ok(text.includes('ОДНОМ объекте аргументов'), 'директива «все поля в одном объекте аргументов»');
    assert.ok(text.includes('Серия вызовов «по одному полю»'), 'серия частичных вызовов названа запрещённой');
    for (const field of ['title', 'type', 'priority', 'labels', 'description', 'references', 'acceptanceCriteria']) {
      assert.ok(text.includes(field), `перечислено поле ${field}`);
    }
  });

  it('правило чтения ответа write-инструмента: applied и skipped', () => {
    const text = specText();
    assert.ok(text.includes('Критерий завершения шага 5'), 'блок «критерий завершения шага 5»');
    assert.ok(text.includes('`applied`'), 'поле applied в правиле чтения ответа');
    assert.ok(text.includes('`skipped`'), 'поле skipped в правиле чтения ответа');
    assert.ok(text.includes('НЕ передавай его повторно'), 'запрет повторной передачи уже применённого поля');
  });

  it('различение ok:false по reason (not_confirmed / denied) и idempotentReplay', () => {
    const text = specText();
    assert.ok(text.includes('idempotentReplay'), 'разбор idempotentReplay в ответе');
    assert.ok(text.includes('not_confirmed'), 'reason not_confirmed — допустим один повтор');
    assert.ok(text.includes('denied'), 'reason denied — повтор запрещён');
    assert.ok(text.includes('backlog_finish_phase'), 'после ok — переход к шагу отчёта');
  });

  it('нет директивы «сначала одно поле, затем другое»', () => {
    const text = specText();
    assert.ok(!text.includes('затем передай'), 'последовательная передача полей отсутствует');
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

  it('VL-195: шаблоны investigate/materialize — {{producesStatus}} без хардкода статусов', () => {
    for (const file of ['phase-investigate.md', 'phase-materialize.md']) {
      const text = readFileSync(join(templatesDir, file), 'utf-8');
      assert.ok(text.includes('{{producesStatus}}'), `${file}: подстановка producesStatus`);
      assert.ok(!text.includes('"status": "Review"'), `${file}: хардкод Review отсутствует`);
      assert.ok(!text.includes('"status": "Done"'), `${file}: хардкод Done отсутствует`);
    }
    // Инвариант описания VL-195: создание задач — только фаза materialize
    const investigate = readFileSync(join(templatesDir, 'phase-investigate.md'), 'utf-8');
    assert.match(investigate, /НЕ создавать задачи/, 'investigate запрещает создавать задачи');
  });

  it('VL-195: PHASES включает investigate/materialize; рендер без остатков {{...}}', () => {
    for (const phase of ['investigate', 'materialize']) {
      assert.ok(PHASES.includes(phase), `${phase} в PHASES`);
      const prompt = renderPrompt(phase, 'VL-195', {
        ...TASK_VARS,
        taskLessons: '(нет)',
        availableTypes: 'task',
        availablePriorities: 'High, Medium, Low',
        comment: '',
      });
      assert.ok(prompt.includes('VL-195'), `${phase}: taskId подставлен`);
      assert.ok(prompt.includes('Review'), `${phase}: producesStatus подставлен`);
      assert.ok(!prompt.includes('{{'), `${phase}: неподставленных {{...}} не остаётся`);
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

// ============================================================
// VL-254 — правила бюджета времени и против node -e-обходчиков
// ============================================================
// Инвариант по трём файлам: правило про остаток wall-time (phase-code) и
// запрет `node -e`-обходчиков дерева / выборки строк вместо project_map и
// read_file (phase-plan + agent-prompt). Текст в шаблонах — контракт:
// именно его читает модель в фазе, поэтому тест фиксирует подстроки.
describe('VL-254 — бюджет времени и запрет node -e-обходчиков в промптах', () => {
  const read = (...parts) =>
    readFileSync(fileURLToPath(new URL(`../../${parts.join('/')}`, import.meta.url)), 'utf-8');

  it('phase-code.md: правило остатка бюджета времени и отказа от полного прогона', () => {
    const text = read('templates', 'phases', 'phase-code.md');
    assert.ok(text.includes('Бюджет времени фазы'), 'phase-code.md: раздел про бюджет времени');
    assert.ok(text.includes('полный прогон'), 'phase-code.md: при остатке не запускать полный прогон');
    assert.ok(/меньше 5 минут|осталось/.test(text), 'phase-code.md: порог остатка времени');
    assert.ok(text.includes('комментарием в задаче'), 'phase-code.md: фиксировать прогресс в задаче');
  });

  it('phase-plan.md: project_map/read_file вместо node -e-обходчиков и диапазоны вместо sed', () => {
    const text = read('templates', 'phases', 'phase-plan.md');
    assert.ok(text.includes('project_map'), 'phase-plan.md: project_map для обзора дерева/модулей');
    assert.ok(/обходчики/.test(text), 'phase-plan.md: запрет node -e-обходчиков');
    assert.ok(text.includes('read_file` с диапазоном'), 'phase-plan.md: read_file с диапазоном вместо sed');
  });

  it('agent-prompt.md: те же два правила в общих правилах агента', () => {
    const text = read('templates', 'agent-prompt.md');
    assert.ok(text.includes('project_map'), 'agent-prompt.md: project_map для обзора дерева/модулей');
    assert.ok(/обходчики/.test(text), 'agent-prompt.md: запрет node -e-обходчиков');
    assert.ok(text.includes('read_file` с диапазоном'), 'agent-prompt.md: read_file с диапазоном вместо sed');
  });
});

// ============================================================
// VL-312 — ревизия промптов фаз: структура эталона phase-spec и запрет дублей
// ============================================================
//
// Ревизия VL-312 привела все шаблоны фаз к структуре эталона phase-spec
// (короткий «Порядок», отдельный «Запреты», одно правило в одном месте)
// и добавила правило параллельных вызовов. Тест — механический сторож,
// чтобы дубли не наросли снова: (1) обязательные маркеры шагов у каждого
// шаблона, (2) «ключевое правило встречается не более N раз в шаблоне».
// Пустой или урезанный шаблон (без отчёта, запретов, финального маркера)
// валит тест. Подстроки-маркеры держим короткими и стабильными (lesson-130).

describe('VL-312 — структура шаблонов фаз и отсутствие дублей правил', () => {
  const read = (file) => readFileSync(join(templatesDir, file), 'utf-8');
  const agentPromptText = () =>
    readFileSync(fileURLToPath(new URL('../../templates/agent-prompt.md', import.meta.url)), 'utf-8');

  /**
   * Обязательные маркеры каждого шаблона: блок порядка, блок запретов,
   * финальный маркер. Отчётность — либо backlog_finish_phase (фазы с
   * переходом статуса), либо backlog_add_comment (comment/reject), либо
   * текстовый отчёт (analyze/prompt): это и есть «шаг отчёта» фазы.
   */
  const REQUIRED_MARKERS = [
    ['phase-spec.md', ['## Порядок', '## Запреты', 'backlog_update_task', 'backlog_finish_phase']],
    ['phase-plan.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'backlog_update_task']],
    ['phase-code.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'backlog_manage_ac', 'backlog_manage_dod']],
    ['phase-do.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'backlog_manage_ac']],
    ['phase-close.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'DoD']],
    ['phase-close-worktree.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'DoD']],
    ['phase-comment.md', ['## Порядок', '## Запреты', 'backlog_add_comment']],
    ['phase-reject.md', ['## Порядок', '## Запреты', 'backlog_add_comment', 'git restore']],
    ['phase-investigate.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'document_create']],
    ['phase-materialize.md', ['## Порядок', '## Запреты', 'backlog_finish_phase', 'backlog_create_task']],
    ['phase-analyze.md', ['## Порядок', '## Запреты', 'backlog_search']],
    ['prompt.md', ['## Порядок', '## Запреты', '{{prompt}}']],
  ];

  /**
   * Ключевые правила ревизии: подстрока → максимум вхождений в ОДНОМ шаблоне.
   * Одно правило — одно место. Для массового add максимум 0: каноническая
   * формулировка живёт в templates/agent-prompt.md, в фазах её быть не должно
   * (в фазах остаётся ссылка на общий промпт).
   */
  const RULE_MAX_IN_PHASE = {
    'Пакетное чтение': 1,
    'Параллельные вызовы': 1,
    'README — витрина': 1,
    'Упоминания инцидентов': 1,
    '--max-tool-calls': 1,
    'git add -A': 0,
  };

  it('обязательные маркеры шагов есть у каждого шаблона; пустой или урезанный валит тест', () => {
    for (const [file, markers] of REQUIRED_MARKERS) {
      const text = read(file);
      assert.ok(text.length > 400, `${file}: шаблон не пустой и не урезан (${text.length} символов)`);
      for (const marker of markers) {
        assert.ok(text.includes(marker), `${file}: обязательный маркер шага «${marker}»`);
      }
      // Терминальный вывод фазы: «Готово» (фазы) либо текстовый отчёт (prompt)
      assert.match(text, /«Готово»|## Формат финала|финальный текст/, `${file}: терминальный вывод фазы`);
      // Первая строка — маркер фазы (VL-261): ран режется по нему
      assert.match(text.split('\n')[0], /^Ты — /, `${file}: первая строка начинается с «Ты — »`);
    }
  });

  it('ни одно ключевое правило не повторяется в шаблоне больше разрешённого', () => {
    const files = readdirSync(templatesDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length >= 12, `шаблоны фаз найдены (${files.length})`);
    for (const file of files) {
      const text = read(file);
      for (const [rule, max] of Object.entries(RULE_MAX_IN_PHASE)) {
        const count = text.split(rule).length - 1;
        assert.ok(count <= max, `${file}: «${rule}» встречается ${count} раз (максимум ${max})`);
      }
    }
  });

  it('правило параллельных вызовов: каноническая формулировка в agent-prompt + шаблоны чтения', () => {
    const agent = agentPromptText();
    assert.ok(agent.includes('ОДИН ход'), 'agent-prompt.md: независимые вызовы — одним ходом');
    assert.ok(agent.includes('assistant-сообщении'), 'agent-prompt.md: несколько tool_calls в одном assistant-сообщении');
    // Шаблоны, где чтение кода уместно: правило есть ровно один раз
    for (const file of ['phase-plan.md', 'phase-code.md', 'phase-do.md', 'phase-investigate.md']) {
      const text = read(file);
      assert.ok(text.includes('Параллельные вызовы'), `${file}: буллет «Параллельные вызовы»`);
      assert.ok(text.includes('ОДНИМ ходом'), `${file}: формулировка «ОДНИМ ходом»`);
      assert.ok(text.includes('assistant-сообщении'), `${file}: несколько tool_calls в одном сообщении`);
      assert.equal(text.split('Параллельные вызовы').length - 1, 1, `${file}: правило ровно один раз`);
    }
  });

  it('канонические формулировки правил живут в agent-prompt, а не размножены по фазам', () => {
    const agent = agentPromptText();
    // Два правила, которые в VL-312 сведены к одной формулировке в общем промпте
    assert.ok(agent.includes('README — витрина'), 'agent-prompt.md: каноническое правило README');
    assert.ok(agent.includes('git add -A'), 'agent-prompt.md: канонический запрет массового add');
    assert.ok(agent.includes('Упоминания инцидентов'), 'agent-prompt.md: правило про упоминания инцидентов');
    assert.ok(agent.includes('--max-tool-calls'), 'agent-prompt.md: правило про лимит tool-calls');
    // В фазах этих правил нет (кроме ссылки), поэтому счётчик 0 допустим,
    // а вот дублировать канон в двух шаблонах фазы — уже нет.
    for (const file of ['phase-code.md', 'phase-do.md', 'phase-close.md', 'phase-close-worktree.md']) {
      const text = read(file);
      assert.equal(text.split('Упоминания инцидентов').length - 1, 0, `${file}: нет локальной копии правила об инцидентах`);
    }
  });
});

