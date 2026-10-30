/**
 * Тесты VL-83 — локальные инструменты агента (src/agent/tools.ts).
 *
 * Всё в mkdtemp-каталоге вне проекта (VL-241: изоляция от параллельных прогонов
 * и от CLI-тестов): read/write/edit, отказ ../-путей, run_shell_command (echo, таймаут
 * с kill, abort-сигнал), grep_search и glob по фейковому дереву.
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, symlinkSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { listLocalTools, validateArgs, miniGlobToRegex, checkShellCommandInProject, truncateToolOutput, maskSecrets, formatFileSlice, TOOL_OUTPUT_MAX_CHARS, formatMissingPathHint, PATH_HINT_MAX_LINES } from '../../dist/agent/tools.js';

const TMP = mkdtempSync(join(tmpdir(), 'vibelog-agent-tools-'));
let tools;
let byName;

beforeAll(() => {
  mkdirSync(join(TMP, 'sub'), { recursive: true });
  mkdirSync(join(TMP, 'grep', 'sub'), { recursive: true });
  writeFileSync(join(TMP, 'a.txt'), 'alpha\nbeta\nalpha\n');
  writeFileSync(join(TMP, 'sub', 'b.ts'), 'const x = 1;\n');
  writeFileSync(join(TMP, 'sub', 'c.md'), '# Заголовок\nalpha\n');
  // Отдельное поддерево для grep: edit-тесты выше мутируют a.txt, поэтому
  // grep-фикстуры живут в отдельной директории и не зависят от порядка describe.
  writeFileSync(join(TMP, 'grep', 'f1.txt'), 'alpha\nbeta\nalpha\n');
  writeFileSync(join(TMP, 'grep', 'f2.ts'), 'const x = 1;\n');
  writeFileSync(join(TMP, 'grep', 'sub', 'f3.md'), '# Заголовок\nalpha\n');
  tools = listLocalTools(TMP);
  byName = new Map(tools.map((t) => [t.name, t]));
});

// VL-241: каталог уникален на прогон — убираем за собой, чтобы не копить мусор в tmpdir.
afterAll(() => { rmSync(TMP, { recursive: true, force: true }); });

describe('validateArgs (VL-83)', () => {
  const schema = {
    type: 'object',
    properties: { path: { type: 'string' }, offset: { type: 'number' }, flag: { type: 'boolean' } },
    required: ['path'],
  };

  it('валидные аргументы → null', () => {
    assert.equal(validateArgs(schema, { path: 'x', offset: 1 }, 't'), null);
  });

  it('отсутствует обязательное поле → текст про него', () => {
    const err = validateArgs(schema, {}, 't');
    assert.match(err, /обязательное поле "path"/);
  });

  it('неверный тип → текст про тип', () => {
    const err = validateArgs(schema, { path: 42 }, 't');
    assert.match(err, /поле "path" должно иметь тип string/);
  });
});

describe('listLocalTools (VL-83)', () => {
  it('содержит ровно 8 инструментов', () => {
    assert.deepEqual(
      [...byName.keys()].sort(),
      ['agent_session_outline', 'edit', 'glob', 'grep_search', 'read_file', 'run_shell_command', 'search_files', 'write_file'],
    );
  });

  // VL-258: обзор транскрипта сессии — 5 строк, одна 50 КБ → компактный обзор
  it('agent_session_outline: обзор jsonl одним вызовом (VL-258)', async () => {
    const big = 'x'.repeat(50_000);
    const lines = [
      { role: 'system', content: 'system' },
      { role: 'user', content: 'Ты — автоматический исполнитель Vibelog (Фаза 2: Plan) для задачи VL-9.' },
      { role: 'assistant', content: big },
      { role: 'user', content: 'Продолжи с текущего места' },
      { role: 'assistant', content: 'готово' },
    ];
    const file = join(TMP, 'agent-outline.jsonl');
    writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    const out = await byName.get('agent_session_outline').handler({ path: 'agent-outline.jsonl' });
    assert.ok(out.length <= TOOL_OUTPUT_MAX_CHARS, `обзор ${out.length} ≤ ${TOOL_OUTPUT_MAX_CHARS}`);
    assert.match(out, /5 строк, 2 ранов/);
    assert.match(out, /Раны: 1 → стр\. 2 \(plan\), 2 → стр\. 4 \(resume\)/);
    assert.ok(!out.includes('x'.repeat(200)), 'тело гигантской строки не попало в обзор');
  });

  it('agent_session_outline: несуществующий файл → «Файл не найден» + подсказка (VL-257)', async () => {
    const out = await byName.get('agent_session_outline').handler({ path: 'нет-такого.jsonl' });
    assert.match(out, /Файл не найден/);
    assert.match(out, /Ближайший существующий каталог/);
  });

  // VL-234: новый инструмент зарегистрирован в локальном наборе агента
  it('search_files ищет по фейковому дереву (VL-234)', async () => {
    const out = await byName.get('search_files').handler({ pattern: 'alpha', path: 'grep', glob: '*.txt' });
    assert.match(out, /^grep\/f1\.txt$/m);
    assert.match(out, /^ {2}1: alpha$/m);
  });
});

describe('read_file / write_file / edit (VL-83)', () => {
  it('write_file + read_file: запись и чтение с offset/limit', async () => {
    const w = await byName.get('write_file').handler({ path: 'new/dir/f.txt', content: 'стр1\nстр2\nстр3\n' });
    assert.match(w, /Файл записан/);
    const full = await byName.get('read_file').handler({ path: 'new/dir/f.txt' });
    assert.equal(full, 'стр1\nстр2\nстр3\n');
    const slice = await byName.get('read_file').handler({ path: 'new/dir/f.txt', offset: 1, limit: 1 });
    assert.equal(slice, 'стр2');
  });

  it('read_file: несуществующий файл → текст модели', async () => {
    const out = await byName.get('read_file').handler({ path: 'нет.txt' });
    assert.match(out, /Файл не найден/);
  });

  it('edit: точная замена без replace_all', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'beta', new_string: 'BETA' });
    assert.match(out, /Выполнено замен: 1/);
    const content = await byName.get('read_file').handler({ path: 'a.txt' });
    assert.equal(content, 'alpha\nBETA\nalpha\n');
  });

  it('edit: несколько вхождений без replace_all → отказ', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'alpha', new_string: 'A' });
    assert.match(out, /найдена 2 раз/);
  });

  it('edit: replace_all заменяет все вхождения', async () => {
    const out = await byName
      .get('edit')
      .handler({ path: 'a.txt', old_string: 'alpha', new_string: 'A', replace_all: true });
    assert.match(out, /Выполнено замен: 2/);
    const content = await byName.get('read_file').handler({ path: 'a.txt' });
    assert.equal(content, 'A\nBETA\nA\n');
  });

  it('edit: отсутствующая строка → отказ', async () => {
    const out = await byName.get('edit').handler({ path: 'a.txt', old_string: 'нет такого', new_string: 'x' });
    assert.match(out, /не найдена/);
  });
});

describe('ограничение путей (VL-83)', () => {
  it('read_file с ../ → отказ «за пределы проекта»', async () => {
    const out = await byName.get('read_file').handler({ path: '../secrets.txt' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('write_file с абсолютным путём наружу → отказ', async () => {
    const out = await byName.get('write_file').handler({ path: '/etc/evil.txt', content: 'x' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('edit с ../ → отказ', async () => {
    const out = await byName
      .get('edit')
      .handler({ path: '../../x.txt', old_string: 'a', new_string: 'b' });
    assert.match(out, /выходит за пределы проекта/);
  });
});

describe('run_shell_command (VL-83)', () => {
  it('echo: exit code 0 и stdout', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'echo привет' });
    assert.match(out, /exit code: 0/);
    assert.match(out, /привет/);
  });

  it('не нулевой exit code попадает в результат', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'exit 3' });
    assert.match(out, /exit code: 3/);
  });

  it('cwd вне проекта → отказ', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'pwd', cwd: '../..' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('таймаут: sleep 5 при лимите 1с → kill и пометка', async () => {
    const started = Date.now();
    const out = await byName.get('run_shell_command').handler({ command: 'sleep 5', timeout_ms: 1000 });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 4500, `процесс не убит вовремя: ${elapsed}мс`);
    assert.match(out, /таймаут 1000 мс/);
  });

  it('abort-сигнал убивает процесс', async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const started = Date.now();
    const out = await byName
      .get('run_shell_command')
      .handler({ command: 'sleep 5' }, { signal: controller.signal });
    const elapsed = Date.now() - started;
    assert.ok(elapsed < 2000, `процесс не убит по abort: ${elapsed}мс`);
    assert.match(out, /отменено пользователем/);
  });
});

describe('grep_search (VL-83)', () => {
  it('ищет по regex: формат file:line: text', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'grep' });
    const lines = out.split('\n');
    assert.equal(lines.length, 3);
    assert.match(lines[0], /^grep\/f1\.txt:1:alpha$/);
    assert.match(lines[1], /^grep\/f1\.txt:3:alpha$/);
    assert.match(lines[2], /^grep\/sub\/f3\.md:2:alpha$/);
  });

  it('фильтр glob сужает выдачу', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'grep', glob: '*.txt' });
    assert.equal(out.split('\n').length, 2);
    assert.match(out, /^grep\/f1\.txt:1:/);
  });

  it('поиск в поддиректории по path', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'const', path: 'sub' });
    assert.match(out, /^sub\/b\.ts:1:/);
  });

  it('невалидный regex → текст модели', async () => {
    const out = await byName.get('grep_search').handler({ pattern: '([' });
    assert.match(out, /Невалидный regex/);
  });

  it('нет совпадений → «Совпадений не найдено»', async () => {
    const out = await byName.get('grep_search').handler({ pattern: 'zzz_not_found' });
    assert.equal(out, 'Совпадений не найдено');
  });
});

describe('glob (VL-83)', () => {
  it('**/*.txt находит txt-файлы рекурсивно', async () => {
    const out = await byName.get('glob').handler({ pattern: '**/*.txt' });
    const files = out.split('\n');
    assert.ok(files.includes('a.txt'));
    assert.ok(files.includes('sub/../a.txt') === false);
  });

  it('*.ts без ** не заходит в поддиректории', async () => {
    const out = await byName.get('glob').handler({ pattern: '*.ts' });
    assert.equal(out, 'Файлы не найдены');
  });

  it('src-подобный паттерн **/*.ts', async () => {
    const out = await byName.get('glob').handler({ pattern: '**/*.ts' });
    assert.deepEqual(out.split('\n'), ['grep/f2.ts', 'sub/b.ts']);
  });
});

