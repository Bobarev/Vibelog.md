---
id: VL-210
title: 'init: интерактивный wizard настройки проекта (консольный + web /setup)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 10:21'
updated_date: '2026-11-03 22:30'
due_date: ''
labels:
  - cli
  - web
dependencies: []
milestone: v1.12
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/core/setup.ts
  - src/core/setup-secrets.ts
  - src/core/setup-mcp.ts
  - src/core/setup-check.ts
  - src/core/setup.test.mjs
  - src/core/setup-secrets.test.mjs
  - src/core/setup-check.test.mjs
  - src/cli/commands/init-wizard.ts
  - src/cli/commands/init.ts
  - src/cli/init-wizard.test.mjs
  - src/cli/router.ts
  - src/web/setup-api.ts
  - src/web/setup-api.test.mjs
  - src/web/api.ts
  - src/web/server.ts
  - web/src/App.tsx
  - web/src/lib/use-hash-route.ts
  - web/src/components/layout/app-sidebar.tsx
  - web/src/components/setup/api.ts
  - web/src/components/setup/setup-page.tsx
  - web/dist/index.html
  - web/dist/assets/index-CH6F2k_s.css
  - web/dist/assets/index-Qyrdhbt9.js
lessons:
  - lesson-172
token_usage:
  input: 20159331
  output: 108227
  cache: 19643776
  total: 20267558
  requests: 225
  duration_ms: 1632574
  reasoning: 28978
  by_phase:
    spec:
      input: 82149
      output: 2758
      cache: 53632
      requests: 3
    plan:
      input: 2316378
      output: 17866
      cache: 2233856
      requests: 37
    code:
      input: 15755615
      output: 78313
      cache: 15407616
      requests: 150
    close:
      input: 2005189
      output: 9290
      cache: 1948672
      requests: 35
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас vibelog init создаёт только backlog/ и settings.json с дефолтами. Не настраивает: агента(ов), LLM (провайдер, модель), где хранить ключи, Telegram-бота, MCP. Новый пользователь не понимает, что делать дальше.

Нужен интерактивный wizard: консольный (readline) + web (/setup при первом запуске). Порядок вопросов — от агента(ов) к LLM (если vb) и боту. Wizard работает в двух режимах: fresh init (нет backlog/) и upgrade/migrate (backlog/ уже есть).

## Режимы работы

### Режим fresh init
backlog/ нет. Wizard создаёт с нуля: backlog/, backlog/config.yml, .vibelog/settings.json, AGENTS.md, .env (если выбран).

### Режим upgrade/migrate
backlog/ уже есть (проект уже использовал Backlog.md или Vibelog.md). Wizard:
- Читает существующий backlog/config.yml (project_name, task_prefix, statuses, labels, types, priorities, definition_of_done, workflows).
- Читает существующий .vibelog/settings.json (если есть: providers, models, workflows, task_workflows, chats, default_agent, env, mcpServers, branch_mode, compact, code_same_session, git_user_name).
- Показывает текущие значения как дефолты (Enter — оставить, изменить — ввести новое).
- НЕ перезаписывает существующие задачи, docs, lessons, references, decisions, milestones, completed/.
- Дополняет: providers (если нет), models (если нет), workflows (если нет), mcpServers (если нет), env (если нет).
- Если что-то уже настроено — не трогает без явного изменения.
- Лог: «Режим: upgrade (backlog/ найден). Существующие настройки: providers=да, models=2, workflows=default+simple. Дополняю недостающее».

Переключение режима — автоопределение по наличию backlog/ (или флаг --mode fresh|upgrade для явного выбора).

## Что спрашивает wizard (порядок)

### 1. Имя проекта и prefix
Имя (по умолчанию — из backlog/config.yml или директория), prefix (по умолчанию — из config.yml или VL).
В режиме upgrade — показать текущие, Enter — оставить.

### 2. Агент(ы) — множественный выбор (галочки)

Проверить наличие папок в проекте:
- .qwen/ → предложить qwen (галочка по умолчанию отмечена).
- .opencode/ → предложить opencode (галочка по умолчанию отмечена; если opencode adapter ещё не реализован — disabled с подсказкой «Скоро», галочка не ставится).
- .claude/ → предложить claude (disabled, «Скоро»).

Если папки .opencode/ или .claude/ нет — НЕ показывать соответствующий пункт (не disabled, а вообще скрыть). Только реально доступные агенты в списке.

Галочки (множественный выбор, ни одна не обязательна):
[ ] vb (встроенный Vibelog-агент, нужен LLM) — по умолчанию не отмечен
[ ] qwen (внешний Qwen Code) — отмечен, если есть .qwen/
[ ] opencode (внешний OpenCode) — отмечен, если есть .opencode/ (disabled, если adapter не реализован)
[ ] claude (disabled, «Скоро») — показывать, только если есть .claude/

Если ни одна галочка не отмечена — проект без агента (только таск-менеджер: CLI + MCP + веб). Валидный сценарий. Wizard пропускает LLM-настройку (шаг 5), MCP-настройку (шаг 6) и ping LLM (шаг 7).

