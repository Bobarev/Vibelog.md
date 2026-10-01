---
id: VL-33
title: 'npm: релиз — README/CHANGELOG, версия + тег, публикация vibelog.md'
status: To Do
assignee: []
reporter: ''
created_date: '2026-10-01 15:02'
updated_date: '2026-10-01 15:02'
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
- [ ] #1 README: раздел «Установка» обновлён — npm install -g vibelog.md (или npx vibelog.md), требование Node.js 20+, примечание про web/dist в комплекте; CHANGELOG: запись о первой npm-публикации
- [ ] #2 Версия согласована (1.5.0 или 2.0.0 — решить при Фазе 2) и в package.json, и в CHANGELOG; git-тег vX.Y.Z создан
- [ ] #3 Публикация выполнена (npm publish), npm view vibelog.md возвращает версию; установка через npm install -g vibelog.md на машине Pavel работает (vibelog --help)
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->