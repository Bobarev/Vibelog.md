/**
 * Async-эндпоинты синхронизации references (VL-358) — сеть, поэтому вне
 * синхронного handleApi.
 *
 * Эндпоинты:
 * - POST /api/references/sync — общий sync: доклонировать отсутствующие
 *   репозитории (type=repo) И обновить markdown-кэш url/doc/spec-референсов;
 * - POST /api/references/:id/sync — поштучный sync одного reference
 *   (repo → клон, url/doc/spec → refresh кэша).
 *
 * Почему отдельный модуль, а не handleApi: обновление кэша скачивает URL
 * (`downloadText` → fetch) и потому асинхронно, а handleApi синхронный
 * (прецедент — catalog-api.ts, VL-316). server.ts пробует этот обработчик
 * ДО синхронного handleApi, `null` означает «URL не наш».
 *
 * Форма ответа общего sync additive-совместима с прежним SyncResult
 * (cloned/skipped/failed в корне) — старый фронт продолжает работать;
 * итог кэша добавлен отдельным полем cache.
 *
 * Сеть инжектируется (`deps.fetchFn`) — юнит-тесты работают без реальной
 * сети (guard VL-132 в src/test-setup.mjs отклоняет не-loopback).
 */

import {
  getReference,
  syncReferenceRepos,
  cloneReferenceRepo,
} from '../core/reference.js';
import {
  refreshReferenceCache,
  syncReferenceCaches,
} from '../core/reference-cache.js';
import type { CacheDeps, CacheSyncResult } from '../core/reference-cache.js';
import type { ApiResponse } from './api.js';

/** Зависимости для тестов: подменяемый fetch (пробрасывается в core). */
export type ReferencesSyncDeps = CacheDeps;

/**
 * Делает сообщение о сетевой ошибке человекочитаемым (AC5).
 *
 * GitVerse при анонимном raw-доступе отвечает 429 Too Many Requests —
 * пользователю это ни о чём не говорит, поэтому добавляем подсказку.
 * Исходный текст сохраняем (в нём url/статус), тексты core не меняем:
 * на них завязаны существующие тесты reference-cache.test.mjs.
 */
export function humanizeSyncError(text: string): string {
  if (/\b429\b/.test(text)) {
    return `лимит запросов GitVerse (HTTP 429), повторите позже — ${text}`;
  }
  return text;
}

/** Прогоняет тексты ошибок кэша через humanize (частичный сбой не теряется). */
function humanizeCacheResult(cache: CacheSyncResult): CacheSyncResult {
  return {
    ...cache,
    failed: cache.failed.map(f => ({ id: f.id, error: humanizeSyncError(f.error) })),
  };
}

/**
 * Обрабатывает sync-запросы references.
 *
 * @param method — HTTP-метод
 * @param url — путь URL (без query string)
 * @param body — тело запроса (sync его не использует; может отсутствовать)
 * @param cwd — рабочая директория проекта
 * @param deps — инжектируемый fetch для тестов
 * @returns ApiResponse либо null — «URL не наш», решает handleApi
 */
export async function handleReferencesSyncApi(
  method: string,
  url: string,
  body: Record<string, unknown> | null,
  cwd: string,
  deps: ReferencesSyncDeps = {},
): Promise<ApiResponse | null> {
  void body;

  // Общий sync: клоны репозиториев + кэши url/doc.
  // ВАЖНО: точное совпадение ДО :id-роута — иначе 'sync' матчится как id
  // (инцидент transient-404 из VL-174, lesson-22).
  if (method === 'POST' && url === '/api/references/sync') {
    // syncReferenceRepos синхронный (spawnSync git clone) — долгое клонирование
    // блокирует event loop; для локального инструмента это приемлемо (как CLI).
    const repos = syncReferenceRepos(cwd);
    const cache = humanizeCacheResult(await syncReferenceCaches(cwd, { all: true }, deps));
    // cloned/skipped/failed остаются в корне — additive-совместимость с SyncResult
    return { status: 200, body: { ...repos, cache } };
  }

  // Поштучный sync одного reference.
  const singleMatch = url.match(/^\/api\/references\/([^/]+)\/sync$/);
  if (method === 'POST' && singleMatch) {
    const id = decodeURIComponent(singleMatch[1]);
    const entry = getReference(cwd, id);
    if (!entry) return { status: 404, body: { error: 'Reference не найден' } };
    const ref = entry.reference;

    if (ref.type === 'repo') {
      const res = cloneReferenceRepo(cwd, ref);
      // Перечитываем: клон не меняет метаданные, но контракт ответа единый
      const updated = getReference(cwd, ref.id);
      return {
        status: 200,
        body: {
          reference: updated?.reference ?? ref,
          cloned: { ok: res.cloned, message: res.message },
        },
      };
    }

    const res = await refreshReferenceCache(cwd, ref, deps);
    const updated = getReference(cwd, ref.id);
    return {
      status: 200,
      body: {
        // После refresh в метаданных свежие cached_at/source_hash/cached_path —
        // фронт показывает их без второго запроса
        reference: updated?.reference ?? ref,
        cache: {
          status: res.status,
          updated: res.updated,
          message: humanizeSyncError(res.message),
        },
      },
    };
  }

  return null;
}
