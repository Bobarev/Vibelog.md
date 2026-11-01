# Аудит lessons — исходное состояние до санитарного прохода (VL-281)

Снимок, сделанный первым прогоном `vibelog lesson audit` **до** любых правок корпуса.
Текущий отчёт (после прохода) — в `backlog/lessons/AUDIT.md`, он перезаписывается каждым
`--write`. Этот файл — точка отсчёта: по нему видно, что именно изменил проход.

Уроков проверено: 153. Находок: 14.

Порог дублей: 0.35; порог протухания: 180 дн.

## Сводка по типам (до)

| Тип | Находок |
| --- | --- |
| missing_path | 6 |
| dangling_task | 0 |
| broken_supersede | 0 |
| supersede_cycle | 0 |
| duplicate_of | 8 |
| stale | 0 |

## Находки (до)

| Lesson | Тип | Детали |
| --- | --- | --- |
| lesson-103 | missing_path | `backlog/VL-254.md` |
| lesson-103 | missing_path | `backlog/active/VL-254.md` |
| lesson-128 | missing_path | `src/web/supervisor-state.ts` |
| lesson-139 | missing_path | `templates/phases/x.md.bak` |
| lesson-147 | missing_path | `backlog/lessons/AUDIT.md` |
| lesson-59 | missing_path | `src/web/components/chat/chat-runtime.tsx` |
| lesson-107 | duplicate_of | похож на lesson-140 (0.52) |
| lesson-107 | duplicate_of | похож на lesson-29 (0.36) |
| lesson-140 | duplicate_of | похож на lesson-107 (0.52) |
| lesson-140 | duplicate_of | похож на lesson-29 (0.39) |
| lesson-24 | duplicate_of | похож на lesson-82 (0.44) |
| lesson-29 | duplicate_of | похож на lesson-107 (0.36) |
| lesson-29 | duplicate_of | похож на lesson-140 (0.39) |
| lesson-82 | duplicate_of | похож на lesson-24 (0.44) |

## Разбивка статусов до прохода

| Статус | Уроков |
| --- | --- |
| active | 148 |
| outdated | 0 |
| superseded | 5 |
| needs-review | 0 |
| **Всего** | 153 |

Примечание: в постановке задачи корпус оценивался как 141 файл — фактически на момент
прохода было 153 (корпус вырос на задачах VL-279/280 и соседних).

## Что сделано с находками

| Находка | Решение |
| --- | --- |
| missing_path lesson-103 (2 шт.) | убраны из текста заведомо неверные варианты пути, которые агент перебирал; пример обезличен |
| missing_path lesson-128 | путь исправлен: `src/core/supervisor-state.ts` |
| missing_path lesson-139 | иллюстративный `x.md` заменён переменной `$TARGET` |
| missing_path lesson-147 | ссылка на `AUDIT.md` — самоописание инструмента; после первого `--write` файл существует |
| missing_path lesson-59 | путь исправлен: `web/src/components/chat/chat-runtime.tsx` |
| duplicate lesson-29 / 107 / 140 | сведены в lesson-140 цепочкой 29 → 107 → 140 |
| duplicate lesson-24 / 82 | сведены в lesson-82 (два блокера одного шага Close) |

Повторный прогон аудита после прохода: **0 находок** всех типов. Подробности и процесс
поддержки — `backlog/docs/doc-20-Lessons-как-поддерживать-корпус-в-актуальном-состоянии-аудит-supersede-outdated-workaround.md`.
