---
id: VL-240
title: 'llm.test.mjs: изолировать тесты от локального .vibelog/settings.json (24 устойчивых падения)'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-30 02:05'
updated_date: '2026-10-30 02:48'
due_date: ''
labels:
  - tests
  - llm
  - settings
dependencies:
  - VL-209
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/llm.test.mjs
  - src/agent/llm.ts
  - AGENTS.md
lessons:
  - lesson-78
token_usage:
  input: 1656359
  output: 26781
  cache: 1460224
  total: 1683140
  requests: 44
  duration_ms: 543754
  reasoning: 13601
  by_phase:
    plan:
      input: 406332
      output: 9692
      cache: 327168
      requests: 13
    code:
      input: 1250027
      output: 17089
      cache: 1133056
      requests: 31
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

`src/agent/llm.test.mjs` падает **24 тестами** в главном репозитории, если в локальном (gitignored) `.vibelog/settings.json` задан `models.default` с `api_mode: responses`: `createLlmClient` резолвит активную модель через `resolveActiveModel(options.cwd ?? process.cwd())` и уводит фейковый fetch на `/responses`, тогда как тесты ожидают `/chat/completions`.

Это уже зафиксировано в **lesson-78** (источник VL-218) с ручным обходом: «временно убери `models.default` в одной shell-команде, прогони, верни файл». Именно этот обход выполнялся в фазе Close VL-227 (`mv .vibelog/settings.json .vibelog/settings.json.bak` → `pnpm test` → `mv` обратно) — то есть урок применён, но **дефект не устранён**: каждая фаза Close в главном репо будет спотыкаться о те же 24 падения и тратить на это полный прогон.

Урок сам говорит: «Настоящий фикс (тесты передают явный `apiMode: 'chat'` в CLIENT_OPTS) — отдельной задачей». Эта задача — он.

## Цель

Сделать `llm.test.mjs` независимым от локальной конфигурации разработчика: тест должен проверять код, а не содержимое gitignored-файла.

## Что менять (проверить в Plan)

- `src/agent/llm.test.mjs` — `CLIENT_OPTS` (строка ~67): добавить `apiMode: 'chat'`; проверить, что все места создания клиента в файле идут через эти опции. Для тестов, которые **умышленно** проверяют чтение секции models (VL-209), cwd передаётся на временный каталог — они остаются как есть.
- Возможно, `src/agent/llm.ts` — рассмотреть, не стоит ли `createLlmClient` без явного `cwd` не читать `process.cwd()` (сомнительно: боевое поведение меняется; решение фиксировать в Plan). Предпочтение — правка тестов, не рантайма.
- Добавить регрессионный тест-инвариант: при явном `apiMode: 'chat'` URL заканчивается на `/chat/completions` независимо от cwd.

## Почему приоритет High

Падения воспроизводятся **в каждой фазе Close** в главном репо (у автора проекта `settings.json` с `models` есть постоянно) и маскируют реальные регрессии: в VL-227 агент потратил ~30 минут именно на распутывание этих падений, трижды прогнав полный набор.

## Связанное

- lesson-89 (второй, независимый источник плавающих падений — фиксированные `/tmp`-пути CLI-тестов) — отдельная задача.
- VL-239 (модель должна фиксироваться в мете сессии) — не пересекается по правкам, но затрагивает тот же `resolveActiveModel`/`createLlmClient`; при реализации учитывать приоритет явных опций над settings.
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## План реализации VL-240

### Решение по архитектуре: правим только тест, рантайм `createLlmClient` не трогаем

`src/agent/llm.ts:837` — `resolveActiveModel(options.cwd ?? process.cwd())`. Менять это (например, не читать `process.cwd()` без явного `cwd`) нельзя: боевое поведение `vibelog agent`/`bot`/`browser` полагается на резолв активной модели из `.vibelog/settings.json` в cwd (VL-209), и это документировано в README:192-211 и backlog/docs/doc-7 (раздел про `--api-mode`). Предпочтение из описания задачи («правка тестов, не рантайма») принято окончательно.

### Файлы для изменения

1. `src/agent/llm.test.mjs` — основная правка (1 строка + 1 новый тест, ~10 строк).
2. `src/agent/llm.ts` — только комментарий-JSDoc у `createLlmClient` (без изменения поведения, опционально). Рекомендуется: зафиксировать инвариант «явный `apiMode` приоритетнее `active.apiMode`», чтобы регрессия не вползла.
3. `AGENTS.md` / документация — по DoD «Документация обновлена»: добавить п. в AGENTS.md про изоляцию тестов LLM-клиента от локального `settings.json` (одна строка, рядом с правилами про тесты в разделе «Важные правила»).

