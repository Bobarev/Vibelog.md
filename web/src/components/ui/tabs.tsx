"use client"

import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Tabs as TabsPrimitive } from "radix-ui"

// shadcn-табы в стиле ref-2 (next-shadcn-admin-dashboard src/components/ui/tabs.tsx),
// VL-211: h-8/p-[3px] вместо h-9/p-1, variant default/line, правило размера
// svg в триггере ([&_svg:not([class*='size-'])]:size-4) — иконки lucide
// рендерятся 16px, а не 24px (расхождение с референсом из VL-211/п.3).
// Контекстных провайдеров-предков у Tabs нет (lesson-7 не применим).
// TabsContent сохраняет наш класс min-h-0 overflow-y-auto — от него зависит
// скролл контента в task-view.tsx (риск из плана VL-211).

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={props.orientation ?? "horizontal"}
      className={cn(
        "group/tabs flex gap-2 data-horizontal:flex-col",
        className
      )}
      {...props}
    />
  )
}

const tabsListVariants = cva(
  // h-8 базовый вместо ref-2 group-data-horizontal/tabs:h-8: group-класс
  // не вытесняется twMerge-классом "h-auto" из task-view.tsx (другие
  // modifiers) и перебил бы его по специфичности → обрезались бы вкладки
  // модалки; визуально для horizontal-табов идентично (VL-211/риск)
  "group/tabs-list inline-flex h-8 w-fit items-center justify-center rounded-lg p-[3px] text-muted-foreground group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none",
  {
    variants: {
      variant: {
        default: "bg-muted",
        line: "gap-1 bg-transparent",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        // Без flex-1 из ref-2: в task-view.tsx вкладки модалки с flex-wrap
        // не должны растягиваться на всю строку; тулбар VL-177 сам задаёт
        // flex-1/flex-none через *:data-[slot=tabs-trigger] (VL-211)
        "relative inline-flex h-[calc(100%-1px)] items-center justify-center gap-1.5 rounded-md border border-transparent px-1.5 py-0.5 text-sm font-medium whitespace-nowrap text-foreground/60 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=default]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        "group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent",
        "data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      // Наш класс (не ref-2): скролл-контейнер вкладок модалки task-view
      className={cn("min-h-0 flex-1 overflow-y-auto outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, tabsListVariants }
