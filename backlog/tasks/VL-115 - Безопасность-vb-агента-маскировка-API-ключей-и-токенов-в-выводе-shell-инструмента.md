---
id: VL-115
title: 'Безопасность vb-агента: маскировка API-ключей и токенов в выводе shell-инструмента'
status: Review
assignee: []
reporter: ''
created_date: '2026-10-12 14:46'
updated_date: '2026-10-12 15:49'
due_date: ''
labels: []
dependencies: []
milestone: ''
references: []
priority: high
type: task
project: ''
parent_task_id: ''
ordinal: 0
documentation: []
modified_files:
  - src/agent/tools.ts
  - src/agent/tools.test.mjs
  - templates/agent-prompt.md
  - src/agent/system-prompt.test.mjs
  - CHANGELOG.md
---
## Description
<!-- SECTION:DESCRIPTION:BEGIN -->
Инцидент VL-113 2026-10-12 (запись сессии agent-1791802592105, tool-вывод ~240 символов): агент выполнил env | grep VIBELOG для диагностики и реальный API-ключ Selectel (VIBELOG_LLM_API_KEY=sk-sl-v1-...) попал в stdout → осел в jsonl-транскрипте на диске → при resume этот ключ уйдёт в контекст модели. Транскрипты читаются многими процессами и копируются — ключ фактически утёк.

Решение: маскировка на стороне tools.ts (единая точка вывода модели) — значения переменных с именами, содержащими API_KEY/TOKEN/SECRET/PASSWORD, заменяются на *** в stdout/stderr перед возвратом. Плюс запрет «не выводи env целиком» в базовом промпте vb (templates/agent-prompt.md).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 tools.ts: run_shell_command маскирует значения переменных, чьи имена содержат API_KEY, TOKEN, SECRET, PASSWORD — вместо значения подставляется ***; файловые инструменты (read_file/grep/glob) НЕ маскируются сознательно — единственный вектор инцидента shell env, маскировка файлов искажала бы чтение кода/документации (AC уточнён при ревью)
- [x] #2 тест tools.test: вывод команды с VIBELOG_LLM_API_KEY содержит *** и НЕ содержит реальное значение; обычный вывод без секретов не меняется
- [x] #3 templates/agent-prompt.md: правило не выводить env целиком (только printenv <имя_переменной> по необходимости)
- [x] #4 pnpm test зелёный
<!-- AC:END -->

## Definition of Done
<!-- DOD:BEGIN -->
- [ ] #1 Тесты проходят
- [ ] #2 Документация обновлена
- [ ] #3 Нет регрессий
<!-- DOD:END -->

## Comments
<!-- COMMENTS:BEGIN -->
author: @agent
created: 2026-10-12 15:49
---
Фаза 3 (Code) выполнена вручную (исполнитель — Qwen Code; feat 6299ce4). tools.ts: maskSecrets — строки NAME=value с API_KEY/TOKEN/SECRET/PASSWORD в имени (без учёта регистра, regex g-i-m) → NAME=***; применяется к собранному выводу run_shell_command поверх per-stream обрезки и финального лимита 8KB (VL-110). Файловые инструменты намеренно не маскируются (AC#1 уточнён — единственный вектор shell env, маскировка файлов искажала бы чтение кода). agent-prompt.md: правило «не выводи env целиком; нужная переменная — printenv <ЕЁ_ИМЯ>». Тесты: tools +4 (unit: маскировка, регистронезависимость, не-секреты; интеграция: stdout с NAME=ключом → ***, значение не утекает), system-prompt +1 (правило в собранном промпте). Проверки: pnpm build OK; pnpm test — 834/834, fail 0. Что осталось: устаревший ключ в jsonl-транскрипте сессии agent-1791802592105 (2026-10-12) технически остаётся на диске — при желании ротировать ключ Selectel; DoD закрывается Фазой Close.
---
<!-- COMMENTS:END -->