Что НЕ меняем: блок `describe('createLlmClient: секции settings.json (VL-209)')` (строки 889-985) — он умышленно передаёт `cwd: dir` на временный каталог; тесты 927/944/956/972 остаются как есть.

### Конкретные места

**1. `src/agent/llm.test.mjs:67`** — `CLIENT_OPTS`:
```js
// было
const CLIENT_OPTS = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', retryDelayMs: 1 };
// станет (VL-240: явный режим — тесты не зависят от models.default в локальном .vibelog/settings.json)
const CLIENT_OPTS = { baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'm', retryDelayMs: 1, apiMode: 'chat' };
```
Комментарий над строкой — почему: `resolveActiveModel(process.cwd())` в главном репо видит `models.default` с `api_mode: responses` и уводит URL на `/responses` (lesson-78/84).

**2. `src/agent/llm.test.mjs:882`** — есть `createLlmClient({ ...CLIENT_OPTS, fetchImpl: impl, apiMode: 'chat' })` (тест «apiMode chat явно») — после правки п.1 возникает дубль, но это осознанно: явный `apiMode: 'chat'` перекрывает `CLIENT_OPTS`. Оставить без изменений (лишний spread безвреден), либо убрать дублирующий ключ — на усмотрение Code. Правка не обязательна.

**3. `src/agent/llm.test.mjs` — все тесты на `responses`** (782, 807, 816, 838, 881): у них уже явный `apiMode: 'responses'` — перекрывает `CLIENT_OPTS.apiMode`, поведение не меняется. Проверить это в Code обязательно.

**4. `src/agent/llm.test.mjs` — новый регрессионный тест** (вставить в `describe('createLlmClient: секции settings.json (VL-209)')`, после теста «берёт model/base_url/api_key…», ~строка 936, либо отдельным `it` в конце блока):
```js
it('явный apiMode: chat перекрывает api_mode=responses из settings.json (VL-240, регресс)', async () => {
  // временный каталог с models.default → api_mode: responses
  const dir = fixture(settingsFull({ modelsExtra: undefined }));
  // перезаписать available api_mode на responses:
  writeFileSync(join(dir, '.vibelog', 'settings.json'), JSON.stringify({
    providers: { routerai: { base_url: 'https://routerai.test/api/v1', api_key_env: 'VL209_TEST_KEY' } },
    models: { default: 'routerai/Resp', available: { 'routerai/Resp': { label: 'Resp', provider: 'routerai', model: 'Resp', api_mode: 'responses' } } },
  }));
  process.env.VL209_TEST_KEY = 'env-key';
  try {
    const { impl, state } = fakeFetch([sseResponse([])]);
    const client = createLlmClient({ cwd: dir, fetchImpl: impl, apiMode: 'chat', retryDelayMs: 1 });
    await client.streamChat([{ role: 'user', content: 'x' }], []);
    assert.equal(state.urls[0], 'https://routerai.test/api/v1/chat/completions', 'явный apiMode перекрывает settings');
    assert.ok(JSON.parse(state.bodies[0]).messages, 'chat-тело: messages');
  } finally {
    restore();
    rmSync(dir, { recursive: true, force: true });
  }
});
```
Плюс симметричный/или достаточный инвариант: тот же cwd без `apiMode` → `/responses` (доказывает, что фикстурa реально влияет и тест не «зелёный из-за пустого settings»).

**5. `src/agent/llm.ts:850-852`** — только комментарий (поведение не меняется):
```
// VL-205/209: приоритет — явная опция (флаг --api-mode), затем api_mode активной модели
// из settings.json, затем 'chat'. Тесты передают apiMode явно, чтобы не зависеть от cwd (VL-240).
```

**6. `AGENTS.md`** — в раздел «Важные правила» добавить пункт:
«Тесты LLM-клиента (`src/agent/llm.test.mjs`) всегда передают `apiMode` явно: иначе `createLlmClient` читает `models.default` из локального (gitignored) `.vibelog/settings.json` и тесты падают на машине разработчика с `api_mode: responses` (VL-240, lesson-78/84).»

### Порядок действий

1. Прочитать `src/agent/llm.test.mjs` (уже изучено: CLIENT_OPTS — строка 67; settings-блок 889-985) — Code читает полностью перед правкой.
2. Правка `CLIENT_OPTS` (+ `apiMode: 'chat'`, комментарий).
3. Добавить новый регрессионный тест (п.4) в settings-блок, используя существующие `fixture`/`restore`/`fakeFetch`.
4. Grep-проверка: все `createLlmClient(` в тесте — либо спред `...CLIENT_OPTS`, либо явный `apiMode`, либо settings-блок с `cwd: dir`. Исключение — тест строки 318 (`createLlmClient({ baseUrl, fetchImpl })`, проверка ошибки «нет модели»): там `apiMode` не нужен, ошибка кидается до использования режима; при желании добавить `apiMode: 'chat'` для однородности.
5. Комментарий-JSDoc в `src/agent/llm.ts` (п.5).
6. Строка в `AGENTS.md` (п.6).
7. `pnpm build` → `pnpm test` (полный, через `env -u VIBELOG_CWD` — lesson-88; не параллельно с прогонами в других worktree — lesson-89).

