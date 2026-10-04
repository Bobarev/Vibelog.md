#!/usr/bin/env node
// scripts/clone-refs.mjs — скрипт разработчика для клонирования референсных
// проектов в refs/ (VL-76). Папка refs/ в .gitignore: клоны локальные.
//
// Зачем: референсы (Backlog.md, vibe-kanban, MCP SDK и др.) используются как
// источники знаний при разработке Vibelog.md. Каждый разработчик клонирует их
// локально одной командой: node scripts/clone-refs.mjs
//
// Принципы:
// - только git clone --depth 1, БЕЗ install/build (референсы читаются, не запускаются);
// - идемпотентность: уже существующие refs/<dir> пропускаются;
// - одна ошибка не прерывает общий запуск (счётчик ошибок, exitCode = 1 в конце);
// - чистый Node.js, без зависимостей (правило проекта).

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Корень проекта — родитель каталога scripts/ (не зависит от cwd запуска)
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const refsDir = join(root, 'refs');

// Полный список референсов: 3 существующих (перенесены Pavel в refs/) + 9 новых.
// URL существующих взяты из их .git/config; новые — из задачи VL-76.
const REPOS = [
  { dir: 'Backlog.md', url: 'https://github.com/MrLesk/Backlog.md.git' },
  { dir: 'next-shadcn-admin-dashboard', url: 'https://github.com/arhamkhnz/next-shadcn-admin-dashboard.git' },
  { dir: 'vibe-kanban', url: 'https://github.com/BloopAI/vibe-kanban.git' },
  { dir: 'typescript-sdk', url: 'https://github.com/modelcontextprotocol/typescript-sdk.git' },
  { dir: 'mastra', url: 'https://github.com/mastra-ai/mastra.git' },
  { dir: 'pi', url: 'https://github.com/earendil-works/pi.git' },
  { dir: 'gemini-cli', url: 'https://github.com/google-gemini/gemini-cli.git' },
  { dir: 'opencode', url: 'https://github.com/anomalyco/opencode.git' },
  { dir: 'cline', url: 'https://github.com/cline/cline.git' },
  { dir: 'hermes-agent', url: 'https://github.com/NousResearch/hermes-agent.git' },
  { dir: 'openclaw', url: 'https://github.com/openclaw/openclaw.git' },
  // Qwen Code — текущий целевой агент Vibelog (spawn оркестратором); фолбэк для нового агента VL-75
  { dir: 'qwen-code', url: 'https://github.com/QwenLM/qwen-code.git' },
];

mkdirSync(refsDir, { recursive: true });

let cloned = 0;
let skipped = 0;
let failed = 0;

for (const { dir, url } of REPOS) {
  const target = join(refsDir, dir);
  // Идемпотентность: папка существует (в т.ч. неполный клон после прерывания) — пропуск.
  // Полное восстановление прерванного клона — вручную (rm + повторный запуск).
  if (existsSync(target)) {
    console.log(`Пропуск: refs/${dir} уже существует`);
    skipped += 1;
    continue;
  }
  console.log(`Клонирование: ${url} → refs/${dir}`);
  const res = spawnSync('git', ['clone', '--depth', '1', url, target], {
    stdio: 'inherit',
    cwd: root,
  });
  if (res.status === 0) {
    cloned += 1;
  } else {
    // Ошибка одного репозитория не должна прерывать остальные — повторный
    // запуск доклонит недостающее (идемпотентность).
    console.error(`ОШИБКА: не удалось склонировать ${url} (код ${res.status})`);
    failed += 1;
  }
}

console.log(`\nИтог: склонировано ${cloned}, пропущено ${skipped}, ошибок ${failed}`);
if (failed > 0) {
  console.error('Часть репозиториев не склонирована — проверьте сеть и запустите скрипт повторно.');
  process.exitCode = 1;
}
