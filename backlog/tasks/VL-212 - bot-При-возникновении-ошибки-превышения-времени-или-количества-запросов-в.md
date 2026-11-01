---
id: VL-212
title: Кнопка «Продолжить» для возобновления сессии после ошибки лимитов
status: Done
assignee: []
reporter: ''
created_date: '2026-10-29 13:15'
updated_date: '2026-11-02 00:23'
due_date: ''
labels:
  - bot
dependencies: []
milestone: v1.11
references: []
priority: medium
type: enhancement
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/bot/formatting.ts
  - src/bot/handlers.ts
  - src/bot/formatting.test.mjs
  - backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md
  - CHANGELOG.md
lessons:
  - lesson-82
  - lesson-83
token_usage:
  input: 3737879
  output: 101885
  cache: 3525760
  total: 3839764
  requests: 65
  duration_ms: 3874901
  reasoning: 88917
  by_phase:
    spec:
      input: 73410
      output: 2730
      cache: 64256
      requests: 3
    plan:
      input: 2509288
      output: 88979
      cache: 2376064
      requests: 33
    code:
      input: 1155181
      output: 10176
      cache: 1085440
      requests: 29
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
При возникновении ошибки превышения времени или количества запросов в уведомлении о возникновении ошибки нужно прикрепить кнопку Продолжить, при нажатии которой будет возобновлена эта сессия (resume)
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Кнопка «Продолжить» присутствует в уведомлении бота об ошибке превышения --max-wall-time или --max-requests
- [x] #2 По нажатию кнопки вызывается startResume той же сессии (session-ref из PhaseRun.result.session_id + run.agent) и сессия возобновляется
- [x] #3 Кнопка добавляется ТОЛЬКО при is_error=true и тексте «Превышен лимит» — для успешных фаз и не-limit ошибок кнопки нет
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [x] #1 Тесты проходят
- [x] #2 Документация обновлена
- [x] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
# Implementation Plan — VL-212: кнопка «Продолжить» при ошибке лимитов

## Суть

Уведомление об ошибке фазы шлёт `sendPhaseResult` (src/bot/handlers.ts, строки 266–296): rich-рендер `renderPhaseResultRich` + MarkdownV2-фолбэк `formatPhaseResult`. Ошибка лимита приходит как `PhaseRun.result` c `is_error: true` и текстом вида `Превышен лимит --max-wall-time (…)` / `Превышен лимит --max-requests (…)` (источник: src/agent/loop.ts строки 280/286/427; контракт JSON — cli.ts, `session_id` и `agent` есть всегда). Требуется: если это limit-ошибка и известна сессия — прикрепить кнопку «Продолжить», по нажатию → `startResume` той же сессии (паттерн reply-resume VL-93 / /resume VL-171).

Limit-флаги передаются только агенту vb (orchestrator.ts:803), но детект текстовый — для qwen кнопка не помешает (безопасно: сессия есть → resume валиден).

## Файлы для изменения

### 1. src/bot/formatting.ts — чистая функция детекта (после formatPhaseResult, строка 237)

Новая экспортная функция (~15 строк):

```ts
/**
 * session-ref для кнопки «Продолжить» при ошибке лимита (VL-212).
 * Возвращает '<agent>:<session_id>' ТОЛЬКО если is_error=true, текст
 * результата содержит «Превышен лимит» и session_id известен; иначе null.
 */
export function limitErrorResumeRef(run: PhaseRun): string | null
```

Логика: `run.result` отсутствует → null; `!run.result.is_error` → null; `!/Превышен лимит/.test(run.result.result)` → null; нет `session_id` → null; иначе `` `${run.agent ?? 'qwen'}:${run.result.session_id}` `` (дефолт агента — паттерн VL-93, как в formatPhaseResult строка 235 / renderPhaseResultRich строка 674).

Почему `/Превышен лимит/` без привязки к конкретному флагу: покрывает `--max-wall-time`, `--max-requests` и `--max-tool-calls` (loop.ts:280/286/427) — все они «ошибки лимитов» по AC3.

### 2. src/bot/handlers.ts — отправка кнопки (sendPhaseResult, строки 266–296)

**Rich-путь (строки 274–281):** кнопка добавляется к **последней** части после суффикса «часть i/N», чтобы tg-button был в конце сообщения:

