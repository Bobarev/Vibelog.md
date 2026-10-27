---
id: VL-206
title: Уведомление о новой версии при запуске vb bot и vb browser
status: Review
assignee: []
reporter: ''
created_date: '2026-10-27 15:19'
updated_date: '2026-10-27 17:33'
due_date: ''
labels:
  - core
  - cli
dependencies:
  - VL-101
milestone: ''
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/cli/update-check.ts
  - bin/vibelog.mjs
  - src/cli/update-check.test.mjs
  - src/cli/cli.test.mjs
lessons:
  - lesson-65
  - lesson-66
token_usage:
  input: 9994176
  output: 287248
  cache: 9672832
  total: 10281424
  requests: 91
  duration_ms: 4971645
  reasoning: 274582
  by_phase:
    spec:
      input: 120535
      output: 8596
      cache: 103168
      requests: 4
    plan:
      input: 7617626
      output: 136933
      cache: 7468544
      requests: 57
    prompt:
      input: 2256015
      output: 141719
      cache: 2101120
      requests: 30
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
В VL-101 команды `bot` и `browser` входят в skip-список `shouldSkip()` — уведомление о новой версии для них не показывается никогда.

Нужно: при запуске `vb bot` и `vb browser` сразу после старта выполнять проверку обновления и выводить стандартное уведомление в stderr:
`⚠ Доступна новая версия для обновления: npm install -g vibelog.md (текущая: X → новая: Y)`

Остальная логика не меняется:
- единый кэш с TTL 24 ч (`$TMPDIR/vibelog-update-check.json`) — раз в сутки и на проверку, и на показ;
- задержка ≤3 с (Promise.race), ошибки сети молча + `error: true` в кэш на 24 ч;
- skip по `VIBELOG_SKIP_UPDATE_CHECK`, `-v`/`--version`;
- уведомление только в stderr (в `mcp`/`browser` stdout занят).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `vb browser` и `vb bot` при наличии новой версии и устаревшем кэше выводят уведомление сразу после запуска
- [x] #2 Уведомление идёт в stderr и не ломает stdout (JSON-RPC в mcp, вывод browser)
- [x] #3 Кэш общий с обычными командами: повторная проверка/показ не чаще раза в 24 часа
- [x] #4 Задержка запуска не превышает лимит (≤3 с), при ошибке npm/сети — молчит и кэширует `error: true` на 24 ч
- [x] #5 `VIBELOG_SKIP_UPDATE_CHECK` и флаги `-v`/`--version` продолжают пропускать проверку
- [x] #6 Тесты обновлены (shouldSkip для bot/browser, момент показа) и проходят
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План реализации VL-206 — уведомление о новой версии при запуске vb bot / vb browser

## Диагноз (VL-101)

- `bin/vibelog.mjs:14-26` — вызов `maybeNotifyUpdate()` стоит в `.then()` **после** `route()`; для долгоживущих bot/browser route не завершается → уведомление не наступает никогда.
- `src/cli/update-check.ts:35` — `SKIP_COMMANDS = ['mcp', 'browser', 'bot', 'qwen-debug']`; `shouldSkip()` (стр. 194) пропускает bot/browser даже до сетевого вызова.

## Архитектурное решение

1. **Убрать `browser` и `bot` из `SKIP_COMMANDS`** (остаются `['mcp', 'qwen-debug']`) — mcp (JSON-RPC по stdout) и qwen-debug не трогаем.
2. **Новая экспортная функция `shouldNotifyAtStartup(argv)`** в `update-check.ts` рядом со `shouldSkip`: возвращает `true`, если первая не-флаговая команда ∈ `STARTUP_NOTIFY_COMMANDS = ['bot', 'browser']`. Bin по ней выбирает момент вызова: до `route()` для bot/browser, после — для остальных.
3. `maybeNotifyUpdate()` не меняется: общий кэш `$TMPDIR/vibelog-update-check.json` (TTL 24 ч), `Promise.race` ≤3 с, stderr-only, env-гард и `-v/--version` — вся существующая логика остаётся. Для bot/browser проверка выполняется **с await до route** → уведомление гарантированно печатается раньше любого вывода сервиса; задержка старта ≤3 с раз в сутки (соответствует AC4).

## Файлы и правки

