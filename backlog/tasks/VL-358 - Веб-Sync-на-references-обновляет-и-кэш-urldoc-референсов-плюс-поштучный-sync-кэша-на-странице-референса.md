---
id: VL-358
title: 'Веб: Sync на #/references обновляет и кэш url/doc-референсов, плюс поштучный sync на странице референса'
status: Spec
assignee: []
reporter: ''
created_date: '2026-11-07 16:35'
updated_date: '2026-11-07 16:40'
due_date: ''
labels:
  - web
  - references
dependencies: []
milestone: ''
references: []
priority: medium
type: feature
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
lessons: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Контекст: кнопка Sync на странице `#/references` вызывает `POST /api/references/sync` → `syncReferenceRepos(cwd)`, которая только клонирует отсутствующие каталоги для `type: repo`. Markdown-кэш url/doc-референсов (`refreshReferenceCache`/`syncReferenceCaches`, VL-194/VL-291) через веб недоступен вовсе — пользователь жмёт Sync, получает «клонировано: 0, пропущено: N, ошибок: 0» и решает, что кнопка сломана (в VL-194 явно записано «web-UI не расширен — вне объёма плана»). Обновить кэш сейчас можно только из CLI: `vibelog reference sync ref-N` / `--all`.

Цель: из веба можно синхронизировать и кэш, причём как всё сразу, так и один референс со страницы `#/reference/<id>`.

Что сделать:
1. API: `POST /api/references/sync` — расширить до общего sync (клоны репозиториев + кэши url/doc), тела запроса может не быть; ответ объединяет `{cloned, skipped, failed, cache: {updated, skipped, failed}}` (или отдельное поле `cached`), обратная совместимость формы `SyncResult` для существующего фронта сохраняется additive-полями.
2. API: `POST /api/references/:id/sync` — поштучный sync одного референса (repo → клон, url/doc → refresh кэша), ответ `{reference, cloned?, cache?}` с понятной ошибкой 404 для неизвестного id. Роут держать после точного `/api/references/sync`, порядок матчинга проверить тестом (инцидент transient-404 из VL-174, lesson-22).
3. Фронт `#/references`: кнопка Sync показывает оба итога (клоны + кэш) отдельными строками, а не общий «ошибок: 0»; при `cache.failed` — destructive-акцент с текстом ошибки по ref-id.
4. Фронт `#/reference/<id>`: кнопка «Синхронизировать» (иконка RefreshCw, состояние «Синхронизация…») — для url/doc обновляет кэш, для repo клонирует; после успеха перечитать детали (`cached_at`/`source_hash` в UI, если они отдаются) и показать итог inline, ошибки — inline, без console.
5. Сообщение о 429: ответ сервера отдаёт причину (сейчас `HTTP 429 Too Many Requests` от QRATOR GitVerse при анонимном raw-доступе); в UI показать человекочитаемую подсказку «лимит запросов GitVerse, повторите позже» и не терять остальные результаты.

Вне объёма: ретраи/backoff в `downloadText` (отдельная задача), поддержка токена для raw-доступа, изменение CLI-поведения sync.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 POST /api/references/sync обновляет и клоны репозиториев, и markdown-кэши url/doc-референсов; ответ additive-совместим с прежним SyncResult и содержит итог по кэшу
- [ ] #2 POST /api/references/:id/sync синхронизирует один референс (repo — клон, url/doc — кэш) и возвращает 404 с понятным сообщением для неизвестного id; роут не перехватывается :id-роутом
- [ ] #3 Кнопка Sync на #/references показывает итог клонов и кэша отдельными строками, ошибки кэша — с ref-id и текстом
- [ ] #4 На странице #/reference/<id> есть кнопка синхронизации этого референса: состояния «Синхронизация…/итог/ошибка» inline, после успеха данные перечитываются, ошибок в консоли браузера нет
- [ ] #5 Ошибка HTTP 429 от GitVerse показывается человекочитаемо («лимит запросов, повторите позже»), остальные результаты синхронизации при этом не теряются
- [ ] #6 Тесты: src/web/references-api.test.mjs дополнен кейсами общего и поштучного sync (успех, 404, частичная ошибка кэша); pnpm typecheck и pnpm test зелёные, web/dist пересобран
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->