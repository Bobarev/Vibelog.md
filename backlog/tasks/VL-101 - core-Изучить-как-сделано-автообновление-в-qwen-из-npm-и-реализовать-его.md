---
id: VL-101
title: '#core Изучить как сделано автообновление в qwen из npm и реализовать его'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 02:23'
updated_date: '2026-10-06 19:11'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: ''
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#core Изучить как сделано автообновление в qwen из npm и реализовать его

## Уточнения (Фаза 1 Spec)
- Референс: реализация автообновления в qwen — локальный репозиторий `refs/qwen-code` (изучить механизм автообновления из npm).
- Поведение Vibelog.md: только уведомление о новой версии, без автоустановки.
- При обнаружении новой версии выводить сообщение вида: «Доступна новая версия для обновления: npm install -g <package>».
- Ограничения: Node.js 20+, macOS 10.15 Catalina, без нативных зависимостей.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# План: автообновление Vibelog.md (только уведомление, как в qwen)

## Референс (refs/qwen-code)

Механизм qwen (`packages/cli/src/ui/utils/updateCheck.ts`, 342 строки):
1. Текущая версия — из package.json пакета.
2. Последняя версия — `npm view <pkg> dist-tags.latest --json` через `execFile` с `timeout: 5000` мс.
3. Парсинг вывода npm: ≤11 — голая JSON-строка (`"0.20.1"`), 12+ — массив `["0.20.1"]`; принимаем оба формата.
4. Сравнение `semver.gt(latest, current)`; ошибки сети классифицируются (timeout/offline/registry) и НЕ роняют CLI.
5. Отдельный guard: пропуск проверки в dev-режиме (`DEV=true`).

Для Vibelog: **только уведомление** (по уточнению Spec), без автоустановки и без `semver`-зависимости (проект zero-runtime-deps) — своё минимальное сравнение версий.

## Ключевое ограничение (правка после плана)

**Проверка registry и показ уведомления — не чаще раза в 24 часа.** Единый TTL кэша = 24 ч и для успешной проверки, и для ошибки: пока кэш свежий (< 24 ч) — и сетевой вызов `npm view`, и вывод уведомления полностью пропускаются. Никакого отдельного более частого ретрая при ошибке нет: офлайн-пользователь получает максимум одну тихую попытку в сутки.

## Файлы

| Файл | Действие |
|---|---|
| `src/cli/update-check.ts` | **новый**, ~170–200 строк |
| `src/cli/commands/version.ts` | экспорт приватной `readPackageInfo()` (строка 30) — убрать дублирование |
| `bin/vibelog.mjs` | +3 строки: вызов `maybeNotifyUpdate()` после `route()` |
| `src/cli/update-check.test.mjs` | **новый**, unit-тесты с моками |
| `src/cli/cli.test.mjs` | в `run()` (строка 23) добавить `VIBELOG_SKIP_UPDATE_CHECK: 'true'` в env |
| `docs/cli-reference.md` | раздел «Автообновление» (после «Глобальные флаги», строка 255) |
| `docs/user-guide.md` | короткий пункт (раздел «Установка») |
| `README.md` | строка ~25: сверить текст с фактическим форматом сообщения (уже описан `VIBELOG_SKIP_UPDATE_CHECK`) |

## `src/cli/update-check.ts` — содержимое

