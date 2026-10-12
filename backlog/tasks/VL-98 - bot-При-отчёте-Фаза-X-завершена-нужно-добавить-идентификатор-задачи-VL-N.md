---
id: VL-98
title: '#bot При отчёте Фаза X завершена нужно добавить идентификатор задачи VL-N'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-06 01:02'
updated_date: '2026-10-12 12:10'
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
modified_files:
  - src/bot/formatting.ts
  - src/bot/rich.ts
  - src/bot/handlers.ts
  - src/bot/formatting.test.mjs
  - src/bot/rich.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
#bot При отчёте Фаза X завершена нужно добавить идентификатор задачи VL-N
Так же надо немного поправить форматирование:
1. Ответ модели надо обернуть в цитирование (сейчас он в большинстве случаев просто "Готово")
2. Информация про токены в основном в одну строку, надо перенос строк сделать
3. Добавить отдельный вывод с расчётом Входные токены минус Кэш-токены
4. Время форматировать из мс в более понятный формат минут и секунд
<!-- SECTION:DESCRIPTION:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Контекст (найдено в коде)

Отчёт «Фаза X завершена» собирается в двух рендерах и шлётся одним отправщиком:

- `src/bot/rich.ts` — `renderPhaseResultRich(run: PhaseRun)` (строки 557-592), основной GFM-рендер (VL-71).
- `src/bot/formatting.ts` — `formatPhaseResult(run: PhaseRun)` (строки 142-203), MarkdownV2-фолбэк для старых клиентов.
- `src/bot/handlers.ts` — `sendPhaseResult(bot, chatId, run)` (строка 240): rich → md → plain. Вызывается из `notifyPhaseDone(bot, chatId, task, run)` (строки ~283-291, task есть в параметре!) и из потоков `/prompt` (~850) и resume (~1140) — там задачи нет.
- Все 6 мест вызова `notifyPhaseDone` передают `task` → идентификатор `task.id` (VL-N) доступен у всех реальных завершений фаз (comment/spec/plan/code/close).
- В `PhaseRun` (src/web/orchestrator.ts:37) поля taskId нет — добавлять в оркестратор не будем, прокидываем опциональным параметром рендеров (минимальный след изменений).
- Фикстуры тестов `okRun` в formatting.test.mjs/rich.test.mjs taskId не содержат — опциональный параметр не ломает старые кейсы.

## Целевой формат отчёта (rich, GFM)

```
# Фаза code: завершена (код 0) — VL-98

> Первая строка ответа модели
> вторая строка (каждая строка body — с префиксом "> ")

**Токены:** входные: 10956 · сгенерированные: 320 · кэш: 8000 · всего: 11276
**Входные минус кэш:** 2956

**Общее время:** 1м 23с (api: 20с)
**Количество запросов:** 5

`qwen:<session_id>`
```

MarkdownV2-фолбэк — аналогично: `*...*` вместо `**...**`, body и taskId экранированы (`VL\-98`).

## Изменяемые файлы (5)

### 1. src/bot/formatting.ts
- Новый экспорт `formatDuration(ms: number): string` (после `escapeMarkdownV2`, ~строка 150):
  - `< 1000` → `` `${ms} мс` ``;
  - `< 60_000` → `` `${Math.round(ms/1000)}с` ``;
  - иначе `` `${Math.floor(ms/60000)}м ${Math.round((ms%60000)/1000)}с` ``.
- `formatPhaseResult(run, taskId?: string)`:
  - Заголовки (строки 146 и 171): после закрывающей `*` дописать ` — ${taskId}` при заданном taskId (обе ветки: завершена и ошибка). Проверено: существующие `includes('*Фаза X: завершена \(код 0\)*')` в тестах продолжат проходить.
  - Body (строки 187-188): каждую строку экранировать `escapeMarkdownV2` и префиксовать `"> "` (blockquote MarkdownV2) — ответ модели в цитате.
  - Токены (строки 194-197): заменить 4 строки одной: `*Токены:* входные: N · сгенерированные: N · кэш: N · всего: N` + новая строка `*Входные минус кэш:* ${input_tokens - cache_read_input_tokens}`.
  - Время (строка 199): `*Общее время:* ${formatDuration(res.duration_ms)} \\(api: ${formatDuration(res.duration_api_ms)}\\)`.
  - Обновить JSDoc (упомянуть VL-98, опциональный taskId).