default_agent: если отмечен ровно один агент — он default (не спрашивать). Если больше одного — вопрос «Какой по умолчанию?». Если ни одного — default_agent не пишется (или пустая строка). В режиме upgrade — текущий default_agent показан как дефолт.

Дальше:
- vb отмечен → LLM-настройка (шаг 5).
- qwen/opencode отмечены → MCP-настройка (шаг 6).
- Ни одного — пропустить шаги 5 и 6.

### 3. Где хранить ключи

Вопрос: «Где хранить API-ключи и токены?»
- .env (gitignore) — ключи в .env файле проекта. Рекомендуется.
- settings.json (секция env, gitignore) — ключи в .vibelog/settings.json. Удобно, если .env нет.
- Оба (по умолчанию: .env, fallback на settings.json env) — VL-143.

По умолчанию — .env. В режиме upgrade — если .env уже есть и содержит ключи, показать «Секреты: .env (N ключей). Оставить?» Да → оставить. Нет → выбрать заново.
При выборе сохранить ключ (LLM, bot) — wizard пишет в выбранное место.
Если .env нет — создать с комментарием-шапкой.

### 4. Telegram-бот
«Настроить Telegram-бота?» Да → токен, чаты (опционально). Нет → пропустить.
В режиме upgrade — если env.telegram_token уже задан, показать «Бот уже настроен (чаты: N). Перенастроить?» Да → токен, чаты. Нет → оставить.

### 5. LLM: провайдер и модель (только если vb отмечен)

Провайдер: выбор из providers в settings.json (если есть) или добавить новый (id, base_url, api_key_env). Ключ — проверить, что переменная окружения задана (или ввести — сохранить в выбранное место, шаг 4).
Модель: выбор из available для выбранного провайдера или добавить новую (model id, label, api_mode chat|responses, pricing опционально). default — выбранная модель.
В режиме upgrade — если providers/models уже есть, показать текущий default и список available, Enter — оставить.

### 6. MCP (если qwen или opencode отмечены)
«Настроить vibelog MCP в .qwen/settings.json (и .opencode/ при наличии)?» Да → записать mcpServers.vibelog. Нет → пропустить.
В режиме upgrade — если mcpServers.vibelog уже есть, показать «MCP уже настроен (trust: true). Оставить?» Да → оставить. Нет → перенастроить.

### 7. Проверка
- Если vb — ping LLM (POST chat/completions или responses), показать модель, задержку, usage.
- Если qwen — which qwen, версия >= 0.24.
- Если opencode — which opencode, версия.
- Если бот — getMe (проверка токена).
Ошибки — понятные, предложить исправить.

## Консольный wizard

readline (или prompts-подобный на чистом Node). Галочки — интерактивный список (space — toggle, enter — confirm). Каждый шаг — вопрос с дефолтом (Enter — дефолт). Валидация: пустое имя, неверный prefix, несуществующий провайдер, неверный api_mode, недоступный LLM, qwen не в PATH, бот getMe упал.

Флаги для non-interactive:
--yes (все дефолты, без вопросов)
--mode fresh|upgrade (автоопределение по backlog/, если не указан)
--project-name, --prefix
--agents vb,qwen,opencode (список через запятую; пустая строка — без агентов)
--default-agent vb|qwen|opencode (только если больше одного)
--bot (настроить), --bot-token, --bot-chats
--secrets-location env|settings|both (по умолчанию env)
--provider <id>, --base-url, --api-key-env
--model <id>, --api-mode chat|responses
--no-mcp, --skip-llm-check, --skip-bot-check, --force (перезаписать существующее)

При --yes: дефолты (агенты — автоопределение по папкам .qwen/.opencode; vb не добавляется автоматически; если папок нет — без агентов; без бота, .env для секретов, vibelog MCP если qwen/opencode, ping LLM опционально --skip-llm-check). В режиме upgrade --yes: дополнить недостающее, не перезаписывать существующее.

## Web wizard /setup