describe('miniGlobToRegex (VL-83)', () => {
  it('одна * не пересекает слэш', () => {
    const re = miniGlobToRegex('*.ts');
    assert.ok(re.test('a.ts'));
    assert.ok(!re.test('sub/a.ts'));
  });

  it('**/ поглощает директории', () => {
    const re = miniGlobToRegex('**/*.ts');
    assert.ok(re.test('a.ts'));
    assert.ok(re.test('sub/deep/a.ts'));
  });
});

describe('checkShellCommandInProject (VL-99)', () => {
  // Проверка лексическая — реальные файлы не нужны, cwd фиктивный.
  const CWD = '/tmp/vibelog-vl99-fake-project';

  it('отклоняет ~ в позиции пути', () => {
    for (const cmd of ['ls ~', 'ls -la ~', 'find ~ -maxdepth 3']) {
      assert.match(checkShellCommandInProject(cmd, CWD), /Команда отклонена/);
    }
  });

  it('отклоняет ~/... в пути', () => {
    assert.match(checkShellCommandInProject('ls ~/Desktop', CWD), /Команда отклонена/);
  });

  it('отклоняет $HOME и ${HOME}', () => {
    assert.match(checkShellCommandInProject('cat $HOME/.zshrc', CWD), /Команда отклонена/);
    assert.match(checkShellCommandInProject('cat ${HOME}/.zshrc', CWD), /Команда отклонена/);
  });

  it('отклоняет абсолютные пути вне проекта', () => {
    assert.match(checkShellCommandInProject('ls /Users/bob/Desktop', CWD), /Команда отклонена/);
    assert.match(checkShellCommandInProject("sed -n '1,5p' /etc/hosts", CWD), /Команда отклонена/);
  });

  it('отклоняет ../-переходы наружу', () => {
    assert.match(checkShellCommandInProject('cd ../.. && ls', CWD), /Команда отклонена/);
    assert.match(checkShellCommandInProject('ls ../../..', CWD), /Команда отклонена/);
  });

  it('пропускает команды с путями внутри проекта', () => {
    const allowed = [
      'ls -la',
      'git status',
      "sed -n '1,10p' src/agent/tools.ts",
      'grep -rn foo src',
      'ls node_modules',
      'cd src && ls',
    ];
    for (const cmd of allowed) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('VL-104: спецфайлы /dev/* не считаются путями наружу', () => {
    const cmds = [
      "ls nonexist 2>/dev/null",
      "grep -rn foo src 2>/dev/null",
      "ls /dev/stderr",
      "echo test > /dev/null",
    ];
    for (const cmd of cmds) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('VL-104: regex-паттерны grep/sed не считаются путями', () => {
    const cmds = [
      'grep -rn "/set\\|max-wall-time" docs',
      'grep -rn "^start" src README.md',
      "grep -c (foo\\|bar) src",
    ];
    for (const cmd of cmds) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('VL-104: абсолютные пути вне проекта по-прежнему отклоняются', () => {
    assert.match(checkShellCommandInProject('ls /Users/bob/Desktop', CWD), /Команда отклонена/);
  });
});

describe('checkShellCommandInProject: экранированные скобки (VL-179)', () => {
  // Тот же принцип, что в VL-99: проверка лексическая, cwd фиктивный.
  const CWD = '/tmp/vibelog-vl179-fake-project';

  it('\\(main\\)-пути внутри проекта возвращают null (не reject)', () => {
    const allowed = [
      // 5 ложных отказов из транскрипта agent-1792916033752
      'ls -la backlog/references/data/next-shadcn-admin-dashboard/src/app/\\(main\\)/dashboard/tasks/',
      'cd backlog/references/data/x && grep -rn foo src/app/\\(main\\)/dashboard/tasks/_components/tasks.tsx',
      "cd backlog/references/data/x && sed -n '1,120p' src/app/\\(main\\)/dashboard/tasks/_components/tasks.tsx",
      'grep -rn "Tabs\\|Search\\|Filter\\|Sort" docs/src/app/\\(main\\)/dashboard/kanban/_components/kanban.tsx',
      'grep -rn "AssigneeFilter" src/app/\\(main\\)/dashboard/tasks/_components/columns.tsx',
      // экранирование в кавычках обоих видов + одиночный апостроф (AC-2)
      "grep -rn 'src/app/\\(main\\)/dashboard/x.tsx' .",
      'grep -rn "src/app/\\(main\\)/dashboard/x.tsx" .',
      "grep foo src/it\\'s-dir",
      // '..' ВНУТРИ проекта — не reject
      'ls src/app/\\(main\\)/../dashboard',
    ];
    for (const cmd of allowed) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('.. наружу из \\(main\\)-пути по-прежнему отклоняется', () => {
    assert.match(
      checkShellCommandInProject('ls src/app/\\(main\\)/../../../../etc', CWD),
      /Команда отклонена/,
    );
  });

  it('истинный отказ из транскрипта (6-й кейс) сохраняется', () => {
    assert.match(
      checkShellCommandInProject("sed -n '1,120p' web/../../../../../web", CWD),
      /Команда отклонена/,
    );
  });
});

describe('checkShellCommandInProject: слэш-паттерны в позиции паттерна (VL-201)', () => {
  // Лексическая проверка, cwd фиктивный — как в VL-99/VL-179.
  const CWD = '/tmp/vibelog-vl201-fake-project';

  it('слэш-паттерны команд-фильтров без метасимволов не отклоняются (AC-1)', () => {
    const allowed = [
      // из AC-1: паттерны /auto, /web — штатный объект поиска в документации
      'grep -n "/auto" backlog/docs/doc-6*.md',
      'grep -n "/web start" backlog/docs/doc-10-*.md',
      // другие фильтры и формы записи паттерна
      'rg "/web start" src',
      'sed -n "/auto/p" src/agent/tools.ts',
      'grep -e "/auto" backlog/docs',
      // позиция паттерна определяется по команде после разделителя
      'git log --oneline | grep "/auto"',
      'cd backlog && grep -n "/web" docs',
      // значение -m не смещает границу паттерн/файл
      'grep -m 2 "/auto" backlog/docs',
    ];
    for (const cmd of allowed) {
      assert.equal(checkShellCommandInProject(cmd, CWD), null, 'неожиданный отказ: ' + cmd);
    }
  });

  it('опасные пути отклоняются по-прежнему, файл после паттерна тоже (AC-2)', () => {
    const rejected = [
      'ls /etc', // абсолютный путь вне проекта, ls не фильтр
      'cat ~/x', // тилда (верхнеуровневая проверка)
      'cat ../outside', // .. наружу
      'grep x /etc/passwd', // паттерн x пропущен, файловый аргумент отклонён
      'grep -rn "/auto" /etc/passwd', // слэш-паттерн пропущен, файл отклонён
    ];
    for (const cmd of rejected) {
      assert.match(
        checkShellCommandInProject(cmd, CWD),
        /Команда отклонена/,
        'не отклонён: ' + cmd,
      );
    }
  });
});

describe('run_shell_command: команда с путями вне проекта (VL-99)', () => {
  it('ls ~ отклоняется до запуска процесса', async () => {
    const out = await byName.get('run_shell_command').handler({ command: 'ls ~' });
    assert.match(out, /Команда отклонена/);
    assert.doesNotMatch(out, /exit code/);
  });
});

describe('truncateToolOutput — обрезка вывода для модели (VL-110)', () => {
  it('короткий вывод — без изменений', () => {
    const short = 'короткий вывод';
    assert.equal(truncateToolOutput(short), short);
  });

  it('длинный вывод обрезается до лимита с пометкой и точными числами', () => {
    const long = 'х'.repeat(TOOL_OUTPUT_MAX_CHARS + 500);
    const out = truncateToolOutput(long);
    assert.ok(out.startsWith('х'.repeat(100)));
    assert.match(out, /…\[вывод обрезан/);
    assert.ok(out.includes(`из ${long.length} символов`));
    assert.ok(out.length < long.length);
  });

  it('read_file: файл больше лимита обрезается', async () => {
    writeFileSync(join(TMP, 'big.txt'), 'строка данных\n'.repeat(2000), 'utf-8');
    const out = await byName.get('read_file').handler({ path: 'big.txt' });
    assert.match(out, /…\[вывод обрезан/);
  });

  it('run_shell_command: длинный stdout обрезается финальным лимитом', async () => {
    const out = await byName.get('run_shell_command').handler({
      command: `node -e "process.stdout.write('a'.repeat(20000))"`,
    });
    assert.match(out, /…\[вывод обрезан/);
  });

  it('grep_search: одна огромная строка-совпадение обрезается', async () => {
    writeFileSync(join(TMP, 'grep', 'big-line.txt'), 'alpha ' + 'б'.repeat(20000), 'utf-8');
    const out = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'grep' });
    assert.match(out, /…\[вывод обрезан/);
  });
});

describe('maskSecrets — маскировка секретов в shell-выводе (VL-115)', () => {
  it('VIBELOG_LLM_API_KEY=sk-... → NAME=***, соседние строки не тронуты', () => {
    const out = maskSecrets('VIBELOG_LLM_API_KEY=sk-sl-v1-abc123\nVIBELOG_CWD=/tmp/x');
    assert.equal(out, 'VIBELOG_LLM_API_KEY=***\nVIBELOG_CWD=/tmp/x');
  });

  it('TOKEN/SECRET/PASSWORD без учёта регистра, несколько строк', () => {
    const out = maskSecrets('github_token=ghp-123\nAWS_SECRET_ACCESS_KEY=xyz\nDB_PASSWORD=pw\nplain=ok');
    assert.ok(out.includes('github_token=***'), 'регистронезависимо: token');
    assert.ok(out.includes('AWS_SECRET_ACCESS_KEY=***'), 'SECRET в составе имени');
    assert.ok(out.includes('DB_PASSWORD=***'), 'PASSWORD');
    assert.ok(out.includes('plain=ok'), 'обычные строки не меняются');
  });

  it('обычный вывод без секретов не меняется', () => {
    const out = 'exit code: 0\nstdout:\nПривет\n';
    assert.equal(maskSecrets(out), out);
  });

  it('run_shell_command: NAME=ключ в stdout маскируется', async () => {
    const out = await byName.get('run_shell_command').handler({
      command: `node -e "console.log('VIBELOG_LLM_API_KEY=' + 'sk-real-999')"`,
    });
    assert.ok(out.includes('VIBELOG_LLM_API_KEY=***'), out);
    assert.ok(!out.includes('sk-real-999'), 'реальное значение не должно попадать в вывод');
  });
});

describe('VL-233 — листинг каталога в read_file', () => {
  const LST = join(TMP, 'lst');

  beforeAll(() => {
    rmSync(LST, { recursive: true, force: true });
    mkdirSync(join(LST, 'b'), { recursive: true });
    mkdirSync(join(LST, 'a-dir'), { recursive: true });
    writeFileSync(join(LST, 'a.txt'), 'a\n');
    writeFileSync(join(LST, 'z.txt'), 'z\n');
  });

  it('AC1: каталог → отсортированный листинг, каталоги с «/» первыми', async () => {
    const out = await byName.get('read_file').handler({ path: 'lst' });
    assert.match(out, /Листинг каталога lst\//);
    const lines = out.split('\n');
    assert.deepEqual(lines.slice(1, 5), ['a-dir/', 'b/', 'a.txt', 'z.txt']);
  });

  it('AC1: path "." → листинг корня проекта', async () => {
    const out = await byName.get('read_file').handler({ path: '.' });
    assert.match(out, /Листинг каталога \.\//);
    assert.ok(out.includes('lst/'), 'подкаталог lst/ в листинге корня');
  });

  it('AC1: пустой каталог → «Каталог пуст»', async () => {
    mkdirSync(join(TMP, 'empty-dir'), { recursive: true });
    const out = await byName.get('read_file').handler({ path: 'empty-dir' });
    assert.equal(out, 'Каталог пуст: empty-dir/');
  });

  it('AC2: усечение по лимиту 200 записей с пометкой', async () => {
    const BIG = join(TMP, 'big-dir');
    rmSync(BIG, { recursive: true, force: true });
    mkdirSync(BIG, { recursive: true });
    for (let i = 0; i < 205; i++) {
      writeFileSync(join(BIG, `f${String(i).padStart(3, '0')}.txt`), '');
    }
    const out = await byName.get('read_file').handler({ path: 'big-dir' });
    const lines = out.split('\n');
    assert.match(lines[0], /205 записей, показано 200/);
    assert.equal(lines.length, 1 + 200 + 1, 'шапка + 200 записей + маркер усечения');
    assert.match(out, /листинг усечён: показано 200 из 205/);
  });

  it('AC2: служебные каталоги не разворачиваются', async () => {
    for (const name of ['node_modules', '.git', 'dist']) {
      mkdirSync(join(TMP, name, 'sub'), { recursive: true });
      const out = await byName.get('read_file').handler({ path: name });
      assert.match(out, /Служебный каталог \((node_modules|\.git|dist)\) не разворачивается/);
      const nested = await byName.get('read_file').handler({ path: `${name}/sub` });
      assert.match(nested, /не разворачивается/);
    }
  });

  it('AC3: путь наружу ../ → отказ (прежний текст)', async () => {
    const out = await byName.get('read_file').handler({ path: '../secrets' });
    assert.match(out, /выходит за пределы проекта/);
  });

  it('AC3: симлинк каталога наружу проекта → отказ', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'vibelog-agent-tools-outside-'));
    const link = join(TMP, 'link-outside');
    rmSync(link, { force: true });
    symlinkSync(outside, link);
    const out = await byName.get('read_file').handler({ path: 'link-outside' });
    assert.match(out, /выходит за пределы проекта \(симлинк\)/);
    rmSync(link, { force: true });
    rmSync(outside, { recursive: true, force: true });
  });

  it('AC4: обычный файл читается как раньше (offset/limit, «не найден»)', async () => {
    const full = await byName.get('read_file').handler({ path: 'grep/f1.txt' });
    assert.equal(full, 'alpha\nbeta\nalpha\n');
    const slice = await byName.get('read_file').handler({ path: 'grep/f1.txt', offset: 1, limit: 1 });
    assert.equal(slice, 'beta');
    const missing = await byName.get('read_file').handler({ path: 'нет-такого.txt' });
    assert.match(missing, /Файл не найден/);
  });

  it('AC3: пустой путь → «Путь не задан»', async () => {
    const out = await byName.get('read_file').handler({ path: '' });
    assert.equal(out, 'Путь не задан');
  });
});

describe('VL-257 — подсказка при отсутствующем пути', () => {
  it('AC1: файла нет в существующем каталоге → листинг ближайшего каталога', async () => {
    const out = await byName.get('read_file').handler({ path: 'sub/nope.ts' });
    // Маркер прежней ошибки остаётся первой строкой (lesson-76).
    assert.match(out.split('\n')[0], /Файл не найден/);
    assert.match(out, /Ближайший существующий каталог: sub\//);
    assert.ok(out.includes('b.ts'));
    assert.ok(out.includes('c.md'));
  });

  it('AC1: несуществующий каталог → листинг ближайшего существующего предка', async () => {
    const out = await byName.get('read_file').handler({ path: 'no-such-dir/inner/f.txt' });
    assert.match(out.split('\n')[0], /Файл не найден/);
    assert.match(out, /Ближайший существующий каталог: \.\//);
    assert.ok(out.includes('sub/'));
  });

  it('AC3: fuzzy по имени без расширения → «Возможно, вы имели в виду»', async () => {
    // На macOS ФС регистронезависима, поэтому fuzzy проверяем через другое
    // расширение (stem совпадает), а не через регистр.
    const out = await byName.get('read_file').handler({ path: 'sub/c.mdx' });
    assert.match(out, /Возможно, вы имели в виду:/);
    assert.ok(out.includes('sub/c.md'), out);
  });

  it('AC2: путь похож на ID задачи → кандидат из backlog/tasks и подсказка backlog_view_task', async () => {
    mkdirSync(join(TMP, 'backlog', 'tasks'), { recursive: true });
    writeFileSync(join(TMP, 'backlog', 'tasks', 'VL-254 - Тестовая задача.md'), '# x\n');
    const out = await byName.get('read_file').handler({ path: 'backlog/active/VL-254.md' });
    assert.match(out, /Ближайший существующий каталог: backlog\//);
    assert.match(out, /Возможно, вы имели в виду:/);
    assert.ok(out.includes('backlog/tasks/VL-254 - Тестовая задача.md'), out);
    assert.match(out, /backlog_view_task \{"id":"VL-254"\}/);
  });

  it('AC5: путь вне проекта → прежняя ошибка без листинга', async () => {
    const out = await byName.get('read_file').handler({ path: '../outside.txt' });
    assert.match(out, /выходит за пределы проекта/);
    assert.ok(!out.includes('Ближайший существующий каталог'));
  });

  it('AC4: подсказка ограничена по объёму и входит в лимит tool-вывода', async () => {
    const big = join(TMP, 'hint-cap');
    mkdirSync(big, { recursive: true });
    for (let i = 0; i < 500; i += 1) writeFileSync(join(big, `n${i}.txt`), 'x\n');
    const out = await byName.get('read_file').handler({ path: 'hint-cap/none.txt' });
    assert.ok(out.length <= TOOL_OUTPUT_MAX_CHARS, `длина ${out.length}`);
    assert.match(out, /подсказка усечена: показано 30 из/);
    const hint = formatMissingPathHint(TMP, 'hint-cap/none.txt');
    const entries = hint.split('\n').filter((l) => /^(n\d+\.txt|…\[)/.test(l));
    assert.ok(entries.length <= PATH_HINT_MAX_LINES + 1, `строк листинга ${entries.length}`);
  });

  it('AC6: та же подсказка у search_files и grep_search при отсутствующем path', async () => {
    const searchOut = await byName.get('search_files').handler({ pattern: 'alpha', path: 'sub/nope' });
    assert.match(searchOut, /Путь не найден: sub\/nope/);
    assert.match(searchOut, /Ближайший существующий каталог: sub\//);
    const grepOut = await byName.get('grep_search').handler({ pattern: 'alpha', path: 'sub/nope' });
    assert.match(grepOut, /Путь не найден: sub\/nope/);
    assert.match(grepOut, /Ближайший существующий каталог: sub\//);
    // Вне проекта — по-прежнему без листинга.
    const outside = await byName.get('search_files').handler({ pattern: 'alpha', path: '../outside' });
    assert.ok(!outside.includes('Ближайший существующий каталог'));
  });
});

describe('VL-250 — длинные строки (JSONL) в read_file', () => {
  // Каждая запись JSONL — одна длинная строка (> лимита вывода), поэтому
  // старый «slice по строкам + посимвольная обрезка» давал всегда первую запись.
  const L0 = 'line0:' + 'a'.repeat(10000);
  const L1 = 'line1:' + 'b'.repeat(10000);
  const L2 = 'line2:' + 'c'.repeat(10000);
  const JSONL = [L0, L1, L2].join('\n');

  beforeAll(() => {
    writeFileSync(join(TMP, 'session.jsonl'), JSONL, 'utf-8');
    writeFileSync(join(TMP, 'one-huge.txt'), 'Z'.repeat(30000), 'utf-8');
  });

  it('AC1: offset=1 возвращает вторую запись, а не первую', async () => {
    const out = await byName.get('read_file').handler({ path: 'session.jsonl', offset: 1, limit: 1 });
    assert.ok(out.startsWith('line1:'), `ожидалась вторая запись, получено: ${out.slice(0, 40)}`);
    assert.ok(!out.startsWith('line0:'));
    assert.match(out, /…\[вывод обрезан: показаны строки 2–2 из 3/);
  });

  it('AC2: ответ ≤ лимита и для среза без limit, и для одной огромной строки', async () => {
    const noLimit = await byName.get('read_file').handler({ path: 'session.jsonl', offset: 1 });
    assert.ok(noLimit.length <= TOOL_OUTPUT_MAX_CHARS, `длина ${noLimit.length}`);
    assert.match(noLimit, /…\[вывод обрезан/);

    const huge = await byName.get('read_file').handler({ path: 'one-huge.txt' });
    assert.ok(huge.length <= TOOL_OUTPUT_MAX_CHARS, `длина ${huge.length}`);
    assert.match(huge, /…\[вывод обрезан/);
  });

  it('AC2: усечённая строка помечена и указан следующий offset', async () => {
    const out = await byName.get('read_file').handler({ path: 'one-huge.txt', limit: 1 });
    assert.match(out, /…\[строка усечена: показано \d+ из 30000 символов\]/);
    assert.match(out, /продолжение — offset=\d+/);
  });

  it('formatFileSlice — чистая функция: границы и дефолты', () => {
    // Пустой срез (offset за концом файла) — как раньше пустая строка.
    assert.equal(formatFileSlice('a\nb', 5, 1), '');
    // Невалидные offset/limit → дефолты (0 и «до конца»), как раньше.
    assert.equal(formatFileSlice('a\nb', -1, 0), 'a\nb');
    // Срез целиком в лимите возвращается дословно.
    assert.equal(formatFileSlice('alpha\nbeta\nalpha', 0, undefined), 'alpha\nbeta\nalpha');
    assert.equal(formatFileSlice('alpha\nbeta\nalpha', 1, 1), 'beta');
    // Инвариант длины для среза из многих длинных строк.
    const many = [L0, L1, L2, L0].join('\n');
    assert.ok(formatFileSlice(many, 0, undefined).length <= TOOL_OUTPUT_MAX_CHARS);
    // Все три записи достижимы по offset (файл читаем по диапазонам).
    for (const [i, prefix] of ['line0:', 'line1:', 'line2:'].entries()) {
      assert.ok(formatFileSlice(JSONL, i, 1).startsWith(prefix), `offset=${i}`);
    }
  });

  it('AC4: обычные файлы читаются как раньше', async () => {
    const full = await byName.get('read_file').handler({ path: 'grep/f1.txt' });
    assert.equal(full, 'alpha\nbeta\nalpha\n');
    const slice = await byName.get('read_file').handler({ path: 'grep/f1.txt', offset: 1, limit: 1 });
    assert.equal(slice, 'beta');
  });
});

describe('VL-252 — диапазон строк в path (обязательный аргумент вместо offset)', () => {
  // Диапазон едет в path, потому что offset/limit — необязательные поля схемы:
  // модель их опускает и получает ту же первую порцию (замкнутый круг VL-252).
  beforeAll(() => {
    writeFileSync(
      join(TMP, 'range.txt'),
      Array.from({ length: 20 }, (_, i) => `l${i + 1}`).join('\n') + '\n',
      'utf-8',
    );
  });

  it('AC1: path="файл:5-7" возвращает ровно строки 5–7 (1-based, включительно)', async () => {
    const out = await byName.get('read_file').handler({ path: 'range.txt:5-7' });
    assert.equal(out, 'l5\nl6\nl7');
  });

  it('AC2: path="файл:5" возвращает строки с 5-й до конца файла', async () => {
    const out = await byName.get('read_file').handler({ path: 'range.txt:5' });
    // 20 строк данных + завершающий '\n' даёт пустую 21-ю строку (как и при обычном чтении).
    assert.equal(out, Array.from({ length: 16 }, (_, i) => `l${i + 5}`).join('\n') + '\n');
    assert.ok(out.startsWith('l5\n'));
  });

  it('диапазон в path приоритетнее offset/limit из аргументов', async () => {
    const out = await byName.get('read_file').handler({ path: 'range.txt:5-7', offset: 0, limit: 1 });
    assert.equal(out, 'l5\nl6\nl7');
  });

  it('алиас GitHub-стиля "#L5-L7" даёт тот же диапазон', async () => {
    const out = await byName.get('read_file').handler({ path: 'range.txt#L5-L7' });
    assert.equal(out, 'l5\nl6\nl7');
  });

  it('AC3: маркер обрезки содержит копируемый path с относительным путём', async () => {
    const out = await byName.get('read_file').handler({ path: 'big.txt' });
    assert.match(out, /…\[вывод обрезан/);
    assert.match(out, /продолжение — offset=\d+/);
    assert.match(out, /path="big\.txt:\d+-\d+"/);
    assert.ok(!out.includes(TMP), 'в маркере должен быть относительный путь, а не абсолютный');
    assert.ok(out.length <= TOOL_OUTPUT_MAX_CHARS, `длина ${out.length}`);
  });

  it('AC6: некорректный диапазон — понятная ошибка с подсказкой формата', async () => {
    for (const bad of ['range.txt:10-5', 'range.txt:0-3']) {
      const out = await byName.get('read_file').handler({ path: bad });
      assert.match(out, /Некорректный диапазон строк/, `${bad}: ${out}`);
      assert.match(out, /путь:НАЧАЛО-КОНЕЦ/);
    }
    // Нецифровой суффикс не распознан как диапазон — штатное «Файл не найден».
    const abc = await byName.get('read_file').handler({ path: 'range.txt:abc' });
    assert.match(abc, /Файл не найден|Некорректный диапазон/);
  });

  it('AC4: обычный путь и offset/limit работают как раньше (регрессия)', async () => {
    const plain = await byName.get('read_file').handler({ path: 'range.txt', offset: 1, limit: 2 });
    assert.equal(plain, 'l2\nl3');
    // Существующий файл с двоеточием в имени читается как файл, а не как диапазон.
    writeFileSync(join(TMP, 'a:1-2.md'), 'colon\n', 'utf-8');
    const colon = await byName.get('read_file').handler({ path: 'a:1-2.md' });
    assert.equal(colon, 'colon\n');
  });
});