### 2. src/bot/rich.ts
- Импорт `import { formatDuration } from './formatting.js';` (цикла нет: formatting.ts импортирует только типы из core).
- `renderPhaseResultRich(run, taskId?: string)`:
  - Заголовки (563-566): ` — ${taskId}` в конец обеих строк статуса (shared `status` — ветка фолбэка «Данные результата недоступны» тоже получит VL-N).
  - Body (575-576): `body.split('\n').map((l) => '> ' + l).join('\n')`.
  - Токены (580-583): одна строка `**Токены:** входные: N · сгенерированные: N · кэш: N · всего: N` + `**Входные минус кэш:** N`.
  - Время (585): `**Общее время:** ${formatDuration(res.duration_ms)} (api: ${formatDuration(res.duration_api_ms)})`.
  - Обновить JSDoc.

### 3. src/bot/handlers.ts
- `sendPhaseResult` (строка 240): добавить параметр `taskId?: string`; передать в `renderPhaseResultRich(run, taskId)` (242) и `formatPhaseResult(run, taskId)` (248).
- `notifyPhaseDone` (строка ~289): `await sendPhaseResult(bot, chatId, run, task.id)`.
- Потоки `/prompt` (~850) и resume (~1140) — без изменений: taskId undefined, отчёт без VL-N (там задачи нет — корректно).

### 4. Тесты
- `src/bot/formatting.test.mjs` (~строки 160-230):
  - Обновить ассерты токенов/времени/строк под новый формат; body — assert начинается со строки `"> ..."`.
  - Новый тест: `formatPhaseResult(runWithTaskId, 'VL-98')` → заголовок содержит `— VL\-98`; без taskId — суффикса нет.
  - Юнит-тесты `formatDuration`: 0 → «0 мс», 830 → «830 мс», 20000 → «20с», 83000 → «1м 23с», 3600000 → «60м 0с».
- `src/bot/rich.test.mjs` (~345-425):
  - `assert.match(md, /^# Фаза comment: завершена \(код 0\)/)` пройдёт как есть; добавить ассерты: `— VL-1` в заголовке, `> ` у body, `**Токены:** входные: 10956`, `**Входные минус кэш:** 7000`, `1м 23с`.
  - Кейсы ошибок (exitCode=1, qwenErr) — с taskId, суффикс есть в обоих статусах.
- `src/bot/commands.test.mjs` (436-492) — mock-тексты для `extractSessionRef`, рендереры не вызываются — без правок.

### 5. Документация
- `CHANGELOG.md` — запись VL-98 (новый формат отчёта фазы: VL-N в заголовке, цитата ответа, компактные токены + «Входные минус кэш», время в м/с).
- `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md` — добавить подраздел о формате информационного сообщения о завершении фазы (коротко, с примером).

## Порядок действий
1. `formatDuration` + правки `formatPhaseResult` в formatting.ts.
2. Правки `renderPhaseResultRich` в rich.ts.
3. `sendPhaseResult`/`notifyPhaseDone` в handlers.ts.
4. Обновление/добавление тестов.
5. `pnpm build && pnpm test`.
6. CHANGELOG + руководство пользователя.

## Проверка
- `pnpm build` (tsc strict) — без ошибок типов.
- `pnpm test` — все тесты проходят (build + `node --test src`).
- Ручная (после merge): в Telegram выполнить `/comment VL-N` с любым текстом и убедиться: в заголовке отчёта есть VL-N, ответ модели в цитате, токены одной строкой + строка «Входные минус кэш», время вида «1м 23с (api: 20с)».