При vibelog init — открыть браузер на /setup (или /#/setup).
Форма (React + shadcn/ui): пошагово (Stepper) или секциями.
Агенты — чекбоксы (ни одна не обязательна; qwen/opencode показывать только при наличии папок; vb всегда в списке).
Секреты — radio: .env | settings.json | оба.
Сохраняет в backlog/config.yml + .vibelog/settings.json + .env (если выбран).
Ping LLM — кнопка «Проверить», показывает модель, задержку, usage.
После сохранения — редирект на #/ (канбан) с тостом «Проект настроен».
Если backlog/ или settings.json уже есть — /setup в режиме upgrade: показывает текущие значения (редактирование), не перезаписывает существующие задачи/docs/lessons/references/decisions/milestones/completed.

## Интеграция с существующим

- providers, models (settings.json) — источник для выбора (предыдущая задача).
- MCP (VL-149) — .qwen/settings.json mcpServers.
- Telegram (VL-143) — settings.json env.telegram_token / chats.
- API-ключ — .env (loadDotEnv) или env-секция settings.json (по выбору шага 4).
- init --skills (удалён VL-188) — не возвращать.
- Upgrade-режим: не трогать backlog/tasks/, backlog/completed/, backlog/docs/, backlog/lessons/, backlog/references/ (кроме metadata, если дополняем), backlog/decisions/, backlog/milestones/.

## Валидация и ошибки

- Провайдер не существует → «Провайдер X не найден. Добавьте: vibelog provider add ...».
- api_key_env не задан в env/.env → «Переменная X не задана. Введите ключ или добавьте в .env».
- Модель не существует → список доступных.
- LLM ping упал → показать статус, тело ответа (обрезка), предложить исправить base_url/api_key/model.
- qwen не в PATH → «qwen не найден. Установите: npm i -g @qwen-code/qwen-code».
- opencode не в PATH → «opencode не найден. Установите по инструкции».
- Бот getMe упал → «Токен невалиден. Проверьте TELEGRAM_BOT_TOKEN» или прокси.
- Upgrade-режим: если backlog/ есть, но config.yml битый → «backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи».

## Логи и диагностика

Лог wizard: «Режим: fresh/upgrade. Агенты: qwen (default). Провайдер: —, модель: —. Секреты: .env. Бот: нет. MCP: да».
При ошибке — понятное сообщение, не стектрейс.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Архитектура

Общее ядро (чистые функции, без readline/HTTP) + два тонких фронта: консольный (readline) и web (/setup). Ядро одно — иначе консоль и веб разъедутся в поведении (upgrade-режим, запись секретов, MCP).

Новые модули:
- `src/core/setup.ts` — состояние/детект режима/применение ответов.
- `src/core/setup-secrets.ts` — запись секретов в `.env` / секцию `env` settings.json.
- `src/core/setup-mcp.ts` — MCP-настройка (вынести `handleMcpSetup` из init.ts, чтобы её использовали init и wizard).
- `src/core/setup-check.ts` — ping LLM, `which qwen/opencode` + версия, Telegram `getMe`.
- `src/cli/commands/init-wizard.ts` — интерактивный консольный wizard + сбор ответов из флагов.
- `src/web/setup-api.ts` — REST `/api/setup*`.
- `web/src/components/setup/setup-page.tsx` + `web/src/components/setup/api.ts` — страница `#/setup`.

## Контракты ядра (`src/core/setup.ts`)

```ts
export type SetupMode = 'fresh' | 'upgrade';
export type AgentId = 'vb' | 'qwen' | 'opencode' | 'claude';
export type SecretsLocation = 'env' | 'settings' | 'both';

export interface SetupAnswers {
  mode: SetupMode;
  projectName: string;
  prefix: string;
  agents: AgentId[];              // отмеченные галочки (может быть пусто)
  defaultAgent?: AgentId;         // только если agents.length > 1
  secretsLocation: SecretsLocation;
  bot?: { token?: string; chats: number[] };
  provider?: { id: string; base_url: string; api_key_env: string; apiKey?: string };
  model?: { id: string; label?: string; provider: string; model: string; api_mode: 'chat' | 'responses' };
  mcp: boolean;
  force: boolean;
}

export interface SetupState {     // текущее состояние — дефолты и upgrade-лог
  mode: SetupMode;
  projectName: string; prefix: string;
  agents: { id: AgentId; available: boolean; enabled: boolean; reason?: string }[];
  defaultAgent?: string;
  secrets: { envFile: boolean; envKeys: string[]; settingsEnvKeys: string[] };
  bot: { configured: boolean; chats: number[] };
  providers: Record<string, ProviderConfig>;
  models: ModelsConfig;
  mcp: { qwen: boolean; opencode: boolean };
  configError?: string;           // «backlog/config.yml повреждён…»
}

export function detectSetupMode(cwd: string): SetupMode;      // findBacklogDir(cwd) ? 'upgrade' : 'fresh'
export function readSetupState(cwd: string): SetupState;
export function applySetup(cwd: string, a: SetupAnswers): { written: string[]; skipped: string[]; warnings: string[] };
export function formatSetupLog(a: SetupAnswers, st: SetupState): string;
```

`readSetupState`:
- `detectSetupMode` → `findBacklogDir` (src/core/paths.ts:44).
- config.yml: `loadConfig` в try/catch; ошибка парсинга → `configError`, дефолты из `defaultConfig(basename(cwd), 'VL')`.
- settings.json: `loadSettings` (src/core/settings.ts:60), `loadProviders`/`loadModels` (src/core/models.ts), `readSettingsEnv` (src/core/settings.ts:186).
- агенты: `available` = наличие `.qwen/` / `.opencode/` / `.claude/` в cwd; `vb` — всегда available; `opencode`/`claude` — `available: true, enabled: false, reason: 'Скоро'` (adapter не реализован, ROADMAP «OpenCode adapter — future gate»); `enabled` по умолчанию = available && !reason.
- секреты: `.env` есть → `envKeys` = ключи из файла (парсер как в `loadDotEnv`, src/bot/env.ts:34, но без записи в process.env); `settingsEnvKeys` = ключи `readSettingsEnv`.
- MCP: `mcpServers.vibelog` в `.qwen/settings.json` / `.opencode/settings.json`.

`applySetup` (порядок и границы записи):
1. **fresh**: `mkdirSync` подпапок `tasks, completed, drafts, docs, decisions, milestones` (список из init.ts:57) + `lessons`, `references`; `writeFileSync(backlog/config.yml, stringifyYaml(defaultConfig(name, prefix)))`; `AGENTS.md` — только если файла нет (минимальный шаблон: заголовок проекта, команды `vibelog task create/list/board`, ссылка на `vibelog instructions`); `saveProjectSettings(cwd, { git_user_name: getGitUserName(cwd) })`.
2. **upgrade**: config.yml читается; при `configError` и `!force` → `throw new SetupError('backlog/config.yml повреждён. Восстановите вручную или --force для перезаписи')`; иначе меняются ТОЛЬКО `project_name`/`task_prefix` (и только если отличаются от текущих). Каталоги `tasks/ completed/ docs/ lessons/ references/ decisions/ milestones/` не трогаются вообще — в `written` не попадают.
3. settings.json — через `saveSettingsPatch` (read-modify-write, src/core/settings.ts:170): `default_agent` (только если agents.length ≥ 1; при 0 — ключ удаляется), `providers[id]` и `models.available[id]`/`models.default` — **дополняются**, существующие id не перезаписываются без `force` (в `skipped` пишется `providers.<id> (уже настроен)`).
4. секреты — `setup-secrets.ts` (см. ниже).
5. MCP — `setup-mcp.ts`, если `a.mcp && (agents включает qwen|opencode)`.

`formatSetupLog` — ровно формат из описания: `Режим: fresh|upgrade. Агенты: qwen (default). Провайдер: —, модель: —. Секреты: .env. Бот: нет. MCP: да`; в upgrade добавляется строка `Существующие настройки: providers=да, models=2, workflows=default+simple. Дополняю недостающее`.

## `src/core/setup-secrets.ts`

```ts
export function readEnvFile(cwd: string): Record<string, string>;      // парсер без побочек
export function writeSecrets(cwd: string, secrets: Record<string, string>, loc: SecretsLocation): { written: string[]; skipped: string[] };
```
- `env`/`both`: `.env` создаётся с шапкой `# Vibelog: секреты проекта (не коммитить, .env в .gitignore)`; существующие ключи НЕ перезаписываются (в `skipped`), новые дописываются в конец; значения с пробелами/кавычками — в двойных кавычках.
- `settings`/`both`: `saveSettingsPatch(cwd, { env: { ...readSettingsEnv(cwd), ...новые } })`.
- Значения секретов НИКОГДА не попадают в лог/`written` (только имена ключей).

## `src/core/setup-mcp.ts`

Перенос тела `handleMcpSetup` (src/cli/commands/init.ts:100-133) в `export function setupMcp(cwd: string, targets: ('qwen'|'opencode')[], opts?: { force?: boolean }): { written: string[]; skipped: string[] }`. Merge-семантика сохраняется (чужие ключи и `mcpServers.other` не теряются), битый JSON → `skipped` + warning, не исключение. `init.ts` вызывает его же (поведение `--no-mcp` не меняется).

## `src/core/setup-check.ts`

```ts
export interface LlmPingResult { ok: boolean; model: string; latencyMs: number; usage?: { input: number; output: number; total: number }; status?: number; error?: string; bodySnippet?: string }
export async function pingLlm(active: ActiveModel, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<LlmPingResult>;
export function checkAgentBinary(id: 'qwen' | 'opencode'): { found: boolean; path?: string; version?: string; error?: string };
export async function checkTelegramToken(token: string, opts?: { fetchImpl?: typeof fetch; timeoutMs?: number }): Promise<{ ok: boolean; username?: string; error?: string }>;
```
- `pingLlm`: URL по `active.apiMode` — `${baseUrl}/chat/completions` либо `${baseUrl}/responses` (ветвление только URL/тела, как lesson-60); тело `{ model, messages: [{role:'user', content:'ping'}], max_tokens: 1 }` (responses: `{ model, input: 'ping', max_output_tokens: 16 }`); `AbortController` + `timeoutMs` (дефолт 10000); никогда не бросает — ошибка в `error`, тело ответа обрезается до 300 символов (`bodySnippet`).
- `checkAgentBinary`: `spawnSync('which', [id])` + `spawnSync(id, ['--version'])`, таймаут 2000 мс; `qwen` версия < 0.24 → `error: 'qwen 0.24+ требуется…'`.
- `checkTelegramToken`: `GET https://api.telegram.org/bot<token>/getMe`; токен в тексте ошибки не печатается.

## `src/cli/commands/init-wizard.ts`

```ts
export function answersFromFlags(flags: FlagValues, state: SetupState): SetupAnswers;   // --yes и явные флаги
export async function runWizard(cwd: string, flags: FlagValues, state: SetupState): Promise<SetupAnswers>;  // интерактив
export function validatePrefix(v: string): string | null;
export function validateProjectName(v: string): string | null;
```
- Интерактив: `readline.createInterface` для текстовых вопросов (Enter → дефолт), чекбоксы — `process.stdin.setRawMode(true)` + посимвольный разбор (space — toggle, ↑/↓ — курсор, Enter — confirm), как в `src/agent/tui.ts:374`; при `!process.stdin.isTTY` — fallback на нумерованный ввод (`1,2` через запятую).
- Порядок шагов ровно по описанию: 1) имя/prefix → 2) агенты (vb всегда; qwen/opencode/claude только при наличии папки; opencode/claude — disabled «Скоро») → default_agent (только если >1) → 3) секреты → 4) бот → 5) LLM (только если vb) → 6) MCP (только если qwen/opencode) → 7) проверки.
- Валидация: пустое имя, prefix `^[A-Za-z][A-Za-z0-9_-]{0,9}$`, провайдер не найден → «Провайдер X не найден. Добавьте: vibelog provider add …», `api_mode ∉ {chat,responses}`, `api_key_env` не задан → предложить ввод ключа.
- `answersFromFlags`: `--agents` (пустая строка → `[]`), `--default-agent`, `--secrets-location`, `--bot`/`--bot-token`/`--bot-chats`, `--provider`/`--base-url`/`--api-key-env`, `--model`/`--api-mode`, `--no-mcp`, `--force`. `--yes` = дефолты из `state` (агенты — автоопределение по папкам, vb не добавляется, бот выключен, секреты `env`, MCP включён при qwen/opencode).

