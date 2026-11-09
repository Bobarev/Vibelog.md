---
id: lesson-267
title: 'Дочерний процесс CLI (postCreate) запускай со своим энтрипоинтом в VIBELOG_BIN и шимом в PATH, а не через vb из PATH'
status: active
tags:
  - cli
  - create
  - postCreate
  - env
  - version-skew
source_tasks:
  - VL-386
linked_tasks:
  - VL-386
created_date: 2026-11-09
updated_date: 2026-11-09
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind: workaround
---
## Проблема
`vb create` выполнял `scripts.postCreate` шаблона без своего окружения: скрипт писал `vb init --components --yes`, и дочерний процесс находил в PATH какой угодно `vb`. У пользователя с давно установленным пакетом это устаревший CLI, который не знает новых флагов — секция components молча не создавалась, и падала вся установка компонентов, хотя причина в рассинхроне версий.

## Решение
Передавать дочернему запуску собственную личность CLI по трём каналам: `VIBELOG_BIN` в env (абсолютный путь из `process.argv[1]` через resolve+realpath, потому что путь бывает относительным, а `.bin` — симлинком), каталог-шим `vb`/`vibelog` в начале PATH (шаблоны зовут `vb` по имени, и обновить все чужие шаблоны нельзя) и запись `scripts/init-vibelog.mjs` в шаблоне как явный контракт. Шим создаётся в mkdtemp и удаляется в finally, запуск через `node <bin>`, а не напрямую — executable-бита у `.mjs` может не быть. Env мержить поверх `process.env` (PATH/HOME/токены нужны npm-скрипту), но отфильтровать `VIBELOG_PHASE_*`/`VIBELOG_RUN_*`, чтобы чужой проект не унаследовал контекст агентской сессии. После postCreate проверять результат (появилась ли секция components), а не только код выхода — иначе рассинхрон остаётся невидимым.

## Пример
`vb create` → `selfBinPath()` (resolve + realpathSync от `process.argv[1]`) → `VIBELOG_BIN` в env + `makeBinShim()`: каталог с `vb`/`vibelog`, в начало PATH, содержимое `#!/bin/sh\nexec "<node>" "<bin>" "$@"`. Верификация после postCreate: `readComponentsConfig(targetDir) === null` при непустом `vibelog.components` → предупреждение «вероятно, шаблон вызвал устаревший vb из PATH».