## Риски
- **Blockquote в MarkdownV2** требует Bot API ≥ 7.0; парсинг серверный, риск минимален. Если клиент старый/ошибка парсинга — `sendText` имеет цепочку фолбэков rich→md→plain: проверить, что 400 от Telegram не роняет отправку (plain-режим приемлем).
- **Экранирование**: taskId в MarkdownV2-заголовке уходит в `escapeMarkdownV2` (дефис → `VL\-98`); в GFM — как есть. Новый тест это фиксирует.
- **Truncation**: body режется до 1500 символов до префиксации `"> "` — префикс не должен ломать срез (срез по старому body, затем prefix — ок).
- `/prompt` и resume-отчёты остаются без VL-N — это осознанно (задача там неизвестна).
- Старые сообщения в истории чата не меняются — изменения только к новым отправкам.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-06 01:02
---
Фаза 1 (Spec) выполнена. Масштаб: task (все правки касаются одного отчёта «Фаза X завершена»). Уточнено: добавлен идентификатор задачи VL-N в отчёт; критерии приёмки по четырём пунктам форматирования (цитирование ответа модели, переносы строк для токенов, расчёт «Входные токены минус Кэш-токены», время в минуты/секунды). Вопросов нет.
---
author: @agent
created: 2026-10-12 11:54
---
Фаза 3 (Code) выполнена. Изменено: `src/bot/formatting.ts`, `src/bot/rich.ts`, `src/bot/handlers.ts`, `src/bot/formatting.test.mjs`, `src/bot/rich.test.mjs`, `CHANGELOG.md`, `backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md`.
Реализовано по Implementation Plan:
1. **VL-N в заголовке** — `sendPhaseResult` получил опциональный `taskId` и передаёт его в оба рендера; `notifyPhaseDone` передаёт `task.id` (все 6 мест вызова с `task`). Заголовок обеих веток статуса (завершена/ошибка, включая фолбэк без result) получает суффикс ` — VL-N`; в MarkdownV2 taskId экранируется (`VL\-98`). `/prompt` и resume-отчёты — без суффикса (там задачи нет, осознанно).
2. **Цитата ответа модели** — каждая строка body с префиксом `> `; в MarkdownV2 — после escapeMarkdownV2 (валидный blockquote, Bot API ≥ 7.0); срез до 1500 символов — до префиксации.
3. **Токены одной строкой** — `**Токены:** входные: N · сгенерированные: N · кэш: N · всего: N` + новая строка `**Входные минус кэш:** N` (в обоих рендерах).
4. **Время в читаемом формате** — новый экспорт `formatDuration(ms)`: `<1с` → «830 мс», `<60с` → «20с», иначе «1м 23с»; применяется к duration_ms и duration_api_ms.
Проверки: `pnpm build` (tsc strict) — без ошибок; `pnpm test` — все тесты проходят, включая обновлённые (formatting: цитата, компактные токены, входные-минус-кэш, суффикс с экранированием, unit-тесты formatDuration 0/830/20000/59999/83000/60000/3600000; rich: суффикс в обоих статусах ошибок, blockquote, новые строки) — регрессий нет, фикстуры `okRun` без taskId продолжают работать.
Документация: запись в CHANGELOG.md (Unreleased); пример информационного сообщения в руководстве пользователя (doc-6) обновлён под новый формат.
Что осталось: ручная проверка в Telegram после merge (команда `/comment VL-N`: VL-N в заголовке, цитата, токены + «Входные минус кэш», время вида «42с (api: 42с)») и проверка фолбэка MarkdownV2 на старом клиенте (цепочка rich→md→plain защищает от 400).
---
author: @agent
created: 2026-10-12 12:10
---
Фаза Close выполнена. Статус: Done. Коммит feat: b34c0b2 — «VL-98 — VL-N в заголовке отчёта фазы, цитата ответа модели, компактные токены + "Входные минус кэш", время в формате м/с» (7 файлов: src/bot/formatting.ts, rich.ts, handlers.ts, тесты, CHANGELOG.md, doc-6 — руководство пользователя). Не закоммичено: templates/qwen-commands/phase-2.md, phase-3.md (чужие изменения после коммита a0a3c57,不属于 этой задаче — вероятно, другая фаза/VL-110) и backlog/tasks/VL-111 (untracked, чужая задача) — не входят в modified_files VL-98, guard от гонки.
---
author: @agent
created: 2026-10-12 12:10
---
Уточнение к предыдущему комментарию (опечатка): templates/qwen-commands/phase-2.md и phase-3.md — не принадлежат задаче VL-98 (изменены после коммита a0a3c57 другой фазой), оставлены незакоммиченными намеренно. Файлов, принадлежащих VL-98, вне коммитов не осталось.
---
<!-- COMMENTS:END -->