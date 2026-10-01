#!/usr/bin/env node
/**
 * Smoke-тест установки Vibelog.md из npm-tarball (VL-32).
 *
 * Зачем: поле files в package.json может ошибиться — например, корневой dist/
 * (gitignored) не попадёт в пакет, и шим упадёт с ERR_MODULE_NOT_FOUND у
 * каждого пользователя. Скрипт ловит это ДО публикации: pack → установка в
 * чистый /tmp-каталог → реальный прогон CLI/init/create/browser из
 * установленного пакета + проверка содержимого (шаблоны оркестратора, web/dist,
 * отсутствие backlog/ и .qwen).
 *
 * Использование: node scripts/npm-smoke.mjs
 * Перед npm publish — обязателен (закреплено в AGENTS.md).
 */

import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3041; // редкий порт, чтобы не конфликтовать с dev-серверами

const results = [];

/** Фиксация результата пункта: PASS/FAIL + печать. */
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${detail ? ` (${detail})` : ''}`);
}

/**
 * Запуск команды с объединённым выводом: Vibelog CLI печатает ошибки
 * в stderr, но завершается с exit 0 — смотрим на текст, не только на код.
 */
function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { encoding: 'utf-8', ...opts });
  return {
    code: res.status,
    out: `${res.stdout || ''}${res.stderr || ''}`,
    // stdout отдельно: npm печатает имя tarball именно туда, а notice-сообщения
    // идут в stderr и искажали бы парсинг последней строки
    stdout: res.stdout || '',
  };
}

/** Ожидание HTTP-ответа сервера (поднимается асинхронно). */
async function waitForServer(url, tries = 32) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
    } catch {
      // сервер ещё не поднят — ждём дальше
    }
    await new Promise(r => setTimeout(r, 250));
  }
  return null;
}

const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-smoke-'));
const tarballDir = join(testRoot, 'pack');
const installDir = join(testRoot, 'install');
const projectDir = join(testRoot, 'project');
let server = null;

try {
  // ── Шаг 0: свежая сборка — pack упакует dist/ с диска, а prepublishOnly
  // на pack НЕ срабатывает (только на publish); gitignored dist/ мог быть
  // удалён или устареть.
  console.log('▶ pnpm build…');
  const build = run('pnpm', ['build'], { cwd: repoRoot });
  check('pnpm build', build.code === 0, build.code !== 0 ? build.out.slice(-200) : '');
  if (build.code !== 0) throw new Error('Сборка не прошла — smoke дальше бессмыслен');

  // ── Шаг 1: npm pack → tarball в tmp.
  // Каталог назначения npm НЕ создаёт сам (ENOENT) — создаём явно.
  mkdirSync(tarballDir, { recursive: true });
  console.log('▶ npm pack…');
  const pack = run('npm', ['pack', '--pack-destination', tarballDir], { cwd: repoRoot });
  const tarballName = pack.stdout.trim().split('\n').pop();
  const tarballPath = join(tarballDir, tarballName);
  check('npm pack создаёт tarball', pack.code === 0 && existsSync(tarballPath), tarballName);

  // ── Шаг 2: чистая установка в /tmp (офлайн: у пакета нет runtime-зависимостей).
  console.log('▶ npm install <tarball>…');
  mkdirSync(installDir, { recursive: true });
  const init = run('npm', ['init', '-y'], { cwd: installDir });
  const install = run('npm', ['install', tarballPath, '--no-audit', '--no-fund'], { cwd: installDir });
  check('установка в чистый каталог', init.code === 0 && install.code === 0,
    install.code !== 0 ? install.out.slice(-200) : '');

  const bin = join(installDir, 'node_modules', '.bin', 'vibelog');
  check('бин vibelog создан', existsSync(bin));

  // ── Шаг 3: реальный прогон CLI из установленного пакета.
  console.log('▶ vibelog --help…');
  const help = run(bin, ['--help']);
  check('vibelog --help', help.code === 0 && help.out.includes('vibelog'));

  console.log('▶ vibelog init…');
  mkdirSync(projectDir, { recursive: true });
  const initRun = run(bin, ['init', 'Smoke Project'], { cwd: projectDir });
  check('init создаёт backlog/config.yml', existsSync(join(projectDir, 'backlog', 'config.yml')));
  check('init создаёт backlog/tasks/', existsSync(join(projectDir, 'backlog', 'tasks')));
  if (initRun.code !== 0 || !existsSync(join(projectDir, 'backlog', 'config.yml'))) {
    console.log('  вывод init:', initRun.out.slice(-300));
  }

  console.log('▶ task create + list…');
  const create = run(bin, ['task', 'create', 'Smoke Тест'], { cwd: projectDir });
  const list = run(bin, ['task', 'list'], { cwd: projectDir });
  check('task create/list: задача в выводе', create.code === 0 && list.out.includes('Smoke Тест'),
    list.code !== 0 ? list.out.slice(-200) : '');

  console.log('▶ vibelog browser (React UI из web/dist)…');
  if (existsSync(bin)) {
    server = spawn(bin, ['browser', '--no-open', '--port', String(PORT)], { cwd: projectDir, stdio: 'pipe' });
    // Без обработчика unhandled 'error' (ENOENT) роняет весь скрипт вместо FAIL-пункта
    server.on('error', (err) => console.log('  spawn browser error:', err.message));
  }
  const index = await waitForServer(`http://127.0.0.1:${PORT}/`);
  const indexText = index ? await index.text() : '';
  // Маркер React-приложения (Vite index.html); inline-фолбэк его не содержит
  check('browser отдаёт React UI (id="root")', !!index && indexText.includes('id="root"'),
    index ? '' : 'сервер не поднялся');
  const api = await fetch(`http://127.0.0.1:${PORT}/api/tasks`).catch(() => null);
  const apiText = api ? await api.json() : null;
  check('browser: /api/tasks → JSON-массив', !!api && api.ok && Array.isArray(apiText));

  // ── Шаг 4: содержимое установленного пакета.
  console.log('▶ содержимое пакета…');
  const pkg = join(installDir, 'node_modules', 'vibelog.md');
  for (const phase of ['phase-1', 'phase-2', 'phase-3']) {
    const p = join(pkg, 'templates', 'qwen-commands', `${phase}.md`);
    check(`шаблон оркестратора ${phase}.md читается`, existsSync(p));
  }
  check('web/dist/index.html в пакете', existsSync(join(pkg, 'web', 'dist', 'index.html')));
  check('backlog/ НЕ в пакете', !existsSync(join(pkg, 'backlog')));
  check('.qwen НЕ в пакете', !existsSync(join(pkg, '.qwen')));
} finally {
  if (server) server.kill();
  rmSync(testRoot, { recursive: true, force: true });
}

// ── Итог ──
const failed = results.filter(r => !r.ok);
console.log(`\nИтог: ${results.length - failed.length}/${results.length} PASS`);
if (failed.length > 0) {
  console.error(`Провалены: ${failed.map(f => f.name).join('; ')}`);
  process.exit(1);
}