## Правки существующих файлов

1. `src/cli/commands/init.ts`
   - стр. 30-90 (`runInit`): после `findBacklogDir` — `detectSetupMode`; `--mode fresh|upgrade` переопределяет; `--force` сохраняет прежнюю семантику (перезапись разрешена).
   - Ветка «уже инициализирован и нет --force»: сейчас `exitCode = 1` (стр. 44-50). Новое: если TTY и не `--no-wizard` — это upgrade-режим wizard (не ошибка); без TTY — прежнее сообщение + подсказка `vibelog init --mode upgrade`.
   - Выбор интерактива: `process.stdin.isTTY && process.stdout.isTTY && !flags.yes && !flags['no-wizard']`.
   - После `applySetup` — проверки из `setup-check.ts` (если не `--skip-llm-check`/`--skip-bot-check`), печать `formatSetupLog` + `written`/`skipped`/`warnings`.
   - `--web`: после применения — `startWebServer(cwd, port, true, undefined, host, '#/setup')` (см. п. 3).
   - `handleMcpSetup` (стр. 100-133) → тонкая обёртка над `setupMcp` (или удалить, вызов из `applySetup`).
2. `src/cli/router.ts`: help `init` (стр. 189-190) — перечислить новые флаги; строка 144 — упоминание wizard.
3. `src/web/server.ts`: `startWebServer(..., openHash?: string)` — при `openBrowser` открывать `${local}${openHash ?? ''}` (стр. ~150-160); добавить async-ветку `POST /api/setup/ping` и `POST /api/setup/check-bot` рядом с `/api/chat` (стр. 88-125), т.к. `handleApi` синхронный.
4. `src/web/api.ts`: в начале `handleApi` (после `try {`, стр. ~105) — `const setup = handleSetupApi(method, url, body, cwd); if (setup) return setup;`; импорт `./setup-api.js`; в шапку-доклист добавить `/api/setup*`.
5. `web/src/lib/use-hash-route.ts`: `Route` += `'setup'`; в `parseHash` — `if (path === 'setup') return 'setup'` (до детальных префиксов).
6. `web/src/App.tsx`: импорт `SetupPage`, ветка `route === "setup" ? <SetupPage /> : …` (перед `Kanban`).
7. `web/src/components/layout/app-sidebar.tsx`: пункт «Настройка» (`url: "setup"`, иконка `SlidersHorizontal`) в группе «Основное» — чтобы страница была доступна после первого запуска.