```ts
const resumeRef = limitErrorResumeRef(run);
const tgButton = resumeRef
  ? `\n\n<tg-button type="callback_data" style="primary" data="resume:${resumeRef}">▶ Продолжить</tg-button>`
  : '';
// в цикле: markdown: richParts[i] + suffix + (i === richParts.length - 1 ? tgButton : '')
```

Формат tg-button и префикс callback-данных — паттерн rich.ts:347–383 (lesson-43: старые ветки callback не трогаем, `resume:` — новый префикс). Лимит callback_data 64 байт соблюдён: `resume:qwen:<36-UUID>` = 49 б., `resume:vb:agent-<ts>` = 26 б.

**MarkdownV2-фолбэк (строки 283–295):** расширить `sendText` (строка 107) необязательным 4-м параметром `replyMarkup`, пробрасывать в `sendMessage({ parse_mode, reply_markup })` (обе ветки: MarkdownV2 и plain). В sendPhaseResult последней части фолбэка передавать:

```ts
replyMarkup: resumeRef
  ? { inline_keyboard: [[{ text: '▶ Продолжить', callback_data: `resume:${resumeRef}` }]] }
  : undefined
```

Inline keyboard — базовый Bot API (не rich-расширение), прокси его пропускает; при провале отправки с markup действует существующий try/catch-фолбэк (поведение не ухудшается — кнопка просто не появится).

### 3. src/bot/handlers.ts — callback-ветка `resume:` (в `bot.on('callback_query')`, строка 1353)

Вставить новую ветку **после ветки `doc:` (заканчивается ~строка 1416 `sendDocView`) и ДО фильтра на строке 1424** — как comment:/task:/doc: ветки регистрируются до фильтра и возвращаются сами; строка 1424 не меняется (lesson-43 — формат старых кнопок не трогаем):

```ts
// ── Кнопка «Продолжить» после ошибки лимита (VL-212): data = resume:<session-ref> ──
if (data.startsWith('resume:')) {
  if (!requireBind(ctx)) { await ctx.answerCallbackQuery({...}).catch(()=>{}); return; }
  const parsed = parseResumeCommand(data.slice('resume:'.length)); // ← уже импортирован (строка 71)
  if ('error' in parsed) { await ctx.answerCallbackQuery({ text: parsed.error }).catch(()=>{}); return; }
  await ctx.answerCallbackQuery({ text: '🔄 Возобновляю сессию…' }).catch(()=>{}); // иначе «часики»
  const chatId = ctx.chat?.id;
  const onExit: PhaseExitCallback = (run) => {
    if (chatId === undefined) return;
    void sendPhaseResult(bot, chatId, run); // паттерн reply-resume (строки 1690–1694), без карточки
  };
  const result = startResume(deps.cwd, parsed.sessionId, parsed.comment, onExit, parsed.agent);
  if ('error' in result) { await sendMd(ctx, '⚠️ ' + escapeMarkdownV2(result.error)); return; }
  await sendMd(ctx, `🔄 Сессия возобновлена (resume ${escapeMarkdownV2(parsed.sessionId)}), PID ${result.pid}`);
}
```

`parseResumeCommand` на строке-данных `vb:agent-XXX` / `qwen:<uuid>` возвращает `{sessionId, agent, comment: 'Продолжи'}` — ноль нового парсинга (commands.ts:596–634). `startResume` уже импортирован (строка 55); `startResume` сам подхватит worktree/taskKey из меты сессии (VL-110/145), guard «Запуск уже выполняется» отdbl-нажатия штатен.

Промпт resume = `'Продолжи'` (дефолт parseResumeCommand): сообщение об ошибке лимита уже дописано в JSONL сессии (контракт resume VL-103, loop.ts:332) — модель на resume видит «фаза прервана» и продолжает работу. Свежие лимиты (`--max-wall-time`/`--max-requests`) у resume-рана считаются заново (счётчики per-run) — повторное нажатие даёт полноценный бюджет.

### 4. Тесты — src/bot/formatting.test.mjs (после describe 'formatPhaseResult', ~строка 265)

