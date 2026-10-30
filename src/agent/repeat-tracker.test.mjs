/**
 * Тесты VL-229 — детектор повторов обращений агента (src/agent/repeat-tracker.ts).
 *
 * AC1/AC3: метрика повторов на фикстуре jsonl с зацикленным grep-паттерном
 * (анализ транскрипта целиком), guard-предупреждение на порогах 3/5 (AC2),
 * игнор фантомных tool_calls и неотслеживаемых инструментов.
 */

import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import {
  REPEAT_READ_LIMIT_DEFAULT,
  REPEAT_SEARCH_LIMIT_DEFAULT,
  REPEAT_SHELL_LIMIT_DEFAULT,
  analyzeToolRepeats,
  createRepeatGuard,
  emptyRepeatStats,
  repeatKey,
  shellCommandKey,
  toolRepeatKind,
  toolRepeatTarget,
} from '../../dist/agent/repeat-tracker.js';

/** assistant-сообщение с одним tool_call. */
function call(name, args, id = `c${Math.random().toString(36).slice(2, 8)}`) {
  return { role: 'assistant', content: null, tool_calls: [{ id, name, arguments: args }] };
}

describe('repeat-tracker: ключ повтора (VL-229)', () => {
  it('grep_search/glob/search_files → pattern, read_file/edit/write_file → path', () => {
    assert.equal(toolRepeatTarget('grep_search', { pattern: 'foo', path: 'src' }), 'foo');
    assert.equal(toolRepeatTarget('search_files', { pattern: 'createLlmClient', glob: 'src/**/*.ts' }), 'createLlmClient');
    assert.equal(toolRepeatTarget('glob', { pattern: 'src/**/*.ts' }), 'src/**/*.ts');
    assert.equal(toolRepeatTarget('read_file', { path: 'src/agent/loop.ts', offset: 10 }), 'src/agent/loop.ts');
    assert.equal(toolRepeatTarget('edit', { path: 'a.ts', old_string: 'x' }), 'a.ts');
    assert.equal(toolRepeatTarget('write_file', { path: 'b.ts', content: 'x' }), 'b.ts');
  });

  it('run_shell_command → скелет команды (VL-254); неизвестные → null', () => {
    assert.equal(toolRepeatTarget('run_shell_command', { command: 'ls' }), 'ls');
    assert.equal(repeatKey('run_shell_command', { command: 'ls' }), 'run_shell_command|ls');
    assert.equal(toolRepeatTarget('backlog_view_task', { id: 'VL-1' }), null);
    assert.equal(toolRepeatTarget('run_shell_command', {}), null);
  });

  it('пустой/отсутствующий аргумент → null (не считается повтором)', () => {
    assert.equal(toolRepeatTarget('grep_search', {}), null);
    assert.equal(toolRepeatTarget('read_file', { path: '   ' }), null);
    assert.equal(repeatKey('read_file', {}), null);
  });

  it('repeatKey — формат <имя>|<объект> (он же path|pattern из AC1)', () => {
    assert.equal(repeatKey('read_file', { path: 'src/agent/loop.ts' }), 'read_file|src/agent/loop.ts');
    assert.equal(repeatKey('grep_search', { pattern: 'foo' }), 'grep_search|foo');
  });

  it('категории: search/read/write/shell и null для прочих', () => {
    assert.equal(toolRepeatKind('grep_search'), 'search');
    assert.equal(toolRepeatKind('search_files'), 'search');
    assert.equal(toolRepeatKind('glob'), 'search');
    assert.equal(toolRepeatKind('read_file'), 'read');
    assert.equal(toolRepeatKind('edit'), 'write');
    assert.equal(toolRepeatKind('write_file'), 'write');
    assert.equal(toolRepeatKind('run_shell_command'), 'shell');
    assert.equal(toolRepeatKind('backlog_view_task'), null);
  });
});

describe('repeat-tracker: shell-скелет (VL-254, AC1)', () => {
  it('node -e → node-e|<hash> независимо от текста, одинаковый скрипт — один ключ', () => {
    const a = shellCommandKey('node -e "console.log(1)"');
    assert.match(a, /^node-e\|[0-9a-f]{8}$/);
    assert.equal(shellCommandKey('node -e "console.log(1)"'), a);
    assert.equal(shellCommandKey('node --eval "console.log(1)"'), a);
    assert.equal(shellCommandKey('node --input-type=module -e "console.log(1)"'), a);
    assert.notEqual(shellCommandKey('node -e "console.log(2)"'), a);
  });

  it('цепочка берётся по первому сегменту; значимые аргументы сортируются', () => {
    assert.equal(shellCommandKey('pnpm build && pnpm test'), 'pnpm build');
    assert.equal(shellCommandKey('git status | head -5'), 'git status');
    assert.equal(shellCommandKey('grep -rn foo src'), shellCommandKey('grep -rn bar src'));
    assert.equal(shellCommandKey('grep -rn foo src'), 'grep -rn');
    assert.equal(shellCommandKey('grep -rn foo src/a.ts'), 'grep -rn src/a.ts');
    assert.equal(shellCommandKey('   '), '');
    assert.ok(shellCommandKey(`ls ${'x/'.repeat(80)}`).length <= 80);
  });
});