| Файл | Что менять |
|---|---|
| `src/cli/update-check.ts` | стр. 35: `SKIP_COMMANDS = ['mcp', 'qwen-debug']` (убраны browser, bot), обновить комментарий стр. 34; новый экспорт `STARTUP_NOTIFY_COMMANDS` + `shouldNotifyAtStartup(argv)` (~после стр. 204, рядом со `shouldSkip`), JSDoc на русском |
| `bin/vibelog.mjs` | стр. 14-26: перестроить цепочку — `const notifyFirst = shouldNotifyAtStartup(argv)`; если `notifyFirst` → `maybeNotifyUpdate(argv).then(() => route(argv))`, иначе → `route(argv)`; затем `.catch(ошибка → stderr + exit 1).then(() => notifyFirst ? undefined : maybeNotifyUpdate(argv))` (пост-route вызов для bot/browser не выполняется — проверка уже была при старте). Импорт `shouldNotifyAtStartup` из `../dist/cli/update-check.js` |
| `src/cli/update-check.test.mjs` | стр. 148-154: тест «долгоживущие команды…» → split: `mcp`/`qwen-debug` → `true`, `browser`/`bot` → `false` (VL-206). Новый `describe('shouldNotifyAtStartup')`: `['browser']`,`['bot']`,`['browser','--no-open']` → true; `['task','list']`,`['mcp']`,`[]`,`['-v']` → false. Новый тест «момента показа»: `maybeNotifyUpdate(['browser'], …)` со устаревшим кэшем и моком exec `"9.9.9"` → уведомление в stderr; со свежим кэшем → exec не вызывается |
| `src/cli/cli.test.mjs` | Интеграционный тест процесса (spawnSync, как стр. 184): каталог-обёртка с фейковым `npm` (node-скрипт с shebang `#!/usr/bin/env node`, `chmod +x`, печатает `"9.9.9"`), spawn `node bin/vibelog.mjs browser --help` с `TMPDIR=<свежий temp>` и `PATH=<обёртка>:$PATH`: (1) stderr содержит «Доступна новая версия», stdout — help и НЕ содержит уведомления (AC1+AC2); (2) повторный spawn с тем же TMPDIR → без уведомления (AC3); (3) spawn с `VIBELOG_SKIP_UPDATE_CHECK=true` и стёртым кэшем → без уведомления (AC5). `browser --help` безопасен — router показывает help до запуска сервера (`router.ts:64-67`) |
| `backlog/docs/doc-7-…` (через `document_update`) | Раздел «Автообновление», пункт «команды mcp, browser, bot, qwen-debug» (стр. ~401): заменить на «mcp и qwen-debug — JSON-RPC/отладка; bot и browser — проверка выполняется при запуске (до route), уведомление в stderr сразу после старта» |
| `backlog/docs/doc-6-…` (через `document_update`) | Стр. 62: уточнить — для `vb bot` / `vb browser` проверка при запуске |

Тест `src/core/no-network.test.mjs` не требует правок (проверяет только env-гард и `mcp` — browser/bot там не упоминаются).

## Порядок действий

1. `update-check.ts`: SKIP_COMMANDS + `shouldNotifyAtStartup`.
2. `bin/vibelog.mjs`: перестроить цепочку вызовов.
3. `pnpm build`.
4. Юнит-тесты `update-check.test.mjs` (shouldSplit, shouldNotifyAtStartup, момент показа).
5. Интеграционный тест в `cli.test.mjs` (фейковый npm + TMPDIR).
6. Документация: `document_update` для doc-7 и doc-6.
7. Финальная проверка.

## Проверки

```bash
pnpm build          # tsc strict
pnpm test:fast      # vitest run (или pnpm test = build + test)
node --check bin/vibelog.mjs   # pnpm lint
```
Ручная: `rm -f $TMPDIR/vibelog-update-check.json` (в инструкции — через `node -e` с `os.tmpdir()`), затем `vb browser --help` → уведомление в stderr; повторно → тихо.

## Риски