## Web `/setup` (`web/src/components/setup/`)

- `api.ts`: `fetchSetupState()`, `postSetup(answers)`, `pingLlm()`, `checkBot(token)` — по образцу `web/src/components/settings/api.ts`.
- `setup-page.tsx`: секции-Card (проект / агенты / секреты / бот / LLM / MCP), чекбоксы агентов (vb всегда; qwen/opencode/claude — только если `available`; disabled с подписью «Скоро»), radio секретов, `Select` провайдера/модели (данные из `GET /api/setup`), кнопка «Проверить» → `POST /api/setup/ping` (показывает модель, задержку, usage), кнопка «Сохранить» → `POST /api/setup` → inline-баннер «Проект настроен» + `window.location.hash = "#/"` (компонента toast в `ui/` нет — не добавляем зависимость).
- Upgrade-режим: `GET /api/setup` отдаёт `mode: 'upgrade'` и текущие значения как дефолты формы; сохранение не трогает задачи/docs/lessons/references/decisions/milestones/completed (гарантия в `applySetup`).

## Тесты (mkdtemp, `testSpawnEnv()` для spawn CLI)

- `src/core/setup.test.mjs`: `detectSetupMode` fresh/upgrade; `readSetupState` на пустом каталоге и на каталоге с config.yml+settings.json (providers/models/секреты/MCP); `applySetup` fresh создаёт `backlog/{tasks,completed,drafts,docs,decisions,milestones,lessons,references}`, `config.yml`, `AGENTS.md`, `.env`; upgrade НЕ перезаписывает существующий `backlog/tasks/*.md` и существующие `providers`/`models` (в `skipped`); битый `config.yml` → `SetupError` без `force`, с `force` — перезапись; `AGENTS.md` не перезаписывается.
- `src/core/setup-secrets.test.mjs`: `.env` с шапкой, дописывание без перезаписи, `settings`-локация пишет `env`-секцию, `both` — в оба, значения не попадают в `written`.
- `src/core/setup-check.test.mjs`: `pingLlm` с `fetchImpl` (chat → `/chat/completions`, responses → `/responses`, 401 → `ok:false` + `bodySnippet`, таймаут через `timeoutMs: 1`), `checkTelegramToken` с `fetchImpl`, `checkAgentBinary('qwen')` при отсутствии бинаря → `found:false` (без сети).
- `src/cli/init-wizard.test.mjs` (spawn CLI, `testSpawnEnv()`): `init --yes` в mkdtemp создаёт backlog+settings без вопросов; `--agents qwen --no-mcp` не пишет MCP; `--mode upgrade` на готовом backlog дополняет и не трогает задачи; `--secrets-location settings --bot-token X` пишет `env`-секцию; `init --help` содержит `--yes`, `--mode`, `--agents`, `--secrets-location`.
- `src/web/setup-api.test.mjs`: `handleSetupApi` GET/POST на mkdtemp (без сети), валидация (неизвестный провайдер → 400, пустое имя → 400), `POST /api/setup` в upgrade не меняет задачи.

