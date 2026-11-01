/**
 * Тесты VL-152 — CLI vibelog reference (все подкоманды).
 *
 * Спавнят CLI (bin/vibelog.mjs) во временном каталоге с backlog/.
 * Clone/sync — только локальный file://-репозиторий (без сети).
 */

import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync, spawn } from 'node:child_process';
import { stringifyYaml } from '../../dist/core/yaml.js';
import { testSpawnEnv } from '../test-env.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, '..', '..', 'bin', 'vibelog.mjs');
const testRoot = mkdtempSync(join(tmpdir(), 'vibelog-cli-reference-test-'));
const backlogDir = join(testRoot, 'backlog');

const gitEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const remoteDir = join(testRoot, 'remote-src');

/** Запуск CLI; возвращает { status, stdout, stderr }. */
function runCli(args, env = {}) {
  const res = spawnSync('node', [cliPath, ...args], {
    cwd: testRoot, encoding: 'utf-8',
    env: testSpawnEnv({ ...gitEnv, ...env }),
  });
  return { status: res.status, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

/**
 * Асинхронный запуск CLI — для тестов с loopback-HTTP-сервером в этом же
 * процессе: spawnSync замораживает event loop, и сервер не смог бы
 * отвечать на запросы дочернего процесса (VL-194).
 */
function runCliAsync(args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', [cliPath, ...args], {
      cwd: testRoot,
      env: testSpawnEnv({ ...gitEnv, ...env }),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}

beforeAll(() => {
  mkdirSync(join(backlogDir, 'tasks'), { recursive: true });
  // Минимальный конфиг — нужен task create (тесты link)
  writeFileSync(join(backlogDir, 'config.yml'), stringifyYaml({
    project_name: 'Test',
    task_prefix: 'tst',
    default_status: 'To Do',
    statuses: ['To Do', 'In Progress', 'Done'],
    definition_of_done: [],
  }), 'utf-8');
  mkdirSync(remoteDir, { recursive: true });
  writeFileSync(join(remoteDir, 'data.txt'), 'x\n');
  const git = (args) => {
    const res = spawnSync('git', args, { cwd: remoteDir, encoding: 'utf-8', env: gitEnv });
    assert.equal(res.status, 0, `git ${args.join(' ')}: ${res.stderr}`);
  };
  git(['init']);
  git(['add', '.']);
  git(['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-m', 'init', '--no-gpg-sign']);
});

afterAll(() => {
  rmSync(testRoot, { recursive: true, force: true });
});

describe('VL-152 CLI — add/view/list/search', () => {
  it('add: без backlog → ошибка', () => {
    const empty = mkdtempSync(join(tmpdir(), 'vl152-empty-'));
    try {
      const res = spawnSync('node', [cliPath, 'reference', 'list'], {
        cwd: empty, encoding: 'utf-8',
        env: testSpawnEnv(gitEnv),
      });
      assert.notEqual(res.status, 0);
      assert.match((res.stdout ?? '') + (res.stderr ?? ''), /Backlog не найден/);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('add url-reference → view → list → search', () => {
    const add = runCli(['reference', 'add', 'Node fs API', '--type', 'url', '--url', 'https://nodejs.org/api/fs.html', '--tags', 'node,docs', '-d', 'Документация fs']);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /Reference ref-1 создан/);

    const view = runCli(['reference', 'view', 'ref-1']);
    assert.equal(view.status, 0);
    assert.match(view.stdout, /Node fs API/);
    assert.match(view.stdout, /url: https:\/\/nodejs\.org/);
    assert.match(view.stdout, /Документация fs/);

    const list = runCli(['reference', 'list']);
    assert.match(list.stdout, /ref-1\s+Node fs API/);

    const search = runCli(['reference', 'search', 'nodejs']);
    assert.match(search.stdout, /ref-1/);
  });

  it('list --type фильтрует; view несуществующего → exit 1', () => {
    runCli(['reference', 'add', 'Spec doc', '--type', 'spec', '--path', 'docs/spec.md']);
    const list = runCli(['reference', 'list', '--type', 'spec']);
    assert.match(list.stdout, /Spec doc/);
    assert.doesNotMatch(list.stdout, /Node fs API/);

    const missing = runCli(['reference', 'view', 'ref-999']);
    assert.equal(missing.status, 1);
    assert.match(missing.stdout + missing.stderr, /не найден/);
  });

  it('add с невалидным типом → exit 1', () => {
    const res = runCli(['reference', 'add', 'Bad', '--type', 'nope']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /Недопустимый тип reference/);
  });
});

describe('VL-152 CLI — clone (add --type repo) и sync', () => {
  const url = 'file://' + remoteDir;

  it('add --type repo сам клонирует; --no-clone пропускает', () => {
    const add = runCli(['reference', 'add', 'Local repo', '--type', 'repo', '--url', url, '--path', 'data/cli-repo']);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /клонирован/);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-repo', 'data.txt')));

    const add2 = runCli(['reference', 'add', 'No clone repo', '--type', 'repo', '--url', url, '--path', 'data/cli-no-clone', '--no-clone']);
    assert.equal(add2.status, 0, add2.stderr);
    assert.ok(!existsSync(join(backlogDir, 'references', 'data', 'cli-no-clone')), 'клон не создан');
  });

  it('sync доклонировал отсутствующий и пропустил существующий', () => {
    const sync = runCli(['reference', 'sync']);
    assert.equal(sync.status, 0, sync.stderr);
    assert.match(sync.stdout, /Клонировано: 1, пропущено: 1, ошибок: 0/);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-no-clone', 'data.txt')));
  });

  it('повторный add идемпотентен (уже клонирован → пропуск)', () => {
    const add = runCli(['reference', 'add', 'Local repo again', '--type', 'repo', '--url', url, '--path', 'data/cli-repo']);
    assert.equal(add.status, 0);
    assert.match(add.stdout, /уже клонирован/);
  });
});

// ── VL-194: локальный markdown-кэш (add --cache, sync <id>/--all) ──

describe('VL-194 CLI — кэш: add --cache, view, sync', () => {
  /** Loopback-сервер: guard VL-132 пропускает только 127.0.0.1. */
  let server;
  let base;
  /** Текущее «содержимое страницы» — меняем между тестами для смены hash. */
  let pageBody;

  beforeAll(async () => {
    const http = await import('node:http');
    pageBody = '<html><head><title>Doc</title></head><body><header>nav</header><h1>Док</h1><p>v1</p></body></html>';
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(pageBody);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('add --cache скачивает HTML → cache/<id>.md, view печатает кэш', async () => {
    const add = await runCliAsync(['reference', 'add', 'Cached doc', '--type', 'doc', '--url', `${base}/doc`, '--cache']);
    assert.equal(add.status, 0, add.stderr);
    assert.match(add.stdout, /Reference ref-\d+ создан/);
    assert.match(add.stdout, /закэшировано/, add.stdout);

    // id узнаём из list (номер зависит от порядка тестов файла)
    const list = await runCliAsync(['reference', 'list', '--type', 'doc']);
    const id = list.stdout.match(/(ref-\d+)\s+Cached doc/)?.[1];
    assert.ok(id, `id не найден в list: ${list.stdout}`);

    const cacheFile = join(backlogDir, 'references', 'cache', `${id}.md`);
    assert.ok(existsSync(cacheFile), 'файл кэша создан');
    const md = readFileSync(cacheFile, 'utf-8');
    assert.ok(md.includes('# Док'), `markdown: ${md}`);
    assert.ok(!md.includes('nav'), 'header/nav вычищен');
    assert.ok(!md.includes('<'), 'HTML-тегов нет');

    const view = await runCliAsync(['reference', 'view', id]);
    assert.equal(view.status, 0, view.stderr);
    assert.match(view.stdout, /Кэш \(/, 'view печатает блок кэша');
    assert.match(view.stdout, /# Док/, 'view печатает markdown кэша');
    assert.match(view.stdout, new RegExp(`кэш: references/cache/${id}`), 'метаданные кэша в шапке');
  });

  it('sync <id>: hash совпал → без изменений; тело изменилось → обновление', async () => {
    const list = await runCliAsync(['reference', 'list', '--type', 'doc']);
    const id = list.stdout.match(/(ref-\d+)\s+Cached doc/)?.[1];
    assert.ok(id);

    const sync1 = await runCliAsync(['reference', 'sync', id]);
    assert.equal(sync1.status, 0, sync1.stderr);
    assert.match(sync1.stdout, /без изменений/, sync1.stdout);

    pageBody = '<html><body><h1>Док</h1><p>v2</p></body></html>';
    try {
      const sync2 = await runCliAsync(['reference', 'sync', id]);
      assert.equal(sync2.status, 0, sync2.stderr);
      assert.match(sync2.stdout, /кэш обновлён/, sync2.stdout);
      const md = readFileSync(join(backlogDir, 'references', 'cache', `${id}.md`), 'utf-8');
      assert.ok(md.includes('v2'), `после обновления: ${md}`);
    } finally {
      pageBody = '<html><head><title>Doc</title></head><body><header>nav</header><h1>Док</h1><p>v1</p></body></html>';
    }
  });

  it('sync несуществующего id → exit 1, понятная ошибка', async () => {
    const res = await runCliAsync(['reference', 'sync', 'ref-999']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /не найден/);
  });

  it('sync без аргументов — прежнее поведение: только клоны, без кэша', async () => {
    const sync = await runCliAsync(['reference', 'sync']);
    assert.equal(sync.status, 0, sync.stderr);
    // Строка итогов кэша НЕ печатается (обратная совместимость вывода)
    assert.ok(!/Кэш обновлено/.test(sync.stdout), sync.stdout);
    assert.match(sync.stdout, /Клонировано:/);
  });

  it('add --cache без url → exit 1 с понятной ошибкой', async () => {
    const res = await runCliAsync(['reference', 'add', 'No url doc', '--type', 'doc', '--cache']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /нужен --url/);
  });
});

describe('VL-152 CLI — link и remove', () => {
  it('link: двусторонняя связь с задачей; --remove отвязывает', () => {
    runCli(['task', 'create', 'Задача CLI-связи']);
    const list = runCli(['task', 'list', '--json']);
    const tasks = JSON.parse(list.stdout).data;
    const taskId = tasks[0].id;

    const link = runCli(['reference', 'link', 'ref-1', taskId]);
    assert.equal(link.status, 0, link.stderr);
    assert.match(link.stdout, /связан/);

    const view = runCli(['reference', 'view', 'ref-1']);
    assert.match(view.stdout, new RegExp(`linked_tasks: ${taskId}`));

    const unlink = runCli(['reference', 'link', 'ref-1', taskId, '--remove']);
    assert.equal(unlink.status, 0);
    const view2 = runCli(['reference', 'view', 'ref-1']);
    assert.match(view2.stdout, /linked_tasks: \(нет\)/);
  });

  it('link несуществующего reference → exit 1', () => {
    const res = runCli(['reference', 'link', 'ref-999', 'VL-1']);
    assert.equal(res.status, 1);
    assert.match(res.stdout + res.stderr, /не найден/);
  });

  it('remove: удаляет метаданные, клон в data/ сохраняется', () => {
    const rm = runCli(['reference', 'remove', 'ref-2']);
    assert.equal(rm.status, 0, rm.stderr);
    const view = runCli(['reference', 'view', 'ref-2']);
    assert.equal(view.status, 1);
    assert.ok(existsSync(join(backlogDir, 'references', 'data', 'cli-repo', 'data.txt')), 'клон сохранён');
  });
});

// ── VL-291: несколько ссылок у reference типа url ──
describe('VL-291 CLI — несколько url в одном кэше', () => {
  /** Loopback-сервер: /one и /two отдают HTML, /broken — 500 (частичный сбой). */
  let server;
  let base;

  beforeAll(async () => {
    const http = await import('node:http');
    server = http.createServer((req, res) => {
      if (req.url === '/broken') {
        res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
        res.end('boom');
        return;
      }
      const title = req.url === '/two' ? 'Второй' : 'Первый';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(`<html><body><h1>${title}</h1></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  afterAll(async () => {
    if (server) await new Promise(resolve => server.close(resolve));
  });

  it('add --url A --url B --cache → один md, секции в порядке ссылок', async () => {
    const add = await runCliAsync([
      'reference', 'add', 'Multi doc', '--type', 'url',
      '--url', `${base}/one`, '--url', `${base}/two`, '--cache',
    ]);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    assert.match(add.stdout, /ссылок: 2/);

    const list = await runCliAsync(['reference', 'list', '--type', 'url']);
    const id = list.stdout.match(/(ref-\d+)\s+Multi doc/)?.[1];
    assert.ok(id, `id не найден: ${list.stdout}`);

    const md = readFileSync(join(backlogDir, 'references', 'cache', `${id}.md`), 'utf-8');
    const i1 = md.indexOf('/one');
    const i2 = md.indexOf('/two');
    assert.ok(i1 >= 0 && i2 > i1, `порядок секций: ${md}`);
    assert.match(md, /Первый/);
    assert.match(md, /Второй/);

    const view = await runCliAsync(['reference', 'view', id]);
    assert.match(view.stdout, /url: .*\/one/);
    assert.match(view.stdout, /url\[2\]: .*\/two/, 'view печатает доп. ссылку');
  });

  it('частичный сбой: --url broken + --url ok → exit 1 и «частичный успех», кэш записан', async () => {
    const add = await runCliAsync([
      'reference', 'add', 'Partial doc', '--type', 'url',
      '--url', `${base}/broken`, '--url', `${base}/one`, '--cache',
    ]);
    assert.equal(add.status, 1, add.stdout + add.stderr);
    const out = add.stdout + add.stderr;
    assert.match(out, /частичный успех/, out);

    const list = await runCliAsync(['reference', 'list', '--type', 'url']);
    const id = list.stdout.match(/(ref-\d+)\s+Partial doc/)?.[1];
    assert.ok(id, `id не найден: ${list.stdout}`);
    const md = readFileSync(join(backlogDir, 'references', 'cache', `${id}.md`), 'utf-8');
    assert.match(md, /Ошибка загрузки/);
    assert.match(md, /Первый/, 'успешная ссылка закэширована');
  });

  it('одиночный --url остаётся совместимым (без секций-заголовков)', async () => {
    const add = await runCliAsync([
      'reference', 'add', 'Single doc', '--type', 'url', '--url', `${base}/one`, '--cache',
    ]);
    assert.equal(add.status, 0, add.stdout + add.stderr);
    assert.doesNotMatch(add.stdout, /ссылок: \d/, 'для одной ссылки счётчик не печатается');

    const list = await runCliAsync(['reference', 'list', '--type', 'url']);
    const id = list.stdout.match(/(ref-\d+)\s+Single doc/)?.[1];
    assert.ok(id);
    const md = readFileSync(join(backlogDir, 'references', 'cache', `${id}.md`), 'utf-8');
    assert.doesNotMatch(md, /^## /m, 'одиночная ссылка — прежний формат без секции');
    assert.match(md, /Первый/);
  });
});