1. **`compareVersions(a: string, b: string): number`** — мини-semver: `major.minor.patch[-prerelease]`, числовое сравнение частей; prerelease < release; кривой ввод → 0 (не новее). Никаких зависимостей.
2. **`fetchLatestVersion(deps?): Promise<string | null>`** — `execFile('npm', ['view', name, 'version', '--json'], { timeout: 5000, encoding: 'utf8', windowsHide: true })`; парсинг: строка | массив с одним элементом-строкой | пустой stdout → `null`; `deps.exec` injectable для тестов.
3. **Кэш — единый TTL 24 ч** — файл `join(os.tmpdir(), 'vibelog-update-check.json')`: `{ checkedAt: number, latest?: string, current?: string, error?: boolean }`. Если `Date.now() - checkedAt < 24h` → тихий выход до сетевых вызовов и до вывода уведомления (это ограничение «раз в 24 часа» и для проверки, и для уведомления). Читается/пишется через `try/catch` (tmpdir могут чистить — просто пересоздаём).
4. **`shouldSkip(argv: string[], env): boolean`** — skip при:
   - `env.VIBELOG_SKIP_UPDATE_CHECK` = `true|1|yes` (env-имя уже зафиксировано в README);
   - команда из списка `['mcp', 'browser', 'bot', 'qwen-debug']` (длинноиграющие, JSON-RPC по stdout в mcp — не мешаем);
   - флаги `-v` / `--version` (контракт Backlog.md: `-v` выводит только номер версии).
5. **`maybeNotifyUpdate(argv?, env?, deps?)`** — публичная точка входа:
   - skip-проверки → тихий выход;
   - **свежий кэш (< 24 ч, успех или ошибка) → тихий выход** (ни npm view, ни уведомления);
   - иначе: текущая версия из package.json (через экспортированный `readPackageInfo` из `commands/version.js`), `fetchLatestVersion()` под `Promise.race` с **3000 мс** (жёсткий предел задержки CLI);
   - `compareVersions(latest, current) > 0` → в stderr: `⚠ Доступна новая версия для обновления: npm install -g vibelog.md (текущая: 1.6.0 → новая: 1.7.0)` (через `printWarning` из `cli/ui.js` — тот пишет в `console.error`, stdout не трогаем);
   - любые ошибки — молча + запись `error: true` в кэш с тем же `checkedAt` (следующая попытка — не раньше чем через 24 ч). Уведомление в stderr не ломает ни `-v`, ни `--json`-режимы.

## `bin/vibelog.mjs` (строки 14–19)

```js
route(process.argv.slice(2))
  .catch(err => { console.error(`Ошибка: ${err.message}`); process.exit(1); })
  .then(() => maybeNotifyUpdate(process.argv.slice(2)));
```
При ошибке route — process.exit(1), then не выполняется (ok). Роутер НЕ трогаем — минимальное вмешательство.

## Порядок действий

1. `src/cli/commands/version.ts`: `function readPackageInfo` → `export function readPackageInfo`.
2. Создать `src/cli/update-check.ts` (все функции выше, подробные комментарии на русском).
3. Подключить в `bin/vibelog.mjs`.
4. Тесты `src/cli/update-check.test.mjs` (моки exec/now/cachePath, без сети):
   - `compareVersions`: равные / новее / старее / prerelease vs release / кривой ввод;
   - `fetchLatestVersion`: строка, массив npm 12+, пустой stdout, кривой JSON, ошибка exec;
   - **TTL 24 ч: свежий кэш (и успех, и ошибка) → exec НЕ вызывается и уведомление не выводится; кэш старше 24 ч → exec вызывается**;
   - `shouldSkip`: env-guard, команды mcp/browser/bot, `-v`;
   - `maybeNotifyUpdate`: при новой версии пишет в stderr (мок console.error) точный текст с `npm install -g vibelog.md`; при свежем кэше уведомление не показывается повторно;
   - сообщение об ошибке сети не показывается пользователю.
5. `src/cli/cli.test.mjs`: env-guard в `run()`.
6. Документация: `docs/cli-reference.md` (раздел + env), `docs/user-guide.md`, сверка README. В docs явно указать лимит: «проверка не чаще раза в 24 часа».

## Проверка

```bash
pnpm build
node --test src/cli/update-check.test.mjs
pnpm test          # полный прогон (build + node --test src)
pnpm lint          # node --check bin/*.mjs
```
Ручная (в temp-директории, вне интернета ок):
```bash
VIBELOG_SKIP_UPDATE_CHECK=true node bin/vibelog.mjs -v   # без задержки, только версия
node bin/vibelog.mjs task list                            # первый запуск — ≤3с, далее сутки тихо
node bin/vibelog.mjs mcp start                            # без уведомления
```