Новый `describe('limitErrorResumeRef (VL-212)')`:
1. limit-ошибка (`is_error: true`, result `Превышен лимит --max-requests (5)…`, session_id `agent-1`, agent `vb`) → `'vb:agent-1'`;
2. успешная фаза (is_error false, тот же текст) → `null`;
3. не-limit ошибка (is_error, текст «Ошибка LLM API») → `null`;
4. limit-ошибка без session_id → `null`;
5. `result` отсутствует (logTail-фолбэк) → `null`;
6. limit-ошибка без `run.agent` → `'qwen:<session_id>'` (дефолт VL-93).

Callback-парсинг данных `resume:` покрывается существующими тестами parseResumeCommand (commands.test.mjs, VL-171) — новый парсинг не нужен.

rich.ts / rich.test.mjs **не меняются** (кнопка добавляется на слое отправки, не в рендере).

### 5. Документация

- **backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md** (править через MCP `document_update`, раздел «Resume сессии по reply», ~строка 490): абзац — при ошибке лимита в информационном сообщении появляется кнопка «▶ Продолжить» (callback `resume:<session-ref>`), по нажатию — возобновление той же сессии (эквивалент /resume без комментария).
- **CHANGELOG.md** (корень, не backlog/): пункт «VL-212: кнопка “Продолжить” в уведомлении об ошибке лимитов → resume сессии».

## Порядок действий

1. `limitErrorResumeRef` в formatting.ts + тесты в formatting.test.mjs.
2. handlers.ts: `sendText` с `replyMarkup` + кнопка в обеих ветках sendPhaseResult.
3. handlers.ts: ветка `resume:` в callback_query (до фильтра строки 1424).
4. `pnpm build` → `pnpm test`.
5. Документация: document_update (doc-6) + CHANGELOG.md.

## Проверка

```bash
pnpm build && pnpm test          # build + vitest (formatting.test.mjs, rich.test.mjs, commands.test.mjs)
pnpm test:fast                   # быстрая итерация после первой сборки
```

Ручная smoke (bot): `/set max-requests 1` → запустить фазу → в уведомлении «Фаза …: ошибка (Превышен лимит --max-requests …)» есть кнопка «▶ Продолжить» → нажать → «🔄 Сессия возобновлена … PID» → финальное сообщение resume-рана. Успешная фаза — кнопки нет.

## Риски

