---
id: lesson-223
title: Тесты клонирования git-шаблона строить на локальном репозитории-фикстуре с инъекцией cloneUrl
status: active
tags:
  - тесты
  - git
  - фикстуры
  - create
source_tasks: []
linked_tasks:
  - VL-339
created_date: 2026-11-05
updated_date: 2026-11-05
supersedes: ''
last_verified: ''
verified_by: agent
applies_to: []
kind:
---
## Проблема

Тест, который клонирует шаблон с реального URL (gitverse.ru), требует сети, медленный и нестабильный в CI/офлайне; а `sparse-checkout` на репозитории из пары файлов ведёт себя иначе — всё попадает в корень, и проверить «корневые файлы не копируются» нечем.

## Решение

Фикстура — локальный git-репозиторий, созданный в самом тесте (`git init`, коммит с `templates/<name>/package.json` и одним корневым файлом), а URL клонирования инъектируется опцией ядра (`cloneUrl`/`baseUrl`), НЕ через env — env подхватили бы другие тесты. Корневой файл в фикстуре обязателен: он и доказывает, что копируется только содержимое подпапки.

## Пример

`src/core/create.test.mjs` (VL-339): `mkdtempSync` → `git init` → коммит `templates/svelte-minimal/package.json` + `README.md` в корне → `createProject({ cloneUrl: repoDir, ... })`; моки `depsRunner`/`installComponents` не дают тесту запускать реальный `pnpm install` и рекурсивный `vb init` из `postCreate`.