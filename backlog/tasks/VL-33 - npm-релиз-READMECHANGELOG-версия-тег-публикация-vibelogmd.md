---
id: VL-33
title: 'npm: релиз — README/CHANGELOG, версия + тег, публикация vibelog.md'
status: Done
assignee: []
reporter: ''
created_date: '2026-10-01 15:02'
updated_date: '2026-10-02 16:54'
due_date: ''
labels: []
dependencies:
  - VL-32
milestone: ''
references: []
priority: high
type: ''
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files: []
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Финальный шаг эпики — релиз. После VL-31 (корректный пакет) и VL-32 (smoke-тест из tarball):
1. README: обновить раздел установки — публичный npm-пакет vibelog.md, команда npm install -g vibelog.md / npx; Node.js 20+; убрать/переписать формулировки про pnpm build как обязательный шаг для пользователей (в пакете уже собраны dist/ и web/dist). CHANGELOG: запись в [Unreleased] или новой версии.
2. Согласовать версию с Pavel: 1.5.0 (текущая, первая публикация) или 2.0.0 (npm = новый этап). Обновить package.json + CHANGELOG, создать git-тег.
3. Публикация: npm login (аккаунт Pavel), npm publish (пакет unscoped → публичный по умолчанию). Проверки после: npm view vibelog.md, npm install -g vibelog.md на машине Pavel, vibelog --help.
4. Пуш тега на origin.

ВАЖНО: публикация — видимое внешнее действие (registry.npmjs.org), только с явного подтверждения Pavel; аккаунт npm — его. Задача фиксирует порядок и проверки, публикацию выполняет Pavel (или я по его прямой команде с его auth).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 README: раздел «Установка» обновлён — npm install -g vibelog.md (или npx vibelog.md), требование Node.js 20+, примечание про web/dist в комплекте; CHANGELOG: запись о первой npm-публикации
- [x] #2 Версия согласована (1.5.0 или 2.0.0 — решить при Фазе 2) и в package.json, и в CHANGELOG; git-тег vX.Y.Z создан
- [x] #3 Публикация выполнена (npm publish), npm view vibelog.md возвращает версию; установка через npm install -g vibelog.md на машине Pavel работает (vibelog --help)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Implementation Plan
<!-- SECTION:PLAN:BEGIN -->
## Факты

- **Версия согласована: 1.5.0** (Pavel, 2026-10-01); 2.0.0 — после 1.25.0. package.json уже 1.5.0 — bump не нужен.
- **Тега v1.5.0 НЕ существует** (git tag: v1.0.0..v1.4.0) — создаём новый.
- **CHANGELOG**: есть и [1.5.0] (TS-миграция), и [Unreleased] с записями VL-26..32 (веб + npm-упаковка). 1.5.0 ещё не публиковался/не тегировался → записи Unreleased переносятся в [1.5.0].
- **npm авторизация уже есть**: `npm whoami` → bobarev. Публикация возможна без npm login.
- Имя vibelog.md свободно (проверено в Spec VL-31); пакет unscoped → публичный по умолчанию.
- README «Установка» (строки 14-22): сейчас pnpm install/build/link --global — переписать под npm-пользователя.

## Изменяемые файлы

### 1. README.md (строки 14-22)
Заменить раздел «Установка»:
```bash
npm install -g vibelog.md
```
- Требование: Node.js 20+.
- Примечание: в пакете уже собраны dist/ и web/dist — pnpm/build НЕ нужен; команда после установки — `vibelog`.
- npx-вариант: `npx vibelog.md` (одноразовый запуск).
- Отдельным подразделом «Из исходников (для контрибьюторов)» оставить текущий pnpm install/build/link --global + про pnpm build после правок src.

### 2. CHANGELOG.md
- Перенести содержимое [Unreleased] в секцию [1.5.0] (сегодняшние записи VL-26..32).
- В [1.5.0] добавить строку: «Первая публикация в npm: пакет `vibelog.md` (Unlicense, zero runtime dependencies)».
- Убрать опустевшую секцию [Unreleased] (или оставить пустой заголовок — по конвенции Keep a Changelog пустой [Unreleased] допустим; предлагаю оставить заголовок без записей).

### 3. Тег
- package.json: версия 1.5.0 — проверить, не менять.
- После коммита docs: `git tag v1.5.0` (annotated: `-m "v1.5.0 — первая публикация в npm"`).

### 4. Публикация (внешнее действие — по отдельному «да» на каждом шаге)
- Перед publish: `node scripts/npm-smoke.mjs` → 16/16 PASS (правило из AGENTS.md).
- `npm publish` (авторизация bobarev уже есть).
- После: `npm view vibelog.md version` → 1.5.0; `npm install -g vibelog.md` в чистом каталоге → `vibelog --help`.

## Порядок действий
1. README + CHANGELOG.
2. `pnpm test` (регрессии).
3. Коммит docs: `docs: README/CHANGELOG к первой публикации npm (v1.5.0)`.
4. ЖДУ «да» → smoke: `node scripts/npm-smoke.mjs`.
5. ЖДУ «да» → тег v1.5.0 + пуш коммита и тега на origin.
6. ЖДУ «да» → `npm publish` (внешний необратимый шаг).
7. Пост-проверки: npm view, npm i -g на машине Pavel.
8. AC #1-3 → Done → финальный docs(task)-коммит.

## Верификация
- `pnpm test` — 318+/318+.
- `node scripts/npm-smoke.mjs` — 16/16 PASS (перед publish).
- `git tag -l v1.5.0` — тег создан; `git ls-remote --tags origin` после пуша — тег на remote.
- После publish: `npm view vibelog.md` → name/version/license (Unlicense), `npm view vibelog.md dist.tarball`.

## Риски
1. **npm publish необратим** (в первые 72ч допустим unpublish по правилам npm, но это крайность) — перед publish обязателен smoke; каждый внешний шаг (пуш, publish) — по отдельному явному «да» Pavel.
2. **Что-то сломано у пользователей после публикации** — mitigation: smoke-тест VL-32 реально устанавливает и гоняет пакет; пост-проверка npm i -g на машине Pavel.
3. **README-инструкция npm install -g** может конфликтовать с текущей pnpm-установкой Pavel (симлинк pnpm shim) — пост-проверка покажет; конфликт не страшен (последняя установка перекрывает PATH-запись).
4. **Секция [Unreleased] переносится в [1.5.0]** — если позже понадобится гибкость (напр., hotfix 1.5.1 до веб-фич) — фичи уже в 1.5.0, это осознанный выбор: весь сегодняшний объём = первый релиз.
<!-- SECTION:PLAN:END -->

## Final Summary
<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Эпик npm-публикации завершён 2026-10-02: **vibelog.md@1.5.0 опубликован в registry.npmjs.org**.

- README: установка через npm install -g vibelog.md (Node 20+, npx-вариант); pnpm — для контрибьюторов.
- CHANGELOG: записи Unreleased (VL-26..32) перенесены в [1.5.0] + запись о первой публикации.
- Тег v1.5.0 (annotated) создан и запушен на origin.
- npm publish выполнен Pavel интерактивно (аккаунт bobarev, 2FA — ассистент publish не выполняет).
- Пост-проверки: npm view vibelog.md → 1.5.0/Unlicense; npm install -g → симлинк в nvm-бин, копия 1.5.0, vibelog --help работает.
- Smoke 16/16 PASS перед публикацией; pnpm test 318/318.

Итого эпик: VL-31 (упаковка), VL-32 (smoke), VL-33 (релиз) — Done.
<!-- SECTION:FINAL_SUMMARY:END -->