describe('repeat-tracker: метрика по транскрипту (VL-229, AC1/AC3)', () => {
  it('AC3: фикстура-jsonl с зацикленным grep-паттерном (12 из 30) → top[0].count=12, share≈0.37', () => {
    // Фикстура: тот же pattern 12 раз + 18 разных вызовов = 30 tool-вызовов.
    // 11 повторных обращений (2..12) — repeat_calls.
    const messages = [];
    for (let i = 0; i < 12; i++) messages.push(call('grep_search', { pattern: 'grep_search' }));
    for (let i = 0; i < 9; i++) messages.push(call('read_file', { path: `src/file-${i}.ts` }));
    for (let i = 0; i < 9; i++) messages.push(call('grep_search', { pattern: `uniq-${i}` }));
    const stats = analyzeToolRepeats(messages);
    assert.equal(stats.tool_calls_total, 30);
    assert.equal(stats.repeat_calls, 11);
    assert.equal(stats.repeat_share, 0.3667);
    assert.equal(stats.top.length, 1, 'в топ попадают только ключи с count > 1');
    assert.deepEqual(stats.top[0], { key: 'grep_search|grep_search', count: 12 });
  });

  it('топ отсортирован по count убыв., лимит 10, одиночные не попадают', () => {
    const messages = [];
    for (let i = 0; i < 4; i++) messages.push(call('read_file', { path: 'a.ts' }));
    for (let i = 0; i < 6; i++) messages.push(call('read_file', { path: 'b.ts' }));
    for (let i = 0; i < 12; i++) messages.push(call('read_file', { path: `f-${i}.ts` }));
    const stats = analyzeToolRepeats(messages);
    assert.equal(stats.top[0].key, 'read_file|b.ts');
    assert.equal(stats.top[0].count, 6);
    assert.equal(stats.top[1].key, 'read_file|a.ts');
    assert.equal(stats.top.length, 2);
  });

  it('фантомные tool_calls (пустой name/id) не считаются (VL-215)', () => {
    const messages = [
      { role: 'assistant', content: null, tool_calls: [{ id: '', name: '', arguments: {} }] },
      call('read_file', { path: 'a.ts' }),
      call('read_file', { path: 'a.ts' }),
    ];
    const stats = analyzeToolRepeats(messages);
    assert.equal(stats.tool_calls_total, 2);
    assert.equal(stats.repeat_calls, 1);
  });

  it('shell-вызовы учитываются в total и в отдельной строке shell_* (VL-254)', () => {
    const messages = [
      call('run_shell_command', { command: 'ls' }),
      call('run_shell_command', { command: 'ls' }),
      call('grep_search', { pattern: 'x' }),
      call('grep_search', { pattern: 'x' }),
    ];
    const stats = analyzeToolRepeats(messages);
    assert.equal(stats.tool_calls_total, 4, 'shell-вызовы тоже tool-вызовы сессии');
    assert.equal(stats.repeat_calls, 2, 'повтор у shell-скелета и у grep');
    assert.equal(stats.repeat_share, 0.5);
    assert.equal(stats.shell_tool_calls, 2);
    assert.equal(stats.shell_repeat_calls, 1);
    assert.equal(stats.shell_share, 0.5);
    assert.deepEqual(stats.shell_top, [{ key: 'run_shell_command|ls', count: 2 }]);
    assert.ok(stats.top.some((e) => e.key === 'run_shell_command|ls'));
  });

  it('AC1: три node -e с одним скриптом → shell_repeat_calls=2, один ключ в shell_top', () => {
    const messages = [
      call('run_shell_command', { command: 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\')"' }),
      call('run_shell_command', { command: 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\')"' }),
      call('run_shell_command', { command: 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\')"' }),
    ];
    const stats = analyzeToolRepeats(messages);
    assert.equal(stats.shell_tool_calls, 3);
    assert.equal(stats.shell_repeat_calls, 2);
    assert.equal(stats.shell_top.length, 1);
    assert.match(stats.shell_top[0].key, /^run_shell_command\|node-e\|[0-9a-f]{8}$/);
    assert.equal(stats.shell_top[0].count, 3);
  });

  it('пустой транскрипт → нули без деления на ноль', () => {
    const stats = analyzeToolRepeats([]);
    assert.equal(stats.tool_calls_total, 0);
    assert.equal(stats.repeat_calls, 0);
    assert.equal(stats.repeat_share, 0);
    assert.deepEqual(stats.top, []);
    assert.deepEqual(emptyRepeatStats(), stats);
  });

  it('сообщения без tool_calls и tool-результаты в метрику не попадают', () => {
    const stats = analyzeToolRepeats([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'задача' },
      { role: 'assistant', content: 'текст' },
      { role: 'tool', tool_call_id: 'c1', content: 'результат' },
    ]);
    assert.deepEqual(emptyRepeatStats(), stats);
  });
});

