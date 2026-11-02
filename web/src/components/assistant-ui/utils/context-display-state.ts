"use client"

/**
 * Состояние отображения контекста (VL-313).
 *
 * Порт `elements/utils/context-display-state.ts` из assistant-ui Elements
 * (ref-23). Логика сохранена как в оригинале: значение «залипает» на
 * последнем непустом usage, а `resetKey` (у нас — threadId) сбрасывает его
 * при смене треда. Нужно это из-за стриминга: пока идёт ответ, usage ещё не
 * пришёл (в Responses-режиме он вообще приходит в конце), и панель не должна
 * мигать нулём между ходами.
 */

import { createContext, useContext, useMemo, useState } from "react"
import { getUsagePercent, type TokenUsage } from "./context-usage"

type ContextDisplayContextValue = {
  usage: TokenUsage | undefined
  totalTokens: number
  /** null — размер окна неизвестен (процент не рисуем, AC6). */
  percent: number | null
  modelContextWindow: number | undefined
}

export const ContextDisplayContext =
  createContext<ContextDisplayContextValue | null>(null)

export function useContextDisplay(): ContextDisplayContextValue {
  const ctx = useContext(ContextDisplayContext)
  if (!ctx) {
    throw new Error("ContextDisplay.* must be used within ContextDisplay.Root")
  }
  return ctx
}

export function useContextDisplayState(
  usage: TokenUsage | undefined,
  resetKey: string | undefined,
  modelContextWindow: number | undefined,
) {
  const rawTokens = usage?.totalTokens ?? 0
  const [tokenState, setTokenState] = useState({
    resetKey,
    totalTokens: rawTokens > 0 ? rawTokens : 0,
    usage,
  })

  if (
    tokenState.resetKey !== resetKey ||
    (rawTokens > 0 && rawTokens !== tokenState.totalTokens) ||
    usage !== tokenState.usage
  ) {
    setTokenState((prev) => {
      if (prev.resetKey !== resetKey) {
        return { resetKey, totalTokens: rawTokens > 0 ? rawTokens : 0, usage }
      }
      if (rawTokens > 0 && rawTokens !== prev.totalTokens) {
        return { ...prev, totalTokens: rawTokens, usage }
      }
      if (usage !== prev.usage) {
        return { ...prev, usage }
      }
      return prev
    })
  }

  const current =
    tokenState.resetKey === resetKey
      ? tokenState
      : { resetKey, totalTokens: rawTokens > 0 ? rawTokens : 0, usage }
  const totalTokens = current.totalTokens
  const percent = getUsagePercent(totalTokens, modelContextWindow) ?? null
  const hasUsage = current.usage !== undefined || totalTokens > 0

  const contextValue = useMemo(
    () => ({ usage: current.usage, totalTokens, percent, modelContextWindow }),
    [current.usage, totalTokens, percent, modelContextWindow],
  )

  return { contextValue, hasUsage }
}
