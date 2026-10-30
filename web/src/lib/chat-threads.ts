/**
 * Чистая логика тредов чата (VL-207) — без React, переиспользуется
 * хуком useChatThreadId и восстановлением истории в ChatPage.
 *
 * Конвертация истории: сервер хранит jsonl в формате ChatMessage
 * (src/agent/llm.ts: user / assistant+tool_calls / tool), клиентский
 * рантайм assistant-ui ждёт ThreadMessageLike[] (parts). Особенности:
 * - результаты tool-сообщений вливаются в tool-call part по tool_call_id;
 * - tool_call БЕЗ результата — висящий approval (backlog_create_task ждёт
 *   Allow/Deny): восстанавливаем part с approval {id} и статусом
 *   requires-action, чтобы после перезагрузки страницы кнопки снова
 *   заработали (паттерн VL-204: решение уходит resume-запросом);
 * - результат-объект с ключом error помечаем isError — иначе карточка
 *   «Создание задачи» покажет «Задача создана» вместо отказа (отказ в
 *   jsonl хранится как {"error": ...} без флага).
 */

import type { ThreadMessageLike } from "@assistant-ui/react";

// Чистый модуль классификации тулзов (без React) — fallback-зеркало серверного
// isWriteOperation для старых jsonl без флага (VL-264, риск R3 плана).
import { isWriteTool } from "../components/chat/tool-meta";

/** Одна строка jsonl-истории треда ( subset ChatMessage для конвертации). */
export interface HistoryMessage {
  role: string;
  content?: string | null;
  tool_calls?: { id: string; name: string; arguments: Record<string, unknown> }[];
  tool_call_id?: string;
}

/** Тип parts assistant-сообщения ThreadMessageLike (нужен для приведения). */
type AssistantParts = Extract<ThreadMessageLike, { role: "assistant" }>["content"];

/** id треда из хеша `#/chat/<id>`; null — тред не выбран, 'new' — новый. */
export function parseChatThreadId(hash: string): string | null {
  const match = hash.match(/^#\/chat\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Конвертация jsonl-истории в initialMessages рантайма.
 * Порядок сообщений и ветки сохраняются; system-сообщения пропускаются
 * (на сервере они и так не сохраняются).
 *
 * VL-264: options.allowList — инструменты треда, разрешённые «Always allow».
 * Part такого инструмента помечается `providerMetadata.vibelog.auto` —
 * карточка после восстановления показывает пометку «разрешено заранее»
 * (иначе «Always allow» выглядел бы потерянным после перезагрузки). Кроме
 * того висящий approval восстанавливается для ЛЮБОГО write-инструмента, а не
 * только для backlog_create_task (раньше клик по кнопке после перезагрузки
 * молча не срабатывал для write_file/backlog_update_task).
 *
 * @param history — строки jsonl треда (ChatMessage)
 * @param options.allowList — allow-list треда с сервера (GET /api/chat/threads/:id)
 */
export function historyToMessages(
  history: readonly HistoryMessage[],
  options: { allowList?: readonly string[] } = {},
): ThreadMessageLike[] {
  const allowList = new Set(options.allowList ?? []);
  // Результаты tool-вызовов — отдельным проходом: tool-сообщения в jsonl
  // идут ПОСЛЕ assistant-сообщения с tool_calls
  const results = new Map<string, string>();
  for (const m of history) {
    if (m.role === "tool" && m.tool_call_id && typeof m.content === "string") {
      results.set(m.tool_call_id, m.content);
    }
  }

  const out: ThreadMessageLike[] = [];
  for (const m of history) {
    if (m.role === "system") continue;

    if (m.role === "user") {
      out.push({ role: "user", content: typeof m.content === "string" ? m.content : "" });
      continue;
    }

    if (m.role !== "assistant") continue; // tool — уже влит в tool-call parts

    const parts: object[] = [];
    // Пустой text-part не добавляем: рантайм может считать его «текущим»
    if (typeof m.content === "string" && m.content.length > 0) {
      parts.push({ type: "text", text: m.content });
    }

    let pendingApproval = false;
    for (const tc of m.tool_calls ?? []) {
      const raw = results.get(tc.id);
      const part: Record<string, unknown> = {
        type: "tool-call",
        toolCallId: tc.id,
        toolName: tc.name,
        // аргументы пришли из JSON-файла → JSON-клон для readonly-совместимости
        args: JSON.parse(JSON.stringify(tc.arguments ?? {})),
        argsText: JSON.stringify(tc.arguments ?? {}),
      };

      if (raw !== undefined) {
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          // не-JSON результат (текст ошибки) оставляем строкой
        }
        part.result = parsed;
        // {"error": ...} — отказ/ошибка инструмента без отдельного флага isError;
        // VL-262: отказ подтверждения/ошибка в новом контракте — {ok:false, denied:true, …}
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          ("error" in parsed || (parsed as { ok?: unknown }).ok === false)
        ) {
          part.isError = true;
        }
        // VL-264: вызов прошёл по allow-list треда — пометка «разрешено заранее»
        if (allowList.has(tc.name)) {
          part.providerMetadata = { vibelog: { auto: true } };
        }
      } else if (isWriteTool(tc.name)) {
        // Висящий approval: Allow/Deny снова активны после восстановления
        // (VL-264: любой write-инструмент, а не только backlog_create_task)
        part.approval = { id: tc.id };
        if (allowList.has(tc.name)) part.providerMetadata = { vibelog: { auto: true } };
        pendingApproval = true;
      } else {
        // Обрыв до получения результата — не оставляем «выполняется» навсегда
        part.result = { error: "Прервано" };
        part.isError = true;
      }
      parts.push(part);
    }

    if (parts.length === 0) continue;
    out.push({
      role: "assistant",
      content: parts as AssistantParts,
      status: pendingApproval
        ? { type: "requires-action", reason: "tool-calls" }
        : { type: "complete", reason: "unknown" },
    });
  }
  return out;
}