## Порядок работ

1. `src/core/setup.ts` + `setup-secrets.ts` + `setup-mcp.ts` (+ тесты ядра) — фундамент, от него зависят оба фронта.
2. `src/core/setup-check.ts` (+ тесты с `fetchImpl`).
3. `src/cli/commands/init-wizard.ts` + правки `init.ts`/`router.ts` (+ CLI-тесты).
4. `src/web/setup-api.ts` + правки `api.ts`/`server.ts` (+ тесты API).
5. Web UI: `use-hash-route.ts`, `App.tsx`, `app-sidebar.tsx`, `components/setup/*`; `pnpm --dir web build` (web/dist коммитится).
6. Документация: `document_update` doc-7 (CLI: флаги `init`, режимы fresh/upgrade, примеры) и doc-6 (первый запуск: `vibelog init` → wizard / `#/setup`); CHANGELOG — в фазе Close.

## Проверка

```bash
pnpm build && pnpm test:fast          # быстрый цикл
pnpm test                             # полный прогон перед DoD
pnpm --dir web typecheck && pnpm --dir web build
node bin/vibelog.mjs init --help
# ручной smoke в mkdtemp: init --yes; init --mode upgrade; init --web → #/setup
```

## Риски

- **Интерактив ломает существующие тесты** (десятки вызовов `init` через spawnSync без TTY): wizard включается только при `isTTY` и без `--yes`/`--no-wizard`; поведение без TTY = прежнее + дефолты.
- **Секреты в логах**: `written`/лог содержат только имена ключей; `GET /api/setup` отдаёт `keySet: boolean`, не значения (паттерн `GET /api/models`).
- **Сеть в тестах**: `pingLlm`/`checkTelegramToken` — только через `fetchImpl`; глобальный fetch-guard (VL-132) и spawn-guard (VL-226) не обходятся.
- **Upgrade затирает данные**: запись ограничена `config.yml` (только `project_name`/`task_prefix`) и `settings.json` (только недостающие ключи); тест-инвариант «задача в `backlog/tasks/` не изменилась» обязателен.
- **raw mode на Catalina/Node 20**: `setRawMode` только при `isTTY`, `finally`-восстановление режима и `rl.close()`; fallback на нумерованный ввод.
- **`web/dist` коммитится** (VL-26): без пересборки UI страница `/setup` не появится в npm-пакете.
- **Дублирование MCP-логики**: `handleMcpSetup` переносится в `setup-mcp.ts`; тест `src/cli/init-mcp.test.mjs` (6 кейсов) должен остаться зелёным без правок — это регресс-инвариант переноса.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 10:29
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Тип: feature. Масштаб: task. Приоритет: Medium. Уточнено: критерии приёмки (3 проверяемых — консольный wizard с порядком вопросов и автоопределением режима, upgrade-режим без перезаписи существующего, web /setup + non-interactive флаги), тип и приоритет. Labels: cli, web. References: нет. Вопросов нет.
---
author: @agent
created: 2026-11-02 09:22
---
Фаза 2 (Plan) выполнена. Тип: feature (обычная задача, не epic) — план записан в саму задачу.
Изучено: `src/cli/commands/init.ts` (133 стр., текущий init + handleMcpSetup), `src/core/settings.ts` (единый settings.json, env-секция, saveSettingsPatch), `src/core/project-settings.ts`, `src/core/models.ts` (providers/models, ActiveModel), `src/core/config.ts` (defaultConfig/loadConfig/saveConfig), `src/core/paths.ts` (findBacklogDir), `src/core/workflow.ts`, `src/bot/env.ts` (loadDotEnv/loadProjectEnv), `src/bot/settings.ts` (BotSettings), `src/cli/args.ts` (getFlag/getFlagArray), `src/cli/ui.ts` (prompt/confirm), `src/cli/router.ts`, `src/web/server.ts` + `src/web/api.ts` (маршрутизация, GET/PUT /api/config, /api/settings, /api/models), `web/src/App.tsx`, `web/src/lib/use-hash-route.ts`, `web/src/components/settings/{settings.tsx,api.ts}`, `web/src/components/config/api.ts`, `web/src/components/layout/app-sidebar.tsx`, `src/cli/init-mcp.test.mjs`, ROADMAP.md (секции «Init wizard»/«Web wizard (/setup)»/«OpenCode adapter — future gate»).
Архитектурное решение: одно общее ядро (`src/core/setup.ts` + `setup-secrets.ts` + `setup-mcp.ts` + `setup-check.ts`) и два тонких фронта — консольный (`src/cli/commands/init-wizard.ts`, readline + raw-mode чекбоксы с fallback на нумерованный ввод при !isTTY) и web (`src/web/setup-api.ts` + `web/src/components/setup/*`, маршрут `#/setup`). Иначе консоль и веб разъедутся в upgrade-семантике и записи секретов.
Ключевые решения:
- Режим — `detectSetupMode` по `findBacklogDir`, override `--mode fresh|upgrade`; upgrade пишет ТОЛЬКО `project_name`/`task_prefix` в config.yml и недостающие ключи settings.json, каталоги tasks/completed/docs/lessons/references/decisions/milestones не трогаются (тест-инвариант).
- `handleMcpSetup` из init.ts переносится в `src/core/setup-mcp.ts`; существующий `src/cli/init-mcp.test.mjs` (6 кейсов) — регресс-инвариант переноса, править его не планируется.
- Секреты: `.env` (шапка, дописывание без перезаписи) / секция `env` settings.json / оба; в лог и `written` попадают только имена ключей, `GET /api/setup` отдаёт `keySet: boolean` (паттерн `GET /api/models`).
- Проверки (`pingLlm`, `checkAgentBinary`, `checkTelegramToken`) — только через инъекцию `fetchImpl`/`spawnSync` с таймаутами, без сети в тестах (fetch-guard VL-132, spawn-guard VL-226); ветвление chat/responses — только URL и тело (lesson-60).
- Интерактив включается лишь при `isTTY` и без `--yes`/`--no-wizard` — десятки существующих spawn-тестов `init` без TTY сохраняют прежнее поведение.
- `startWebServer` получает параметр `openHash` (открытие `#/setup`), async-эндпоинты `/api/setup/ping` и `/api/setup/check-bot` — в server.ts рядом с `/api/chat` (handleApi синхронный).
Файлов в плане: 7 новых модулей/страниц + 7 правок существующих (init.ts, router.ts, server.ts, api.ts, use-hash-route.ts, App.tsx, app-sidebar.tsx) + 5 новых тест-файлов + документация (doc-6, doc-7).
Риски: интерактив ломает существующие тесты (снят условием isTTY); утечка секретов в лог/API (снят контрактом keySet/имена ключей); сеть в тестах (снят инъекцией fetchImpl); затирание данных в upgrade (снят ограничением записи + инвариант-тестом); raw mode на Catalina (fallback на нумерованный ввод); `web/dist` коммитится — нужна пересборка UI.
Вопросов и блокеров нет, дочерних задач не создавалось (задача не epic).
---
author: @agent
created: 2026-11-02 10:07
---
### Прогресс до обрыва (по лимиту LLM-запросов)
**Сделано:**
- src/core/setup-secrets.ts
- src/core/setup-mcp.ts
- src/core/setup-check.ts
- src/core/setup.ts
- src/cli/commands/init-wizard.ts
- src/cli/commands/init.ts
- src/web/setup-api.ts
- src/web/api.ts
- src/web/server.ts
- src/cli/router.ts
- Начинаю реализацию. Сначала ядро.
Теперь консольный wizard.
Теперь переписываю `init.ts`.
Теперь подключаю в api.ts и server.ts.
Теперь server.ts: async-эндпоинты и openHash.
Теперь help в router.ts.
Теперь web UI.
Теперь тесты.
Тест-файлы `.mjs` не поддерживают TS-аннотации — переписываю без типов.…
**Осталось:**
- проверки (сборка / полный прогон тестов) в этом ране не завершены
- отчёт фазы (backlog_finish_phase) не записан
- AC/DoD не отмечены
_время рана 588 с, payload 696433 байт_
---
author: @agent
created: 2026-11-02 10:07
---
Фаза code не удалась (код выхода 1): ировок=0, payload последнего запроса=620928 байт (макс 696433), usage={"input_tokens":11571484,"output_tokens":52944,"cache_read_input_tokens":11359232,"total_tokens":11624428,"reasoning_tokens":4227} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-02 10:24
---
Фаза 3 (Code) выполнена. Коммит 1f04203.
Реализовано по плану (ядро + два фронта):
- `src/core/setup.ts` — detectSetupMode/readSetupState/applySetup/formatSetupLog, SetupError, валидация имени и prefix. Инвариант upgrade: пишутся только `backlog/config.yml` (project_name/task_prefix) и недостающие ключи `.vibelog/settings.json`; tasks/completed/docs/lessons/references/decisions/milestones не трогаются.
- `src/core/setup-secrets.ts` — readEnvFile/writeSecrets для локаций env|settings|both, шапка `.env`, без перезаписи существующих ключей, значения не попадают в written.
- `src/core/setup-mcp.ts` — setupMcp/hasVibelogMcp, перенос merge-логики `handleMcpSetup` из init.ts (битый JSON → warning, не исключение).
- `src/core/setup-check.ts` — pingLlm (chat/responses, AbortController, bodySnippet ≤300), checkAgentBinary (which + --version, порог qwen 0.24), checkTelegramToken (getMe, токен не печатается).
- `src/cli/commands/init-wizard.ts` — answersFromFlags/runWizard (readline + raw-mode чекбоксы, fallback на нумерованный ввод без TTY), валидаторы.
- `src/cli/commands/init.ts` — режимы fresh/upgrade, `--mode`, `--yes`, `--no-wizard`, `--web` (открывает `#/setup`), шаг проверок; легаси-строки вывода сохранены дословно.
- `src/cli/router.ts` — help `init` с новыми флагами, упоминание wizard в общем help.
- `src/web/setup-api.ts` + правки `api.ts`/`server.ts` — GET/POST `/api/setup`, async `/api/setup/ping` и `/api/setup/check-bot`; `startWebServer(..., openHash)`.
- Web UI: `use-hash-route.ts` (route 'setup'), `App.tsx`, `app-sidebar.tsx` (пункт «Мастер настройки»), `components/setup/{api.ts,setup-page.tsx}`; `web/dist` пересобран.
Проверки:
- `pnpm build` — OK.
- `pnpm --dir web typecheck && pnpm --dir web build` — OK.
- Новые тесты: 62 (setup 15, setup-secrets 9, setup-check 13, init-wizard 10, setup-api 15) — все зелёные.
- **Полный прогон `pnpm test`: 145 файлов, 2696 passed, 4 skipped, 0 failed.** Исключённых/пропущенных файлов нет (4 skipped — штатные skip внутри файлов).
Исправлено по ходу: первый полный прогон дал 2 падения — `src/cli/cli.test.mjs` (ожидал «Создана директория») и `src/cli/init-mcp.test.mjs` (ожидал «MCP-сервер vibelog настроен»). Это регресс вывода, а не тестов: легаси-строки восстановлены в `init.ts` дословно, старые тесты не правились (регресс-инвариант переноса MCP из плана соблюдён).
DoD: «Тесты проходят» и «Нет регрессий» отмечены. «Документация обновлена» НЕ отмечена — по правилам фазы Code документы `backlog/docs` (doc-6, doc-7) и CHANGELOG пишет фаза Close; шаг 6 плана (document_update doc-7/doc-6) переносится туда.
---
author: @agent
created: 2026-11-02 10:43
---
Фаза Close выполнена. Ветка vb/vl-210 слита в master (1 коммит 1f04203, merge ce5abbe), worktree удалена (force — только untracked-симлинки node_modules/backlog/references/data), ветка vb/vl-210 удалена.
Проверки после merge (главный репо):
- `pnpm build` — OK.
- Ранний точечный фильтр: src/core/setup.test.mjs, setup-secrets, setup-check, src/cli/init-wizard.test.mjs, src/web/setup-api.test.mjs + регресс-инвариант src/cli/init-mcp.test.mjs — 6 файлов, 70 тестов, все зелёные.
- Полный прогон `pnpm test`: 145 файлов, 2696 passed, 4 skipped, 0 failed. Исключённых файлов нет; повторных полных прогонов не было.
Документация (DoD 2): doc-7 — раздел `init` переписан под wizard (режимы fresh/upgrade, все новые флаги, примеры, проверки); doc-6 §1 — подраздел «Мастер настройки (VL-210)» (порядок вопросов, режимы, веб-мастер #/setup) + уточнено поведение повторного init; CHANGELOG.md — запись в Unreleased/Добавлено. Коммиты: 8766917 (refs и lessons), 61da260 (документация и CHANGELOG).
Lessons: создан lesson-172 (интерактив только при isTTY и без --yes/--no-wizard; легаси-строки вывода сохранять дословно), связан с VL-210.
DoD: 1 «Тесты проходят» — да (полный прогон), 2 «Документация обновлена» — да (doc-6, doc-7, CHANGELOG), 3 «Нет регрессий» — да (init-mcp.test.mjs и cli.test.mjs зелёные без правок).
---
<!-- COMMENTS:END -->