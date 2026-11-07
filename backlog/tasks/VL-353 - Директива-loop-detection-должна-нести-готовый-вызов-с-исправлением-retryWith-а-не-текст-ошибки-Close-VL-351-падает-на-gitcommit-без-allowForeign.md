---
id: VL-353
title: 'Директива loop detection должна нести готовый вызов с исправлением (retryWith), а не текст ошибки — Close VL-351 падает на git_commit без allowForeign'
status: In Progress
assignee: []
reporter: ''
created_date: '2026-11-07 14:41'
updated_date: '2026-11-07 15:17'
due_date: ''
labels:
  - agent
  - mcp
  - noop
  - bug
dependencies: []
milestone: ''
references: []
priority: high
type: bug
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/mcp/tool-result.ts
  - src/mcp/git-commit.ts
  - src/agent/loop.ts
  - src/agent/loop.test.mjs
  - src/mcp/git-commit.test.mjs
  - src/mcp/write-ack.test.mjs
lessons: []
token_usage:
  input: 6041300
  output: 27002
  cache: 5880320
  total: 6068302
  requests: 87
  duration_ms: 565775
  reasoning: 12375
  by_phase:
    code:
      input: 5365086
      output: 24906
      cache: 5223936
      requests: 69
    close:
      input: 676214
      output: 2096
      cache: 656384
      requests: 18
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Close VL-351 упал кодом 1 (сессия `agent-1794050949211`): модель 6 раз дословно повторила `git_commit` без `allowForeign`, получила отказ `foreignPaths` и умерла по `MAX_ERROR_REPEATS_PER_RUN`.

```
git_commit {paths:[CHANGELOG.md, doc-8, doc-10], message:"docs: VL-351 — документация и CHANGELOG"}
→ {"ok":false,"error":"…не принадлежат задаче VL-351… передай allowForeign: true"}
× 6 → fail
```

Это третий рецидив класса (VL-318 → VL-323 → сейчас). VL-323 добавил текст ошибки в директиву — и подсказка «передай allowForeign: true» в ней ЕСТЬ (в хвосте). Модель её прочитала и всё равно повторила.

## Корень

Директива **описательная, а не императивная**: «исправь аргументы» требует от модели шага «прочитать текст → вывести нужный аргумент → переписать вызов». Слабая модель (deepseek-flash) этот шаг не делает.

Плюс `clipErrorText` режет текст посередине слова (`…осоз` → `…нанно`), добавляя шума.

## Решение

Отказ write-инструмента должен нести **машиночитаемый набор исправлений**, а директива — **готовый вызов**:

- `ackErrorDetailed` получает аддитивное поле `retryWith` (например `{allowForeign: true}`);
- `git_commit` при `foreignPaths` отдаёт `retryWith: {allowForeign: true}`;
- `loopDetectionDirective` собирает готовый JSON: аргументы повторённого вызова + `retryWith`, и показывает его модели целиком.

Вместо «исправь аргументы» модель видит:

```
Loop detection: git_commit — предыдущий вызов отклонён. Повтори так:
git_commit {"paths":[…],"message":"…","allowForeign":true}
```

## Границы

- Падение фазы на косметике НЕ убираем — осознанное решение: иначе дефекты не всплывают.
- Механизм общий: `retryWith` может использовать любой write-инструмент, не только `git_commit`.
- Инвариант < 400 байт на директиву (VL-310) сохраняется.

## Связанные задачи

VL-318 (ackError не считается применённым), VL-323 (директива с текстом ошибки), VL-351 (hint в директиве), VL-310 (размер директив).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `ackErrorDetailed` (`src/mcp/tool-result.ts`) принимает аддитивное поле `retryWith?: Record<string, unknown>` — машиночитаемый набор аргументов, которые надо добавить/изменить в вызове; попадает в JSON-ответ как `retryWith`
- [x] #2 `git_commit` (`src/mcp/git-commit.ts:298`) при отказе `foreignPaths` отвечает `ackErrorDetailed` с `retryWith: { allowForeign: true }` и `hint`; текст ошибки и `ok:false` не меняются (совместимость с VL-318/323)
- [x] #3 `loopDetectionDirective` (`src/agent/loop.ts:392`) при наличии `retryWith` в последнем отказе выдаёт ГОТОВЫЙ вызов: имя инструмента + JSON аргументов с подставленным `retryWith`, а не описательное «исправь аргументы»
- [x] #4 Готовый вызов собирается из аргументов ПОВТОРЁННОГО вызова (они есть в сигнатуре) + `retryWith`; при отсутствии аргументов в директиве остаётся только фрагмент `retryWith`
- [x] #5 Длина директивы остаётся < 400 байт (инвариант VL-310): при превышении JSON-фрагмент усекается по правилу `clipErrorText`, маркер «Loop detection» сохраняется
- [x] #6 Без `retryWith` поведение не меняется: директива как сейчас (текст ошибки / общая формулировка)
- [x] #7 Регресс-тест `src/agent/loop.test.mjs` на сессию `agent-1794050949211`: `git_commit` без `allowForeign` → отказ с `retryWith` → директива содержит `"allowForeign": true` и имя `git_commit`; повтор с исправленными аргументами доходит до handler
- [x] #8 Тест `src/mcp/write-ack.test.mjs`: `git_commit` с чужими путями → `ok:false`, `retryWith.allowForeign === true`, `hint` непустой
- [x] #9 `pnpm build && pnpm test` проходят без регрессий
- [ ] #10 Документация: doc-8 (поле `retryWith` в контракте ack), doc-10 §6 (директива с готовым вызовом), CHANGELOG.md
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Файлы

