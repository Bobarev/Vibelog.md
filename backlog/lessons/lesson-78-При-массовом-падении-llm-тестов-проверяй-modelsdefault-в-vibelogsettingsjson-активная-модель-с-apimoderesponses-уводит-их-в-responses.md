---
id: lesson-78
title: При массовом падении llm-тестов проверяй models.default в .vibelog/settings.json — активная модель с api_mode=responses уводит их в /responses
status: active
tags:
  - tests
  - llm
  - settings
  - api_mode
  - vl-209
source_tasks:
  - VL-218
linked_tasks:
  - VL-218
  - VL-223
  - VL-221
  - VL-228
  - VL-227
created_date: 2026-10-29
updated_date: 2026-10-30
supersedes: lesson-86
---
### Проблема

`createLlmClient` резолвит активную модель из `.vibelog/settings.json` (`models.default` → `resolveActiveModel`, VL-209): при активной модели с `api_mode: responses` полный `pnpm test` падает 24 тестами `llm.test.mjs` — фейковый fetch получает URL `/responses`, а тесты ожидают `/chat/completions`, текст собирается пустым. Инцидент VL-218: конфиг с routerai-моделью добавлен в 17:46 (после зелёного прогона VL-217 в 17:04), код с тех пор не менялся — ложная «регрессия» в docs-фазе.

### Решение

Перед вердиктом «регрессия» при массовом падении llm-тестов проверяй `models.default` в `.vibelog/settings.json`: активная модель с `api_mode: responses` объясняет падения локальной конфигурацией, а не кодом. Для изоляции убирай `models.default` временно в ОДНОЙ shell-команде с гарантированным восстановлением (бэкап → правка → `pnpm test` → `cp` обратно), чтобы конфиг вернулся даже при падении тестов; бот и фазы читают этот файл вживую — окно изоляции держи минимальным. Настоящий фикс (тесты передают явный `apiMode: 'chat'` в CLIENT_OPTS) — отдельной задачей, не в docs-фазе.

### Пример

```bash
cp .vibelog/settings.json .vibelog/settings.json.bak && node -e "const fs=require('fs');const p='.vibelog/settings.json';const s=JSON.parse(fs.readFileSync(p,'utf8'));if(s.models)delete s.models.default;fs.writeFileSync(p,JSON.stringify(s,null,2))" && pnpm test; s=$?; cp .vibelog/settings.json.bak .vibelog/settings.json && rm .vibelog/settings.json.bak; exit $s
```