### Как проверить

```bash
pnpm build
env -u VIBELOG_CWD npx vitest run src/agent/llm.test.mjs    # локально: должно быть зелёно ПРИ наличии models.default=responses
pnpm test                                                   # полный прогон перед DoD
```
Ключевая проверка дефекта (обязательна в Code/Close): прогнать `llm.test.mjs` **на главном репо**, где `.vibelog/settings.json` содержит `models.default` с `api_mode: responses`, без ручного отключения настроек (`mv settings.json` больше не нужен). Дополнительно — прогон в worktree (там settings.json может отсутствовать) — оба должны быть зелёными.

Регрессия: проверить, что тест «переключатель: дефолт chat → /chat/completions» (строка 855) и все `responses`-тесты (782-882) не изменили ожидаемых URL — полный прогон + точечный запуск файла.

### Риски

- **Приоритет опций**: правка полагается на `options.apiMode ?? active?.apiMode ?? 'chat'` (`llm.ts:852`). Если кто-то поменяет порядок — тест п.4 упадёт, значит регрессия поймана. Риск низкий, поведение покрыто новым тестом.
- **Протечка env** (`VIBELOG_LLM_MODEL`/`BASE_URL`/`API_KEY`) между тестами при `isolate: false` (lesson-57): новые тесты в settings-блоке обязаны идти через существующие `restore()`/`delete` — новый тест использует тот же паттерн `try/finally`.
- **Дубликат `apiMode: 'chat'`** на строке 882 после правки CLIENT_OPTS — косметика, не влияет на поведение; можно убрать.
- **`cwd: dir` в тесте п.4**: обязательно `dir` временный, иначе снова зависимость от локальной конфигурации — проверять в диффе.
- **Не менять рантайм**: любое изменение `resolveActiveModel(options.cwd ?? process.cwd())` вне области задачи — отклонять (боевое поведение + VL-239 пересекается по этому коду).

### Оценка объёма