- `src/mcp/tool-result.ts` — `ackErrorDetailed` + поле `retryWith`.
- `src/mcp/git-commit.ts` — отказ `foreignPaths` с `retryWith`.
- `src/agent/loop.ts` — `loopDetectionDirective` собирает готовый вызов; `lastErrorBySignature` хранит `retryWith`.
- Тесты: `src/mcp/write-ack.test.mjs`, `src/agent/loop.test.mjs`.
- Документация: `backlog/docs/doc-8`, `backlog/docs/doc-10` §6, `CHANGELOG.md`.

## Шаг 1. `ackErrorDetailed` — поле `retryWith`

`src/mcp/tool-result.ts:380`. Расширить `extra`:

```ts
export function ackErrorDetailed(
  message: string,
  extra: {
    missing?: SkippedField[];
    hint?: string;
    applied?: Record<string, unknown>;
    retryWith?: Record<string, unknown>;   // VL-353
  } = {},
): string
```

В JSON добавить аддитивно (как `missing`/`hint`): `...(extra.retryWith && Object.keys(extra.retryWith).length > 0 ? { retryWith: extra.retryWith } : {})`.

`ackError` не трогать — он остаётся обёрткой без деталей.

## Шаг 2. `git_commit` — отказ с `retryWith`

`src/mcp/git-commit.ts:298`. Заменить `ackError(...)` на `ackErrorDetailed(...)`:

```ts
return ackErrorDetailed(
  `git_commit: эти файлы не принадлежат задаче ${taskId}: ${foreign.join(', ')}. `
  + 'Коммить только файлы задачи; если это осознанно — передай allowForeign: true.',
  {
    retryWith: { allowForeign: true },
    hint: 'Добавь в вызов `allowForeign: true` — без него git_commit отклоняет чужие пути ВСЕГДА.',
  },
);
```

Текст `error` и `ok:false` не меняются — совместимость с VL-318 (отказ не считается применённым) и VL-323 (текст в директиве) сохраняется.

## Шаг 3. `src/agent/loop.ts` — директива с готовым вызовом

Три точки:

1. **`parsedErrorText`** (`:440`) сейчас возвращает `{text, fromHint}`. Добавить извлечение `retryWith`: вернуть `{text, fromHint, retryWith?}`.
2. **`lastErrorBySignature`** (`Map<string, string>`) — хранить объект `{text, fromHint, retryWith}` вместо строки. Проверить всех потребителей (`search_files lastErrorBySignature`): `blockAndPush`, `errorRepeatOutcome` — оба берут текст, поправить на `.text`.
3. **`loopDetectionDirective`** (`:392`) — новый параметр `retryWith?: Record<string, unknown>` и `callArgs?: Record<string, unknown>`:

```ts
if (retryWith !== undefined) {
  const merged = { ...(callArgs ?? {}), ...retryWith };
  return `Loop detection: ${name} — предыдущий вызов отклонён. Повтори так: `
    + `${name} ${JSON.stringify(merged)}`;
}
```

Аргументы повторённого вызова доступны в `blockAndPush` (`call.arguments`) — передать их.

**Инвариант < 400 байт (VL-310):** готовый JSON может быть длинным (`paths` с кириллическими именами). Если строка превышает лимит — усечь `paths` до первого элемента + `…` и пометить, что остальные пути те же. Маркер «Loop detection» и `retryWith`-поля сохраняются всегда (они и есть смысл директивы).

## Шаг 4. Тесты

`src/mcp/write-ack.test.mjs`:

- `git_commit` с чужими путями → `ok:false`, `retryWith.allowForeign === true`, `hint` непустой, `error` содержит «не принадлежат задаче»;
- `git_commit` с `allowForeign: true` → успех (регресс не ломается).

`src/agent/loop.test.mjs`:

