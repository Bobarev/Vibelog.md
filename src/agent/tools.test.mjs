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

import { listLocalTools, validateArgs, miniGlobToRegex, checkShellCommandInProject, truncateToolOutput, maskSecrets, TOOL_OUTPUT_MAX_CHARS } from '../../dist/agent/tools.js';

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
  it('содержит ровно 7 инструментов', () => {
    assert.deepEqual(
      [...byName.keys()].sort(),
      ['edit', 'glob', 'grep_search', 'read_file', 'run_shell_command', 'search_files', 'write_file'],
    );
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