1 файл тестов (2-3 правки), 1 строка комментария в `llm.ts`, 1 абзац в `AGENTS.md`. Отдельные задачи/блокеры не нужны — задача самодостаточна (lesson-89 — отдельная задача, как указано в описании).
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-30 02:14
---
Фаза 2 (Plan) выполнена. Тип: bug (обычная задача, не эпик) — план записан в задачу.
Решения:
- Правим только тест, рантайм `createLlmClient`/`resolveActiveModel` не трогаем: `resolveActiveModel(options.cwd ?? process.cwd())` (src/agent/llm.ts:837) — боевое поведение VL-209, документировано в README:192-211 и doc-7; отказ от `process.cwd()` сломал бы `vibelog agent|bot|browser`.
- Основная правка: `CLIENT_OPTS` (src/agent/llm.test.mjs:67) + `apiMode: 'chat'` + комментарий про lesson-78/84.
- Блок `describe('… секции settings.json (VL-209)')` (889-985, тесты 927/944/956/972) остаётся как есть — там умышленный `cwd: dir` на временный каталог.
- Новый регресс-тест: `cwd` на фикстуру с `models.default` + `api_mode: responses`, явный `apiMode: 'chat'` → URL `/chat/completions`; симметрично без `apiMode` → `/responses` (доказывает, что фикстура влияет).
- `src/agent/llm.ts:850-852` — только JSDoc-комментарий о приоритете явной опции, поведение не меняется.
- AGENTS.md — один пункт в «Важные правила» про обязательный явный `apiMode` в llm-тестах (DoD «Документация обновлена»).
Файлов в плане: 3 (llm.test.mjs — правки; llm.ts — комментарий; AGENTS.md — пункт); все существуют (проверено ls). Дополнительные задачи/блокеры не нужны.
Проверка (в Code/Close): `pnpm build` → `env -u VIBELOG_CWD npx vitest run src/agent/llm.test.mjs` на ГЛАВНОМ репо с `models.default`/`api_mode: responses` без ручного `mv settings.json` (основной критерий устранения дефекта) → полный `pnpm test` (lesson-88/89: через env -u VIBELOG_CWD, не параллельно с другими worktree).
Риски: смена порядка приоритета в `options.apiMode ?? active?.apiMode ?? 'chat'` (поймана новым тестом); протечка env между тестами при isolate:false (lesson-57 — использовать существующие `restore()`/try-finally); любое изменение рантайма вне области задачи отклонять (пересечение с VL-239).
---
author: @agent
created: 2026-10-30 02:23
---
Фаза 3 (Code) выполнена. Изменено: `src/agent/llm.test.mjs`, `src/agent/llm.ts` (только комментарий), `AGENTS.md`; коммит 4936de8.
Что сделано по плану:
1. `CLIENT_OPTS` (llm.test.mjs:74) — добавлен `apiMode: 'chat'` + комментарий-объяснение (почему нельзя оставлять дефолт: `resolveActiveModel(process.cwd())` подхватывает `models.default` из gitignored `.vibelog/settings.json`).
2. Новый регресс-тест в блоке VL-209 (`явный apiMode: chat перекрывает api_mode=responses из settings.json (VL-240, регресс)`): фикстура с `models.default → api_mode: responses`, контрольная проверка «без apiMode → /responses» (доказывает, что settings реально влияет) и «с `apiMode: 'chat'` → /chat/completions + messages».
3. Дополнительно найдено и исправлено сверх плана: тест «без модели (нет env) → VIBELOG_LLM_MODEL» (llm.test.mjs:320) падал при наличии локального `models.default` — теперь создаёт пустой временный `cwd` (mkdtemp) и удаляет его в finally; раньше он был 25-м скрытым падением (обнаружено эмуляцией локальной конфигурации).
4. `src/agent/llm.ts:850-852` — расширен комментарий: зафиксирован приоритет «явная опция > api_mode активной модели > 'chat'» (поведение не менялось).
5. `AGENTS.md` — новый пункт в «Важные правила» про обязательный явный `apiMode` в llm-тестах и изоляцию от локального settings.json (DoD «Документация обновлена»).
Проверки:
- `pnpm build` — успешно.
- Эмуляция дефекта: создан локальный `.vibelog/settings.json` с `models.default` + `api_mode: responses` (как у автора проекта), затем `env -u VIBELOG_CWD npx vitest run src/agent/llm.test.mjs` → 53/53 passed (до фикса этого теста было 1 failed). Эмуляционный settings.json удалён, в коммит не попал.
- `env -u VIBELOG_CWD pnpm test` (полный, build + `vitest run --exclude src/web/static.test.mjs` + отдельный `vitest run src/web/static.test.mjs`, как в package.json) — успешно, исключённых тест-файлов вне штатной схемы package.json нет (static.test.mjs запускается вторым проходом штатно, lesson-51/52).
Что осталось: Close — финальный прогон после слияния и проверка на главном репо с реальным settings.json. lesson-89 (фиксированные /tmp-пути CLI-тестов) — отдельная задача, здесь не трогалась.
---
author: @agent
created: 2026-10-30 02:26
---
Фаза close не удалась (код выхода 1): ётчик рана — VL-221), payload последнего запроса=108159 байт (макс 108159), usage={"input_tokens":74645,"output_tokens":389,"cache_read_input_tokens":66560,"total_tokens":75034,"reasoning_tokens":105} — статус возвращён к Review.
---
author: @agent
created: 2026-10-30 02:48
---
Фаза Close выполнена.

Ветка `vb/vl-240` слита в master (1 коммит: 4936de8 → merge c17317d), worktree `.vibelog/worktrees/vl-240` удалена (force — только untracked-симлинки node_modules/refs), ветка `vb/vl-240` удалена.

Проверки после merge в главном репо: `pnpm build` — успешно; `env -u VIBELOG_CWD pnpm test` — 85 файлов / 1592 теста passed, 4 skipped, плюс штатный второй проход `src/web/static.test.mjs` (7 passed). То есть дефект подтверждённо устранён: прогон в главном репо с локальным `.vibelog/settings.json` (models.default → api_mode: responses) зелёный без ручного `mv settings.json`.

DoD (3/3 отмечены): «Тесты проходят» — полный прогон зелёный; «Документация обновлена» — AGENTS.md (правило про обязательный явный `apiMode` в llm-тестах) + CHANGELOG.md (Unreleased → Исправлено); «Нет регрессий» — ожидаемые URL в тестах `responses`/`chat` не менялись, регресс-тест в блоке VL-209 ловит смену приоритета опций.

Lessons: обновлён lesson-78 (заголовок переформулирован в правило «тесты LLM-клиента всегда передавай с явным apiMode», тело переписано под фикс VL-240, linked_tasks += VL-240). Документация задачи закоммичена: docs-коммит ae2604f (`docs: VL-240 — CHANGELOG`). Отдельно: вне области задачи остаётся lesson-89 (фиксированные /tmp-пути CLI-тестов) — своя задача.
---
<!-- COMMENTS:END -->