- регресс `agent-1794050949211`: заглушка `git_commit` возвращает `ackErrorDetailed` с `retryWith` → директива содержит `"allowForeign":true` и имя `git_commit`, не содержит «исправь аргументы»; повтор с исправленными аргументами доходит до handler;
- директива < 400 байт при длинном `paths` (кириллица);
- без `retryWith` поведение прежнее (текст ошибки / общая формулировка) — существующие кейсы VL-323 зелёные.

## Шаг 5. Проверка и документация

- `pnpm build && pnpm test` — полный прогон.
- Ручная проверка: воспроизвести Close-шаг с `git_commit` без `allowForeign` → в логе директива с готовым вызовом.
- `backlog/docs/doc-8`: контракт ack — поле `retryWith`, кто его отдаёт.
- `backlog/docs/doc-10` §6: директива loop detection с готовым вызовом, разбор инцидента `agent-1794050949211`.
- `CHANGELOG.md` → `## [Unreleased]` / «Исправлено».

## Риски

- **Размер директивы.** Готовый JSON с путями легко превышает 400 байт. Решение — усечение `paths` с сохранением `retryWith`; проверить тестом на кириллических путях.
- **Смена типа `lastErrorBySignature`** (строка → объект) затрагивает три точки; пропущенный потребитель даст `[object Object]` в директиве. Проверить `search_files` по имени.
- **`retryWith` может быть неверным.** Инструмент сам решает, что добавить; если он соврёт, модель повторит с неверными аргументами и получит новый отказ — не хуже текущего поведения, но стоит держать `retryWith` только для случаев, где исправление однозначно.
- **Падение фазы сохраняется** — осознанно: цель задачи убрать дословные повторы, а не сделать Close непотопляемым.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-11-07 14:58
---
Фаза code не удалась (код выхода 1): e×3, блокировок=0, payload последнего запроса=242308 байт (макс 242308), usage={"input_tokens":495510,"output_tokens":917,"cache_read_input_tokens":462336,"total_tokens":496427,"reasoning_tokens":193} — статус возвращён к Planned.
---
author: @agent
created: 2026-11-07 15:14
---
Фаза 3 (Code) выполнена. Коммит ae79e0d.
Изменено:
- `src/mcp/tool-result.ts` — `ackErrorDetailed` принимает аддитивное `retryWith?: Record<string, unknown>`; в JSON попадает только непустым (пустой объект не отдаём — модель прочла бы как «повтори как есть»). `ackError` не тронут.
- `src/mcp/git-commit.ts` — отказ `foreignPaths` теперь `ackErrorDetailed` с `retryWith: { allowForeign: true }` и `hint`; текст `error` и `ok:false` не изменились (совместимость VL-318/323).
- `src/agent/loop.ts` — `parsedErrorText` извлекает `retryWith` из отказа; `lastErrorBySignature` хранит `{text, fromHint, retryWith}`; `loopDetectionDirective(name, repeatLimit, lastError?, fromHint?, retryWith?, callArgs?)` при наличии `retryWith` собирает ГОТОВЫЙ вызов (`Loop detection: git_commit — предыдущий вызов отклонён. Повтори так: git_commit {…,"allowForeign":true}`) из аргументов повторённого вызова + `retryWith`. Инвариант < 400 байт (VL-310): при длинном JSON `paths` усекаются до первого элемента с пометкой «остальные пути — те же», `retryWith` и маркер «Loop detection» сохраняются всегда; последний рубеж — фрагмент `retryWith` через `clipErrorText`. Без `retryWith` поведение прежнее (текст ошибки / общая формулировка).
- Тесты: `src/agent/loop.test.mjs` (регресс `agent-1794050949211`: директива содержит `"allowForeign":true` и имя `git_commit`, не содержит «исправь аргументы», исправленный вызов доходит до handler; директива < 400 байт на длинных кириллических путях с сохранением `retryWith`; без `retryWith` — прежняя формулировка), `src/mcp/write-ack.test.mjs` (retryWith в JSON, отсутствие поля без исправления, `ackError` — обёртка), `src/mcp/git-commit.test.mjs` (отказ с чужими путями → `retryWith.allowForeign === true` + непустой `hint`; успех с `allowForeign: true` — регресс не сломан).
Проверки: `pnpm build` — успешно; полный `pnpm test` — 184 файла, 3474 теста passed, 4 skipped, 0 failed (без --exclude/--skip).
Что осталось (Фаза Close): документация — doc-8 (поле `retryWith` в контракте ack), doc-10 §6 (директива с готовым вызовом, разбор инцидента `agent-1794050949211`), CHANGELOG.md. В фазе Code эти файлы по регламенту не правятся.
---
<!-- COMMENTS:END -->