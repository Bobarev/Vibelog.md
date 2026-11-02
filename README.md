<p align="center">
  <img src="./.gitverse/vibelog-logo.png" alt="Backlog.md logo" width="120">
</p>

<h1 align="center">Vibelog.md</h1>
<p align="center"><strong>Markdown-нативный таск-менеджер для git-репозиториев, совместимый с <a href="https://github.com/MrLesk/Backlog.md">Backlog.md</a> и работающий на чистом Node.js 20+.</strong></p>
<p align="center">ИИ-агенты пишут код. Вы проверяете задачи: до, во время и после.</p>

<p align="center">
  <a href="https://www.npmjs.com/package/vibelog.md"><img src="https://img.shields.io/npm/v/vibelog.md?color=blue" alt="npm version"></a>
  <a href="https://www.npmjs.com/package/vibelog.md"><img src="https://img.shields.io/npm/dm/vibelog.md" alt="npm downloads"></a>
  <a href="https://gitverse.ru/bobarev/Vibelog.md/content/master/LICENSE"><img src="https://img.shields.io/badge/license-Unlicense-blue" alt="Unlicense"></a>
</p>

<p align="center">
<code>npm i -g vibelog.md</code>
</p>

---
> [!NOTE]
> Это витрина проекта, не справочник. Технические детали живут в [документации](backlog/docs/); правила — в [AGENTS.md](AGENTS.md).

## Зачем

Оригинальный Backlog.md написан на Bun и не работает на macOS 10.15 Catalina. Vibelog.md — совместимая замена на Node.js:

- **Node.js 20+**, никаких нативных зависимостей, нечего компилировать
- **Формат данных идентичен** Backlog.md — каталог `backlog/` переносится без миграции, при апгрейде macOS можно переключиться на оригинал
- **Работает с Qwen Code** через CLI и MCP: задачи, вехи, документы, референсы, lessons
- **Свой LLM-агент**: TUI-чат, headless-исполнитель фаз, веб-чат, Telegram-бот, веб-интерфейс

## Prerequisites

- [Node.js](https://nodejs.org) 20 или новее
- git-репозиторий, в котором будет жить каталог `backlog/`

## Installation

```bash
npm install -g vibelog.md
```

В пакете уже собраны CLI (`dist/`) и веб-интерфейс (`web/dist`). Одноразовый запуск без установки: `npx vibelog.md`.

Доступны два имени CLI: `vibelog` и алиас `vb` — один и тот же бинарь. Запуск без аргументов показывает справку.

## Usage

```bash
# Инициализация backlog-а в текущем git-репозитории
vibelog init "Мой проект"

# Создать задачу и посмотреть доску
vibelog task create "Добавить авторизацию" -d "Реализовать JWT" --ac "Токен создаётся"
vibelog board

# Веб-интерфейс: kanban с drag-and-drop и чат с LLM (--host 0.0.0.0 — доступ из сети)
vibelog browser
```

## Документация

| Документ | Для чего |
|---|---|
| [Руководство пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md) | Задачи, вехи, документы, веб-интерфейс, Telegram-бот, формы файлов — обзор для пользователя |
| [CLI-справочник](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md) | Все команды, подкоманды, флаги, диагностика |
| [MCP-справочник](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md) | Все MCP-инструменты: параметры, контракт ответа, примеры |
| [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md) | LLM-агент: TUI, headless-фазы, лимиты и guard повторов, модели и провайдеры, учёт токенов |
| [Супервизор](backlog/docs/doc-19-Роль-Супервизор-автозапуск-и-лечение-фаз-из-чата-спецификация.md) | Роль «Супервизор»: тик-цикл, лечение фаз, grant на прогон, шаблоны лечения, планировщик |
| [Best practices](backlog/docs/doc-9-Best-practices-и-производительность-Vibelogmd.md) | Workflow с Qwen Code, dogfooding, производительность |
| [Поддержка lessons](backlog/docs/doc-20-Lessons-как-поддерживать-корпус-в-актуальном-состоянии-аудит-supersede-outdated-workaround.md) | Аудит корпуса, `needs-review`, `supersede`/`outdated`, техдолг из workaround'ов |
| [Эксперименты (A/B)](backlog/docs/doc-21-Эксперименты-AB-generic-спецификация-и-границы-версий-фичи.md) | Спецификация: `backlog/experiments/`, датасеты, `record`/`report`, judge, границы MVP/v2 |
| [MCP-подключение](MCP-SETUP.md) | Подключение Vibelog MCP к Qwen Code |

## Contributing

Отдельного CONTRIBUTING.md нет — правила разработки, проверки и коммиты описаны в [AGENTS.md](AGENTS.md). Кратко: исходники на TypeScript (`.ts` → `tsc` → `dist/`, ESM), пакетный менеджер pnpm.

```bash
pnpm install && pnpm build   # сборка обязательна: bin/vibelog.mjs импортирует dist/
pnpm test                    # build + Vitest; pnpm test:fast — только Vitest
```

## Совместимость с Backlog.md

Структура каталогов `backlog/`, формат md/yaml-файлов и frontmatter задач идентичны Backlog.md (round-trip проверен на реальных задачах) — при переключении на оригинал данные подхватываются без миграции. Внутренние API (core, CLI, веб) развиваются независимо и совместимости не обещают.

## Лицензия

[Unlicense](http://unlicense.org) (public domain)