describe('repeat-tracker: guard-предупреждение (VL-229, AC2)', () => {
  it('AC2: 3-й grep с тем же pattern → предупреждение, 2-й — молчание', () => {
    const guard = createRepeatGuard();
    assert.equal(guard.note('grep_search', { pattern: 'foo' }), null, '1-й');
    assert.equal(guard.note('grep_search', { pattern: 'foo' }), null, '2-й — порог не достигнут');
    const warn = guard.note('grep_search', { pattern: 'foo' });
    assert.ok(warn, '3-й должен дать предупреждение');
    assert.match(warn, /используй ранее полученный результат/);
    assert.match(warn, /3 раз/);
    assert.match(warn, /grep_search\|foo/);
    // Далее — на каждом вызове сверх порога
    assert.match(guard.note('grep_search', { pattern: 'foo' }) ?? '', /4 раз/);
  });

  it('AC2: 5-е чтение того же файла → предупреждение, 4-е — молчание', () => {
    const guard = createRepeatGuard();
    for (let i = 0; i < 4; i++) {
      assert.equal(guard.note('read_file', { path: 'src/agent/loop.ts', offset: i * 100 }), null);
    }
    const warn = guard.note('read_file', { path: 'src/agent/loop.ts', offset: 400 });
    assert.ok(warn);
    assert.match(warn, /5 раз/);
    assert.match(warn, /offset\/limit/);
  });

  it('разные pattern не смешиваются в один счётчик', () => {
    const guard = createRepeatGuard();
    assert.equal(guard.note('grep_search', { pattern: 'a' }), null);
    assert.equal(guard.note('grep_search', { pattern: 'b' }), null);
    assert.equal(guard.note('grep_search', { pattern: 'c' }), null);
  });

  it('edit/write_file guard не срабатывает никогда (повторная правка легитимна)', () => {
    const guard = createRepeatGuard();
    for (let i = 0; i < 10; i++) {
      assert.equal(guard.note('edit', { path: 'a.ts', old_string: `x${i}` }), null);
      assert.equal(guard.note('write_file', { path: 'a.ts', content: 'y' }), null);
    }
  });

  it('AC1: shell-скелет — предупреждение на 3-м вызове, «используй полученный вывод»', () => {
    const guard = createRepeatGuard();
    const cmd = 'node -e "const fs=require(\'fs\');fs.readdirSync(\'.\')"';
    assert.equal(guard.note('run_shell_command', { command: cmd }), null);
    assert.equal(guard.note('run_shell_command', { command: cmd }), null);
    const warn = guard.note('run_shell_command', { command: cmd });
    assert.ok(warn, '3-й одинаковый shell-скелет — предупреждение');
    assert.match(warn, /используй ранее полученный результат/);
    assert.match(warn, /project_map/);
    assert.match(warn, /3 раз/);
  });

  it('разные shell-команды не смешиваются (только скелет — ключ)', () => {
    const guard = createRepeatGuard();
    assert.equal(guard.note('run_shell_command', { command: 'git status' }), null);
    assert.equal(guard.note('run_shell_command', { command: 'ls src' }), null);
    assert.equal(guard.note('run_shell_command', { command: 'pnpm build' }), null);
  });

  it('пороги конфигурируемы через options (для тестов/лимитов loop)', () => {
    const guard = createRepeatGuard({ searchLimit: 2, readLimit: 2, shellLimit: 2 });
    assert.equal(guard.note('grep_search', { pattern: 'x' }), null);
    assert.ok(guard.note('grep_search', { pattern: 'x' }));
    assert.equal(guard.note('run_shell_command', { command: 'ls' }), null);
    assert.ok(guard.note('run_shell_command', { command: 'ls' }));
  });

  it('дефолтные пороги соответствуют AC (3 поиска / 5 чтений / 3 shell)', () => {
    assert.equal(REPEAT_SEARCH_LIMIT_DEFAULT, 3);
    assert.equal(REPEAT_READ_LIMIT_DEFAULT, 5);
    assert.equal(REPEAT_SHELL_LIMIT_DEFAULT, 3);
  });
});