## Риски

1. **Задержка CLI ≤3 с не чаще раза в 24 часа** (первый запуск после пустого/старого кэша) — смягчено `Promise.race(3000 мс)` + единый TTL 24 ч; при ошибке следующая попытка тоже через 24 ч (без частых ретраев).
2. **npm вне PATH / медленный прокси** — ошибка молча глотается, CLI работает как раньше; кэш с ошибкой — тоже сутки.
3. **`-v`-контракт Backlog.md** — уведомление только в stderr, stdout не трогаем; плюс явный skip для `-v`/`--version`.
4. **Тесты идут в сеть** — skip-env в `cli.test.mjs`, все unit-тесты на моках.
5. **tmpdir чистится между запусками** — кэш пересоздаётся, деградация = один лишний npm view в сутки.
6. **Конфликт имён/переиспользование `readPackageInfo`** — если экспорт из version.ts неудобен, дублировать 10 строк локально (решение на этапе кода).
7. **Windows** (`npm.cmd`) — вне целевой платформы (Catalina), не поддерживаем.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 14:49
---
Фаза 1 (Spec) выполнена. Заголовок: оставлен. Масштаб: не определён (описание неполное). Жду ответов на вопросы:
### 1. Где находятся исходники qwen, в которых нужно изучить реализацию автообновления (локальный путь к репозиторию или ссылка на GitHub)?
→ 
### 2. Какое поведение автообновления требуется в Vibelog.md?
- [ ] Проверка новой версии при каждом запуске CLI + уведомление
- [ ] Фоновая периодическая проверка + автоустановка
- [ ] Только уведомление без установки
- [ ] Другое → 
### 3. Что делать при обнаружении новой версии?
- [ ] Автоматически установить новую версию (npm install -g)
- [ ] Предложить пользователю установить (с подтверждением)
- [ ] Только сообщить о доступной версии
- [ ] Другое → 
### Дополнительные комментарии
→ 
---
author: @agent
created: 2026-10-06 14:56
---
Фаза 1 (Spec) выполнена по ответам пользователя. Заголовок: оставлен. Масштаб: task. Уточнено: референс `refs/qwen-code`; поведение — только уведомление о новой версии с подсказкой `npm install -g`, без автоустановки. Описание дополнено, критерии приёмки добавлены. Вопросов нет.
---
author: @agent
created: 2026-10-06 15:08
---
Фаза 2 (Plan) выполнена. Тип: task. План записан в задачу: новый модуль `src/cli/update-check.ts` (~5 функций), подключение в `bin/vibelog.mjs`, экспорт `readPackageInfo` из `version.ts`, тесты на моках, docs (cli-reference/user-guide/README). Референс изучен: `refs/qwen-code/packages/cli/src/ui/utils/updateCheck.ts` — `npm view <pkg> dist-tags.latest --json` через execFile с timeout 5s, парсинг строки/массива (npm ≤11 / 12+), молчаливая классификация сетевых ошибок; от семер-зависимости отказываемся (zero-runtime-deps) — своё минимальное сравнение версий. Уведомление только в stderr (контракт `-v` не ломаем), кэш в tmpdir (TTL 24ч / 1ч при ошибке), жёсткий предел задержки CLI 3с, skip-список команд (mcp/browser/bot/qwen-debug), env-guard `VIBELOG_SKIP_UPDATE_CHECK` (имя уже зафиксировано в README). Файлов: 2 новых (модуль + тесты), 6 правок. Риски: ≤3с задержки раз в сутки при пустом кэше; офлайн деградирует молча; тесты не ходят в сеть благодаря guard в cli.test.mjs.
---
author: @agent
created: 2026-10-06 15:12
---
План уточнён по замечанию: проверка registry и показ уведомления — **не чаще раза в 24 часа**. Введён единый TTL кэша 24 ч: пока кэш свежий (успех или ошибка), и `npm view`, и вывод уведомления полностью пропускаются; отдельного более частого ретрая при ошибке больше нет — офлайн-пользователь получает максимум одну тихую попытку в сутки. Обновлены: раздел «Ключевое ограничение», логика кэша (п.3), шаг 5 тестов (свежий кэш → exec не вызывается и уведомление не дублируется), раздел «Риски» и ручная проверка.
---
author: @agent
created: 2026-10-06 19:08
---
Фаза 3 (Code) выполнена. Изменено: `src/cli/update-check.ts` (новый, 286 строк), `src/cli/update-check.test.mjs` (новый, 25 тестов), `src/cli/commands/version.ts` (экспорт `readPackageInfo`), `bin/vibelog.mjs` (+`maybeNotifyUpdate` после `route()`), `src/cli/cli.test.mjs` (env-guard `VIBELOG_SKIP_UPDATE_CHECK=true` в `run()`), `docs/cli-reference.md` (раздел «Автообновление»), `docs/user-guide.md` (пункт в разделе 1), `README.md` (уточнён текст уведомления).
Реализация по плану: мини-semver `compareVersions` (без зависимости semver — zero-runtime-deps), `fetchLatestVersion` через `npm view <pkg> version --json` (парсинг строка/массив npm ≤11/12+, пустой stdout и кривой JSON → null, ошибки exec → null молча), единый TTL кэша 24 ч (`<tmpdir>/vibelog-update-check.json`, успех и ошибка — одинаковый), `Promise.race` с 3000 мс + `AbortController` (npm child убивается по таймауту, CLI не зависает), `shouldSkip` (env-guard true/1/yes, команды mcp/browser/bot/qwen-debug, флаги -v/--version), уведомление только в stderr (`console.error`, не `printWarning` — тот пишет в console.log и сломал бы контракт `-v`/`--json`).
Проверки: `tsc` (strict) — 0 ошибок; `node --test src/cli/update-check.test.mjs src/cli/cli.test.mjs` — 37/37 OK; ручные: первый запуск со стёртым кэшем 2.1 с (≤3 с), повторный 0.29 с, `-v` 0.26 с без уведомления, `mcp --help` мгновенно без записи кэша, env-guard 0.26 с; registry отвечает `"1.6.0"` (формат npm ≤11 распознаётся). `pnpm build`/`pnpm lint` падают на dyld `_pwritev` (Catalina-проблема окружения, `node --check` bin OK).
Что осталось: DoD #1 «Тесты проходят» — полный прогон `node --test "src/**/*.test.mjs"`: 721 pass / 17 fail; эти 17 падений **предсуществующие** и не связаны с VL-101 — проверено stash-сравнением (без моих правок: 693 pass / 17 fail, те же файлы: config-cli, batch-checklist, search-cli, create-flags и др.). Причина — DeprecationWarning `punycode` от Node 22.8 в stderr засоряет вывод subprocess и роняет строгие `assert.equal` (источник: `whatwg-url@5` → `node:readline` chain, детерминируется `--trace-deprecation`). Отдельной задачей стоит: (а) подавление warning (`NODE_NO_WARNINGS=1` в тестовых spawn или апгрейд whatwg-url), (б) рассмотреть добавление env-guard во все test-хелперы, спавнящие CLI (сейчас guard только в cli.test.mjs по плану).
---
author: @agent
created: 2026-10-06 19:11
---
Фаза Close выполнена. Статус: Done. Коммит feat: f65dcc2 «feat: VL-101 — уведомление о новой версии из npm (только уведомление, TTL 24ч)» (7 файлов: update-check.ts/.test.mjs, bin/vibelog.mjs, cli.test.mjs, README, docs). Экспорт readPackageInfo из version.ts ранее попал в коммит 0150b9e (VL-104) — отдельного feat-коммита не требовал. Файлы VL-104 (scripts/tmp-vl104-*.mjs) и backlog/config.yml в коммиты не включались.
---
<!-- COMMENTS:END -->