---
id: lesson-133
title: 'Удалённый id встроенной роли из BUILTIN_PERSONAS блокируй через RETIRED_PERSONA_IDS, иначе секция chat_personas молча воскресит роль'
status: active
tags:
  - personas
  - config
  - settings.json
  - web
source_tasks:
  - VL-273
linked_tasks:
  - VL-273
created_date: 2026-11-01
updated_date: 2026-11-01
supersedes: ''
---
## Проблема

`loadPersonas` сливает `BUILTIN_PERSONAS` с секцией `chat_personas` из `.vibelog/settings.json`. Если удалить встроенную роль из `BUILTIN_PERSONAS`, но оставить merge-логику как есть, запись с тем же id в settings.json **молча воскресит** удалённую роль — уже как проектную, с прежней подписью и промптом. Пользователь не поймёт, почему «удалённая» роль вернулась в пикер.

## Решение

Ввести экспортируемую константу `RETIRED_PERSONA_IDS` и проверять её ПЕРВЫМ действием в цикле по `Object.entries(raw)` — до валидации типа записи: id из списка отбрасывается, в `errors` попадает понятное сообщение («роль удалена из реестра, заменена X»), роль не добавляется и не переопределяет встроенные. Поведение закрыть тестами: запись в config → ошибка в `errors` + роли прежние; наличие проектного `.vibelog/prompts/personas/<id>.md` не ломает загрузку.

## Пример

VL-273: `RETIRED_PERSONA_IDS = ['orchestrator']` в `src/web/personas.ts`, guard в начале цикла `loadPersonas`, плюс кейсы на `loadPersonas`, `resolvePersona` и `GET /api/personas` (200, `errors` непуст, ролей 3). Здесь AC5 требовал блокировку, а описание задачи рекомендовало «допустимо» — выбран более строгий вариант AC; снятие блока = удаление одной строки константы.