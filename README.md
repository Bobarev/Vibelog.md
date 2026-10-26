# Vibelog.md

[![npm version](https://img.shields.io/npm/v/vibelog.md.svg)](https://www.npmjs.com/package/vibelog.md)
[![license](https://img.shields.io/badge/license-Unlicense-blue)](http://unlicense.org)
[![Node.js 20+](https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen)](https://nodejs.org)

Markdown-нативный таск-менеджер для git-репозиториев, совместимый с [Backlog.md](https://github.com/MrLesk/Backlog.md) и работающий на чистом Node.js 20+.

Репозиторий: [https://gitverse.ru/bobarev/Vibelog.md](https://gitverse.ru/bobarev/Vibelog.md)

## Зачем

Оригинальный Backlog.md написан на Bun и не работает на macOS 10.15 Catalina. Vibelog.md — совместимая замена на Node.js:

- **Node.js 20+**, никаких нативных зависимостей
- **Формат данных идентичен** Backlog.md — при апгрейде macOS можно переключиться на оригинал
- **Работает с Qwen Code** через CLI и MCP
- **Минимум зависимостей** — runtime-зависимость только grammy (Telegram-бот)

## Prerequisites

- [Node.js](https://nodejs.org) 20 или новее

## Installation

```bash
npm install -g vibelog.md
```

В пакете уже собраны CLI (`dist/`) и веб-интерфейс (`web/dist`) — ничего компилировать не нужно. Одноразовый запуск без установки: `npx vibelog.md`.

Доступны два имени CLI: `vibelog` и алиас `vb` — один и тот же бинарь, поведение идентично. Запуск без аргументов показывает справку; `vibelog agent` открывает TUI-чат с LLM-агентом (см. [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md)).

## Usage

```bash
# Инициализация backlog-а в текущем git-репозитории
vibelog init "Мой проект"

# Создание задачи
vibelog task create "Добавить авторизацию" -d "Реализовать JWT" --ac "Токен создаётся"

# Доска задач в терминале
vibelog board

# Веб-интерфейс (kanban с drag-and-drop)
vibelog browser
```

Остальные команды, флаги и диагностика — в [CLI-справочнике](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md).

## Документация

| Документ | Для чего |
|---|---|
| [Руководство пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md) | Полный обзор: команды, веб-интерфейс, Telegram-бот, форматы файлов |
| [CLI-справочник](backlog/docs/doc-7-CLI-справочник-Vibelogmd.md) | Все команды, подкоманды, флаги, диагностика |
| [MCP-справочник](backlog/docs/doc-8-MCP-справочник-Vibelogmd.md) | Все MCP-инструменты: параметры и примеры вызовов |
| [Агент Vibelog](backlog/docs/doc-10-Агент-Vibelog-vibelog-agent.md) | Собственный LLM-агент: TUI, headless-фазы, лимиты |
| [MCP-подключение](MCP-SETUP.md) | Подключение Vibelog MCP к Qwen Code |
| [Best practices](backlog/docs/doc-9-Best-practices-и-производительность-Vibelogmd.md) | Workflow с Qwen Code, dogfooding, производительность |

## Contributing

Отдельного CONTRIBUTING.md нет — правила разработки описаны в [AGENTS.md](AGENTS.md). Кратко: исходники на TypeScript (`.ts` → `tsc` → `dist/`, ESM), для разработки:

```bash
pnpm install && pnpm build   # сборка обязательна: bin/vibelog.mjs импортирует dist/
pnpm test                    # build + Vitest; pnpm test:fast — только Vitest
```

## Совместимость с Backlog.md

Формат файлов задач и frontmatter идентичен Backlog.md (round-trip проверен на реальных задачах) — каталог `backlog/` совместим без миграции. Подробности — в [руководстве пользователя](backlog/docs/doc-6-Руководство-пользователя-Vibelogmd.md).

## Лицензия

[Unlicense](http://unlicense.org) (public domain)
