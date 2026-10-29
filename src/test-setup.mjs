/**
 * Глобальные guard'ы от реальной сети в тестах (VL-132 fetch, VL-226 spawn).
 *
 * Подключается через `setupFiles` в vitest.config.mts (VL-133):
 *   test: { setupFiles: ['./src/test-setup.mjs'] }
 * В vitest каждый тест-файл выполняется в изолированном воркере, где
 * setup-файл запускается до тестов — guard активен в каждом тест-файле
 * без правок самих файлов. (Раньше — через --import в node --test.)
 *
 * Fetch-guard (VL-132): заменяет globalThis.fetch на обёртку, которая падает
 * с ошибкой при попытке fetch к не-loopback хосту. Любой реальный сетевой
 * вызов в тестах становится fail-fast вместо тихого обхода.
 * Loopback (127.0.0.1, ::1, localhost) разрешён — на нём работают
 * мок-LLM (src/agent/cli.test.mjs) и веб-тесты (src/web/static.test.mjs).
 *
 * Spawn-guard (VL-226): патчит функции node:child_process (spawnSync,
 * execSync, spawn, exec, execFile и sync-варианты) — команда git/npm с
 * сетевым URL в аргументах (http://, https://, git@) падает с ошибкой
 * [VL-226] ДО запуска процесса вместо многоминутного ожидания зависшего
 * clone на офлайн-DNS. Loopback-URL и file://-клонирование разрешены
 * (мок-серверы и локальные фикстуры reference.test.mjs).
 *
 * Env-гарда нет намеренно: fail-fast на вызове точнее, чем подмена env
 * (http_proxy/GIT_ALLOW_PROTOCOL) — тест сразу видит причину и стек
 * вызова, а не «странную» сетевую ошибку git через несколько минут.
 * Для exec/execSync сканируется вся командная строка (первый аргумент),
 * для spawn/execFile — массив аргументов; обёртка ничего не возвращает
 * вместо оригинала, поэтому `spawn` по-прежнему отдаёт ChildProcess.
 *
 * Прямые вызовы child_process (npm view в update-check, spawn CLI)
 * fetch-guard не ловит — их прикрывает spawn-guard и env-гард
 * VIBELOG_SKIP_UPDATE_CHECK в хелперах тестов (см. аудит в VL-132).
 *
 * Оба guard'а идемпотентны: повторный import (или двойной --import)
 * не портит обёртки — оригиналы сохраняются ровно один раз.
 */

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** Маркер уже установленного guard'а (для идемпотентности). */
const GUARD_MARK = Symbol.for('vibelog.test.noNetworkGuard');

/** Хосты, на которым fetch в тестах разрешён (локальные мок-серверы). */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

const originalFetch = globalThis.fetch;

// Guard уже стоит (повторный --import / import в тесте) — не патчим заново,
// иначе вложенные обёртки будут перепроверять URL дважды и путать стек
if (originalFetch && !originalFetch[GUARD_MARK]) {
  /** Обёртка fetch с fail-fast на не-loopback адреса (async — throw = rejection). */
  const guardedFetch = async function guardedFetch(input, init) {
    // URL может прийти строкой, URL-объектом или Request — приводим к строке
    const raw =
      typeof input === 'string'
        ? input
        : input && typeof input === 'object' && 'url' in input
          ? String(input.url)
          : String(input);
    let host = null;
    try {
      // Некорректный URL отдаём оригинальному fetch — он сам бросит TypeError
      host = new URL(raw).hostname;
    } catch {
      host = null;
    }
    // host === null — не URL (например, относительная строка): пропускаем
    // дальше, оригинальный fetch корректно откажет без сети
    if (host !== null && !LOOPBACK_HOSTS.has(host)) {
      throw new Error(
        `[VL-132] тест пытается сделать fetch к не-loopback хосту "${host}" — реальная сеть в тестах запрещена`,
      );
    }
    return originalFetch(input, init);
  };
  guardedFetch[GUARD_MARK] = true;
  globalThis.fetch = guardedFetch;
}

// ============================================================
// Spawn-guard (VL-226): сетевые команды через child_process
// ============================================================

/** Маркер установленного spawn-guard'а (идемпотентность). */
const SPAWN_GUARD_MARK = Symbol.for('vibelog.test.spawnGuard');

/**
 * Хосты, на которых spawn сетевых протоколов разрешён (мок-серверы).
 * Зеркалит LOOPBACK_HOSTS fetch-guard'а.
 */