- **Семантика ошибок bin**: `catch` должен остаться на `route()` (stderr + exit 1), пост-route `maybeNotifyUpdate` — не бросает исключений (весь в try/catch) — цепочку не сломает.
- **`shouldSkip(['browser'])` меняет контракт** — в тестах и документации phảnлексировать; `no-network.test.mjs` не затронут (проверено grep).
- **Фейковый npm в spawn-тесте**: только node-скрипт с shebang (запрет внешних рантаймов), `chmod 0o755`; на macOS execFile резолвит через PATH — обёртка должна идти первым в PATH.
- **Задержка `browser --help` ≤3 с** при устаревшем кэше — одноразовая в сутки, соответствует AC4; в тестах кэш изолирован через TMPDIR.
- Параллельность vitest (fileParallelism): интеграционный тест использует собственный mkdtemp-каталог для TMPDIR — не конфликтует с общим кэшем других тестов.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-27 15:26
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Уведомление о новой версии при запуске vb bot и vb browser» (снят тег #core, сокращён до ≤80 символов). Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: тип, приоритет, labels; AC сведены к 3 проверяемым (уведомление в stderr сразу после запуска bot/browser; общий кэш TTL 24 ч + лимит 3 с + skip-флаги; тесты shouldSkip/момента показа). Контекст VL-101 просмотрен: bot/browser входят в skip-список shouldSkip(), mcp остаётся пропущенным, остальная логика не меняется. Labels: core (тег из заголовка), cli. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-27 16:18
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан в задачу. Диагноз: в bin/vibelog.mjs проверка стоит после route() (для долгоживущих bot/browser не наступает никогда), а shouldSkip() пропускает их через SKIP_COMMANDS (update-check.ts:35). Решение: убрать browser/bot из SKIP_COMMANDS (остаются mcp/qwen-debug), добавить экспорт shouldNotifyAtStartup(argv) в update-check.ts, в bin — await maybeNotifyUpdate() ДО route() для bot/browser (уведомление раньше вывода сервиса, задержка ≤3 с раз в сутки), пост-route вызов для них пропустить. maybeNotifyUpdate не меняется — общий кэш TTL 24 ч, Promise.race ≤3 с, stderr-only, env-гард и -v сохраняются. Файлов: 4 код+тесты (update-check.ts, bin/vibelog.mjs, update-check.test.mjs, cli.test.mjs — интеграционный spawn с фейковым npm через TMPDIR/PATH) + 2 документа через document_update (doc-7 раздел «Автообновление», doc-6 строка 62). Проверки: pnpm build, pnpm test:fast, pnpm lint. Риски: семантика catch в bin-цепочке; смена контракта shouldSkip(['browser']) — задокументировать; фейковый npm только node-скрипт с shebang (запрет внешних рантаймов); изоляция кэша в тестах через TMPDIR при fileParallelism.
---
author: @agent
created: 2026-10-27 16:52
---
Фаза 3 (Code) выполнена. Изменено: src/cli/update-check.ts (SKIP_COMMANDS → ['mcp','qwen-debug']; новый экспорт STARTUP_NOTIFY_COMMANDS + shouldNotifyAtStartup с JSDoc; комментарий shouldSkip обновлён), bin/vibelog.mjs (notifyFirst: для bot/browser — maybeNotifyUpdate АВАЙТ до route, пост-route вызов пропущен; для остальных — как раньше после route; catch-семантика сохранена), src/cli/update-check.test.mjs (split shouldSkip: mcp/qwen-debug true, browser/bot false; +env-гард/-v для bot/browser; новый describe shouldNotifyAtStartup 8 проверок; +2 теста момента показа: уведомление для browser/bot при устаревшем кэше и общий кэш с task-командой), src/cli/cli.test.mjs (интеграционный spawn-тест: фейковый npm через PATH-обёртку, TMPDIR-изолированный кэш — уведомление в stderr не протекает в stdout, повторный запуск тихо, env-гард тихо). Коммит 4c9163f (4 файла, 157+/11-). Проверки: pnpm build (tsc strict 0 ошибок), pnpm lint (node --check OK), vitest run — 80 файлов / 1443 теста / 0 падений (прогон полный; одиночный флак orchestrator.test.mjs в первом прогоне прошёл при повторе и в финальном полном прогоне). Ручная проверка: browser --help со стёртым кэшем и фейковым npm → уведомление в stderr (покрыто интеграционным тестом). Что осталось: документация (doc-6/doc-7, раздел «Автообновление») по правилам фазы НЕ обновлялась в Code — её пишет Фаза Close после слияния; DoD «Документация обновлена» не закрыт намеренно.
---
<!-- COMMENTS:END -->