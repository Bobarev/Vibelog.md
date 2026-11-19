/**
 * Постоянный сайдбар веб-интерфейса (VL-156, переработан в VL-165).
 *
 * Паттерн ref-2 (next-shadcn-admin-dashboard): SidebarHeader с логотипом
 * (до VL-345 — иконка Command, теперь vibelog.svg) + название проекта
 * из backlog/config.yml, SidebarContent с NavMain (группы, collapsible-подменю).
 * Отличия: без Next.js Link — хеш-ссылки <a href="#/...">; без
 * zustand/preference-store — статические пункты; footer вне скоупа.
 *
 * Навигация (VL-165/VL-177): «Задачи» (#/ — доска/список, активен и на
 * #/tasks через activeWhen); «Настройки» — parent-пункт с подменю:
 * «Бот» (#/settings, .vibelog/settings.json) и «Конфиг проекта» (#/config,
 * backlog/config.yml). References (#/references, VL-174), Documents
 * (#/documents, VL-181) и Lessons (#/lessons, VL-182) — отдельные пункты
 * в группе «Основное»,
 * подсвечиваются и на детальных страницах #/reference/<id>, #/document/<id>,
 * #/lesson/<id> (activeWhen). Развёрнутый сайдбар — Collapsible +
 * SidebarMenuSub, свёрнутый до иконок — DropdownMenu (как Authentication
 * в референсе).
 */

import * as React from "react";

import { Activity, Cpu, FileText, FolderCog, Kanban, Library, Lightbulb, MessageSquare, PlusCircle, Radio, Settings, SlidersHorizontal, Users, Wand2 } from "lucide-react";

import { Sidebar, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarRail } from "@/components/ui/sidebar";
import { NavMain, type NavGroup } from "@/components/layout/nav-main";
import { useProjectName } from "@/lib/use-project-name";

/** Группы навигации: «Задачи» + вложенное меню Настройки (VL-165/VL-177). */
const NAV_GROUPS: NavGroup[] = [
  {
    id: "main",
    label: "Основное",
    items: [
      // Переименовано «Канбан» → «Задачи» (VL-177): пункт активен и на #/,
      // и на #/tasks (таблица) — activeWhen в nav-main (lesson-11:
      // активность по хеш-роуту; поле activeRoutes из плана не нужно —
      // в NavItem уже есть эквивалентное activeWhen из VL-174)
      {
        id: "board",
        title: "Задачи",
        url: "board",
        icon: Kanban,
        activeWhen: ["tasks"],
      },
      // References (VL-174): активен и на детальной странице #/reference/<id>
      // (activeWhen в nav-main — у неё свой Route 'reference')
      {
        id: "references",
        title: "References",
        url: "references",
        icon: Library,
        activeWhen: ["references", "reference"],
      },
      // Documents (VL-181): активен и на детальной странице #/document/<id>
      {
        id: "documents",
        title: "Documents",
        url: "documents",
        icon: FileText,
        activeWhen: ["documents", "document"],
      },
      // Lessons (VL-182): активен и на детальной странице #/lesson/<id>
      // (lesson-11 — активность по хеш-роуту, не defaultOpen)
      {
        id: "lessons",
        title: "Lessons",
        url: "lessons",
        icon: Lightbulb,
        activeWhen: ["lessons", "lesson"],
      },
      // Чат с LLM (VL-204): #/chat — обсуждение проекта и создание задач
      // через tool-calling с подтверждением Allow/Deny
      {
        id: "chat",
        title: "Чат",
        url: "chat",
        icon: MessageSquare,
        activeWhen: ["chat"],
      },
      // Активность (VL-347): #/activity — единый лог работ (фазы, задачи,
      // очередь, супервизор) с переходами на задачи
      {
        id: "activity",
        title: "Активность",
        url: "activity",
        icon: Activity,
        activeWhen: ["activity"],
      },
      {
        id: "settings",
        title: "Настройки",
        icon: Settings,
        subItems: [
          { id: "bot", title: "Бот", url: "settings", icon: SlidersHorizontal },
          // Модели (VL-316): #/models — каталог шлюза, добавление/редактирование
          // моделей с ценами из API. Отдельная страница, не секция #/settings
          // (решение из плана: много состояния — каталог, поиск, цены)
          { id: "models", title: "Модели", url: "models", icon: Cpu },
          // Персоны (VL-403): #/personas — роли чата, правка промпта и памяти,
          // создание проектной роли. Рядом с «Модели»: обе — про поведение чата
          {
            id: "personas",
            title: "Персоны",
            url: "personas",
            icon: Users,
            activeWhen: ["personas", "persona"],
          },
          // Каналы interbot-связи (VL-438): #/channels — CRUD каналов,
          // лимиты/таймауты/промпты из comms.yaml. Рядом с «Персонами»:
          // обе — конфигурация поведения (паттерн VL-403)
          {
            id: "channels",
            title: "Каналы",
            url: "channels",
            icon: Radio,
            activeWhen: ["channels", "channel"],
          },
          { id: "config", title: "Конфиг проекта", url: "config", icon: FolderCog },
          // Мастер настройки проекта (VL-210): #/setup — агенты, LLM, секреты, бот, MCP
          { id: "setup", title: "Мастер настройки", url: "setup", icon: Wand2 },
        ],
      },
    ],
  },
];

export function AppSidebar({
  onQuickCreate,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  /** Клик Quick Create — открыть модалку создания задачи (VL-163). */
  onQuickCreate?: () => void;
}) {
  // Название проекта из backlog/config.yml (VL-345): при недоступном
  // конфиге — «Vibelog», как статичный титл index.html
  const projectName = useProjectName();

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild>
              <a href="#/">
                {/* Логотип Vibelog вместо иконки Command из референса (VL-345).
                    Не <img src>: во внешнем SVG currentColor НЕ наследует цвет
                    текста (Chrome резолвит его в чёрный) — в тёмной теме глиф
                    был бы чёрным на тёмном. Поэтому SVG используется как CSS-
                    маска, а цвет задаёт bg-current: иконка наследует цвет
                    текста в обеих темах без второй версии файла и dark:invert.
                    size-6 = 24 px — как у lucide-иконок в SidebarMenuButton,
                    иначе строка прыгает по высоте. aria-hidden — иконка
                    декоративна: имя проекта рядом текстом, скринридер не
                    должен читать его дважды. При collapsible=icon span
                    скрывает сам SidebarMenuButton, иконка остаётся */}
                <span
                  aria-hidden="true"
                  className="size-6 shrink-0 bg-current [mask:url(/vibelog.svg)_center/contain_no-repeat]"
                />
                {/* truncate + title: длинное имя не ломает вёрстку (AC 8) */}
                <span className="truncate font-semibold text-base" title={projectName}>
                  {projectName}
                </span>
              </a>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      {/* Quick Create — кнопка над навигацией, паттерн ref-2 (nav-main.tsx):
          bg-primary, tooltip при свёрнутом сайдбаре (VL-163) */}
      {onQuickCreate && (
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton
                  tooltip="Создать задачу"
                  onClick={onQuickCreate}
                  className="min-w-8 bg-primary text-primary-foreground duration-200 ease-linear hover:bg-primary/90 hover:text-primary-foreground active:bg-primary/90 active:text-primary-foreground"
                >
                  <PlusCircle />
                  <span>Создать задачу</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      )}
      <NavMain items={NAV_GROUPS} />
      <SidebarRail />
    </Sidebar>
  );
}