const SPAWN_LOOPBACK = new Set(['127.0.0.1', '::1', 'localhost', '[::1]']);

const cp = require('node:child_process');

// Guard уже стоит (повторный import) — не патчим заново, иначе вложенные
// обёртки будут перепроверять аргументы и портить стек ошибок
if (!cp[SPAWN_GUARD_MARK]) {
  /**
   * Извлекает из аргументов команды первый сетевой URL (http/https/git@),
   * не относящийся к loopback, либо null, если сети в аргументах нет.
   *
   * Критерий (VL-226): git/npm-подобные команды с http(s)://-URL или
   * scp-синтаксисом git@host:path — потенциально уходят в реальную сеть.
   * file://, loopback-URL и аргументы без URL проходят мимо guard'а.
   *
   * URL ищем в любом месте строки, а не только в начале: командная строка
   * exec('git -C dir clone https://…') приходит одним аргументом.
   */
  const findNetworkTarget = (cmd, args) => {
    // Некетевые команды (node, tsc, git без URL и т.п.) не проверяем:
    // cmd может быть и абсолютным путём (process.execPath).
    // Первый токен обязателен: у exec/execSync cmd — вся командная строка
    // ('git -C dir clone https://…'), иначе base-проверка не сработает
    const firstToken = String(cmd).trim().split(/\s+/)[0] || '';
    const base = firstToken.split('/').pop();
    if (!/^(git|git\.exe|npm|npm\.cmd|yarn|pnpm|bun)$/.test(base)) return null;
    for (const a of args) {
      const s = String(a);
      // scp-синтаксис git@host:path — внешний хост
      const scp = s.match(/git@([^/:\s]+):/);
      if (scp && !SPAWN_LOOPBACK.has(scp[1])) return s;
      // http(s)-URL: loopback разрешён (локальные git-серверы в тестах)
      for (const m of s.matchAll(/https?:\/\/([^/\s]+)/gi)) {
        const host = m[1].split('@').pop().split(':')[0];
        if (!SPAWN_LOOPBACK.has(host)) return s;
      }
    }
    return null;
  };

  /**
   * Оборачивает функцию child_process: при сетевом URL в аргументах бросает
   * ошибку [VL-226] ДО вызова оригинала (fail-fast — секунды вместо
   * многоминутного ожидания зависшего clone).
   *
   * ВАЖНО: обёртка НИКОГДА не превращает синхронный результат в Promise —
   * `spawn` обязан вернуть ChildProcess (иначе `.on`/`.kill` у вызывающего
   * кода ломаются). Поэтому при обнаружении сети просто `throw` и из
   * sync-, и из async-вариантов: throw на месте spawn-вызова для теста —
   * это ровно тот fail-fast, который нужен (инцидент: async-обёртка
   * превратила spawn в Promise и уронила 130 тестов web/agent/bot).
   *
   * Call-site первого аргумента (cmd) сохраняется — stack ведёт на тест.
   *
   * mode='cmdline' — для exec/execSync: их первый аргумент (cmd) и есть
   * вся командная строка ('git clone https://…'), поэтому сканируем её,
   * а не rest[0] (там options).
   */
  const wrap = (name, scanCmdline) => {
    const orig = cp[name];
    if (typeof orig !== 'function') return;
    cp[name] = function guarded(cmd, ...rest) {
      // cmd как команда проверяется всегда (опционально в режиме cmdline);
      // при args-режиме cmd — имя программы, а URL живёт в массиве args
      const target = findNetworkTarget(cmd, [
        ...(scanCmdline ? [String(cmd)] : []),
        ...(Array.isArray(rest[0]) ? rest[0] : []),
      ]);
      if (target) {
        throw new Error(
          `[VL-226] тест пытается выполнить сетевую команду: ${cmd} ${target} — реальная сеть в тестах запрещена`,
        );
      }
      return orig.call(cp, cmd, ...rest);
    };
  };

  // spawn/spawnSync/execFile/execFileSync: URL — в массиве аргументов;
  // exec/execSync: URL — в командной строке (первый аргумент целиком)
  wrap('spawnSync', false);
  wrap('spawn', false);
  wrap('execFile', false);
  wrap('execFileSync', false);
  wrap('exec', true);
  wrap('execSync', true);

  cp[SPAWN_GUARD_MARK] = true;
}