- **callback_data 64 байт** — оба формата ref укладываются (49/26 б.); если формат сессии изменится — сломается только кнопка, парсер устойчив.
- **chunkRich multi-part**: кнопка только к последней части (иначе Telegram отклонит сообщение с текстом после tg-button); на практике limit-ошибка короткая и не чанкуется.
- **Фолбэк MarkdownV2**: если прокси не пропустит inline keyboard — кнопка останется только в rich-пути (основной); поведение фолбэка не деградирует (try/catch).
- **Двойное нажатие / фаза уже бежит** — `startResume` вернёт `{error}` → штатное «⚠️ Запуск уже выполняется».
- **Сессия удалена из .vibelog/agent-sessions/** — spawn упадёт, придёт обычная ошибка-уведомление (как у reply-resume, без пре-чека — паттерн единый).
- **auto-runner (VL-200)** имеет собственную retry-машину с --resume — не трогаем, вне AC.
- Scope = бот (label `bot`); веб-уведомления не затрагиваются.
<!-- SECTION:PLAN:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-29 13:16
---
Фаза 1 (Spec) выполнена. Заголовок: изменён на «Кнопка «Продолжить» для возобновления сессии после ошибки лимитов». Тип: enhancement. Масштаб: task. Приоритет: Medium. Уточнено: снят ведущий тег #bot из заголовка и описания (перенесён в labels); предложены 3 проверяемых AC: (1) кнопка «Продолжить» присутствует в уведомлении об ошибке превышения времени/количества запросов, (2) по нажатию сессия возобновляется (resume) и продолжает выполнение, (3) кнопка добавляется только для ошибок лимитов. Labels: bot. References: нет. Вопросов нет.
---
author: @agent
created: 2026-10-29 13:55
---
Фаза 2 (Plan) выполнена. Тип: enhancement. План записан: 5 файлов (src/bot/formatting.ts — чистая limitErrorResumeRef; src/bot/handlers.ts — кнопка в sendPhaseResult (rich tg-button + inline-keyboard в MarkdownV2-фолбэке) и callback-ветка resume: до фильтра строки 1424 через parseResumeCommand→startResume; src/bot/formatting.test.mjs — 6 тестов; doc-6 через MCP document_update; CHANGELOG.md). AC: 3 добавлены (checklist был пуст после Spec). Ключевые решения: детект limit-ошибки текстом «Превышен лимит» (покрывает wall-time/requests/tool-calls); переиспользование parseResumeCommand (ноль нового парсинга session-ref); кнопка только к последней rich-части; resume-рану лимиты считаются заново (per-run). Риски: 64-байтный лимит callback_data (укладывается: 49/26 б), провал inline-keyboard в прокси (rich-путь остаётся), guard двойного нажатия штатен. Учтены lessons: 43 (старые callback-форматы не трогаем — новая ветка до фильтра), 37 (парсинг не дублируем), 8/9 (BOT_COMMANDS не менялся — registry.test не требует правок). References: нет.
---
author: @agent
created: 2026-10-29 23:37
---
Фаза 3 (Code) выполнена по плану. Изменено: src/bot/formatting.ts (новая чистая функция limitErrorResumeRef — детект is_error + «Превышен лимит» + session_id → '<agent>:<session_id>', дефолт агента qwen как в formatPhaseResult), src/bot/handlers.ts (sendText получил необязательный replyMarkup и прокидывает его в обе ветки MarkdownV2/plain; sendPhaseResult: rich-путь добавляет <tg-button ... data="resume:<ref>">▶ Продолжить</tg-button> только к последней части, MarkdownV2-фолбэк передаёт inline_keyboard к последней части; новая callback-ветка resume: зарегистрирована после doc: и ДО фильтра чужих callback — requireBind → parseResumeCommand (переиспользован, ноль нового парсинга) → startResume с onExit=sendPhaseResult, при {error} штатное «⚠️ Запуск уже выполняется»), src/bot/formatting.test.mjs (6 тестов describe 'limitErrorResumeRef (VL-212)'). Коммит cd43504.
Проверки: pnpm build — ok; node vitest run src/bot/formatting.test.mjs src/bot/rich.test.mjs src/bot/commands.test.mjs — 218 passed; прогон src/bot + src/web — 565/566 (единственное падение orchestrator «close без branch-mode» при повторном одиночном запуске файла — 76/76 passed, т.е. флак таймингов, не регрессия); полный pnpm test:fast — 1504 passed, падения только в несвязанных src/cli/{config,search,decision,create-flags}.test.mjs и src/core/reference.test.mjs (флаки окружения: поодиночно те же файлы проходят; изменены только src/bot/*).
Что осталось: документация (doc-6 раздел «Resume сессии по reply» + CHANGELOG.md) — по правилам Фазы 3 не обновлялась, пишется в фазе Close; ручной smoke бота (/set max-requests 1 → кнопка в уведомлении → resume) не выполнялся — требует запущенного бота и токена.
Отмечено: AC 1–3, DoD 1 (целевые тесты) и DoD 3 (регрессий в затронутых модулях нет); DoD 2 оставлен открытым — документация за фазой Close.
---
author: @agent
created: 2026-10-29 23:56
---
Фаза Close прервана: слияние vb/vl-212 → master невозможно с самого начала — в главном репозитории УЖЕ идёт ЧУЖОЙ незавершённый merge (VL-219, MERGE_HEAD 532c590 «feat: VL-219 — ассистент веб-чата…»), оставленный другим процессом, с незарезолвленным конфликтом. `git merge --no-ff vb/vl-212` вернул «error: Merging is not possible because you have unmerged files» (git status --porcelain на момент попытки: UU CHANGELOG.md + staged src/agent/tools.ts, src/mcp/tools.ts, src/mcp/v11.test.mjs, src/web/chat.ts, src/web/chat.test.mjs, src/web/tool-policy.*, templates/prompts/chat-system.md, web/dist/, web/src/components/chat/thread.tsx и др. — это изменения VL-219, НЕ моей задачи). Ожидание ~10 минут (несколько раундов по 30–90 с) не помогло: MERGE_HEAD и конфликт CHANGELOG.md сохраняются без изменений.
Я НЕ резолвил и НЕ прерывал этот конфликт: инструкция Фазы Close прямо запрещает резолв/abort конфликтных файлов, к тому же это чужие изменения другого merge, а abort отбросил бы staged-работу VL-219.
Состояние моей задачи безопасно: ветка vb/vl-212 = cd43504 «feat: VL-212 — кнопка «Продолжить» в уведомлении об ошибке лимитов» (3 файла: src/bot/formatting.ts, src/bot/handlers.ts, src/bot/formatting.test.mjs), worktree .vibelog/worktrees/vl-212 чистый (только untracked node_modules и backlog/references/data — симлинки оркестратора), сливать нечего-лишнего и ничего не потеряно.
Что нужно сделать вручную: разрешить конфликт merge VL-219 в CHANGELOG.md (это уже работа закрывателя VL-219) и дождаться коммита/отмены того merge — затем повторить Фазу Close для VL-212. Статус (Review), DoD и документацию задачи я не менял; DoD 2 «Документация обновлена» по-прежнему открыт — doc-6 + CHANGELOG.md пишутся в шаге 8 при успешном merge.
---
author: @agent
created: 2026-10-30 00:31
---
Фаза Close выполнена (после того как чужой merge VL-219 завершился — первая попытка была прервана именно им, отчёт ниже в комментариях).
**Merge**: ветка vb/vl-212 (1 коммит cd43504 «feat: VL-212 — кнопка «Продолжить» в уведомлении об ошибке лимитов», 3 файла: src/bot/formatting.ts, src/bot/handlers.ts, src/bot/formatting.test.mjs) слита в master через `git merge --no-ff` → merge-коммит 19380e8, без конфликтов (git применил «recursive» стратегию, CHANGELOG.md не конфликтовал, т.к. VL-219 свою запись уже закоммитил).
**Проверки на master после merge**: `pnpm build` — ok. `pnpm test` — 1539 passed, 24 failed, все падения в src/agent/llm.test.mjs (describe «Санация отравленных пар tool_calls/tool (VL-216)», TypeError на body.messages). Это НЕ регрессия VL-212: merge затронул только src/bot/* (`git diff HEAD^1 HEAD --stat -- src/agent/` пуст), файлы src/agent/llm.ts и src/agent/llm.test.mjs байт-в-байт идентичны pre-merge master (`diff` против `git show HEAD^1:` — совпадение), и тот же файл падает теми же 24 тестами в одиночном прогоне — т.е. master был красным в этой точке до моего слияния (наследие VL-216/VL-230). Целевые тесты задачи: `npx vitest run src/bot/formatting.test.mjs src/bot/rich.test.mjs src/bot/commands.test.mjs` — 218 passed (включая 6 новых тестов limitErrorResumeRef).
**Worktree и ветка**: `.vibelog/worktrees/vl-212` удалена (`--force`: внутри были только untracked-симлинки node_modules и backlog/references/data от оркестратора), `vb/vl-212` удалена (`git branch -d`, was cd43504).
**Документация (DoD 2 теперь выполнен)**: doc-6, раздел «Resume сессии по reply» — новый абзац «Кнопка «Продолжить» при ошибке лимитов (VL-212)»: детект `is_error` + «Превышен лимит», кнопка в rich-рендере (`<tg-button>` последней строкой, data `resume:<agent>:<session_id>`) и в MarkdownV2-фолбэке (inline-клавиатура), поведение по нажатию (resume той же сессии, промпт «Продолжи», лимиты нового рана считаются заново), условия отсутствия кнопки и guard на повторное нажатие. CHANGELOG.md — запись в Unreleased/«Добавлено». Коммит документации: ca83ac1 «docs: VL-212 — документация и CHANGELOG».
**Lessons**: lesson-82 (чужой незавершённый merge в главном репо — не резолвить/не abort, отчитаться и ждать) и lesson-83 (падение тестов после merge проверять на «файл не менялся» через diff HEAD^1 до вердикта «регрессия»), обе связаны с VL-212, закоммичены в главном репо (файлы + task.lessons).
**Что честно осталось**: ручной smoke бота (/set max-requests 1 → запуск фазы → кнопка «▶ Продолжить» → «🔄 Сессия возобновлена … PID») не выполнялся — требует запущенного бота с токеном; логика покрыта юнит-тестами (детект кнопки в formatting.test.mjs, callback-парсинг resume: — существующими тестами parseResumeCommand VL-171).
DoD: 1 «Тесты проходят» — целевые тесты задачи зелёные, полный прогон красный по пре-существующей причине вне scope; 2 «Документация обновлена» — выполнено в этой фазе; 3 «Нет регрессий» — регрессий от merge нет (доказано выше).
---
<!-- COMMENTS:END -->