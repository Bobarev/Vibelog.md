/**
 * Страница «Модели» (VL-316): каталог шлюза + добавление/редактирование/
 * удаление моделей с ценами из API.
 *
 * Роут #/models. Отдельная страница, а не секция #/settings (решение из
 * плана): здесь много состояния — каталог, поиск, цены по вендорам.
 *
 * Что показывает:
 * - таблицу models.available: label, gateway, vendor, тариф, context_window,
 *   признак default (AC7);
 * - состояние цены каждой модели относительно каталога (AC15): совпадает /
 *   выросла / снизилась с процентом по компонентам тарифа;
 * - мастер добавления (AC8): шлюз → поиск модели → вендор с ценой →
 *   предпросмотр записи → сохранение;
 * - форму редактирования (AC9) и удаление с подтверждением (AC10).
 *
 * Деградация (риск R2): каталог недоступен — страница работает, цены
 * вводятся вручную, баннер объясняет причину. Чат и фазы от каталога не
 * зависят.
 *
 * Стиль — shadcn по образцу ref-2 (Card + Table + Dialog + Input + Select).
 */

import * as React from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  createModel,
  deleteModel,
  fetchCatalogModels,
  fetchCatalogVendors,
  fetchModels,
  fetchPrices,
  refreshPricing,
  resolveModel,
  updateModel,
  type CatalogModel,
  type CatalogVendor,
  type ModelInfo,
  type ModelPayload,
  type ModelsData,
  type PriceComparison,
  type Pricing,
} from "./api";

/** Состояние формы мастера/редактирования. */
interface FormState {
  label: string;
  description: string;
  gateway: string;
  model: string;
  vendor: string;
  api_mode: "chat" | "responses";
  context_window: string;
  input_per_1m: string;
  output_per_1m: string;
  cache_per_1m: string;
}

/** Форма из записи модели (редактирование). */
function formFromModel(m: ModelInfo): FormState {
  return {
    label: m.label,
    description: m.description ?? "",
    gateway: m.gateway,
    model: m.model,
    vendor: m.vendor ?? "",
    api_mode: m.api_mode,
    context_window: m.context_window !== undefined ? String(m.context_window) : "",
    input_per_1m: m.pricing ? String(m.pricing.input_per_1m) : "",
    output_per_1m: m.pricing ? String(m.pricing.output_per_1m) : "",
    cache_per_1m: m.pricing ? String(m.pricing.cache_per_1m) : "",
  };
}

/** Пустая форма мастера: шлюз — первый доступный. */
function emptyForm(gateways: ModelsData["gateways"]): FormState {
  return {
    label: "",
    description: "",
    gateway: gateways[0]?.id ?? "",
    model: "",
    vendor: "",
    api_mode: "chat",
    context_window: "",
    input_per_1m: "",
    output_per_1m: "",
    cache_per_1m: "",
  };
}

/** Число из текстового поля: пусто → undefined, мусор → NaN (валидирует сервер). */
function numOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  return Number(trimmed);
}

/** Форма → тело запроса. Пустые необязательные поля не отправляются. */
function payloadFromForm(form: FormState): ModelPayload {
  const payload: ModelPayload = {
    gateway: form.gateway,
    model: form.model.trim(),
    api_mode: form.api_mode,
  };
  if (form.label.trim() !== "") payload.label = form.label.trim();
  if (form.description.trim() !== "") payload.description = form.description.trim();
  if (form.vendor.trim() !== "") payload.vendor = form.vendor.trim();
  const contextWindow = numOrUndefined(form.context_window);
  if (contextWindow !== undefined) payload.context_window = contextWindow;
  const input = numOrUndefined(form.input_per_1m);
  const output = numOrUndefined(form.output_per_1m);
  const cache = numOrUndefined(form.cache_per_1m);
  if (input !== undefined || output !== undefined || cache !== undefined) {
    payload.pricing = {
      input_per_1m: input ?? 0,
      output_per_1m: output ?? 0,
      cache_per_1m: cache ?? 0,
    };
  }
  return payload;
}

/** Тариф в человекочитаемом виде: «in 33.68 / out 93.69 / cache 0». */
function formatPricing(pricing?: Pricing): string {
  if (!pricing) return "—";
  const round = (n: number): string => String(Math.round(n * 100) / 100);
  return `${round(pricing.input_per_1m)} / ${round(pricing.output_per_1m)} / ${round(pricing.cache_per_1m)}`;
}

/** Бейдж состояния цены (AC15). */
function PriceBadge({ comparison }: { comparison?: PriceComparison }) {
  if (!comparison || comparison.status === "unknown") {
    return <span className="text-xs text-muted-foreground">нет данных</span>;
  }
  if (comparison.status === "same") {
    return <Badge variant="secondary">совпадает</Badge>;
  }
  const increased = comparison.status === "increased";
  // Процент показываем по компоненте с наибольшим отклонением — она и есть
  // причина статуса (сумма смазала бы «подорожал только вывод»)
  const deltas = [comparison.input, comparison.output, comparison.cache].filter(
    (d) => d.status !== "same" && d.status !== "unknown" && d.percent !== undefined,
  );
  const worst = deltas.sort((a, b) => Math.abs(b.percent ?? 0) - Math.abs(a.percent ?? 0))[0];
  return (
    <Badge variant={increased ? "destructive" : "default"}>
      {increased ? "выросла" : "снизилась"}
      {worst?.percent !== undefined ? ` ${worst.percent > 0 ? "+" : ""}${worst.percent}%` : ""}
    </Badge>
  );
}

/** Поля тарифа: три числа + подсказка про единицы (риск R1). */
function PricingFields({
  form,
  onChange,
}: {
  form: FormState;
  onChange: (patch: Partial<FormState>) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="grid gap-1.5">
        <Label htmlFor="price-input">Ввод, ₽/1M</Label>
        <Input
          id="price-input"
          inputMode="decimal"
          value={form.input_per_1m}
          onChange={(e) => onChange({ input_per_1m: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="price-output">Вывод, ₽/1M</Label>
        <Input
          id="price-output"
          inputMode="decimal"
          value={form.output_per_1m}
          onChange={(e) => onChange({ output_per_1m: e.target.value })}
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="price-cache">Кэш, ₽/1M</Label>
        <Input
          id="price-cache"
          inputMode="decimal"
          value={form.cache_per_1m}
          onChange={(e) => onChange({ cache_per_1m: e.target.value })}
        />
      </div>
    </div>
  );
}

export function ModelsPage() {
  const [data, setData] = React.useState<ModelsData | null>(null);
  const [prices, setPrices] = React.useState<Record<string, PriceComparison>>({});
  const [error, setError] = React.useState<string | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  // Мастер добавления (AC8)
  const [addOpen, setAddOpen] = React.useState(false);
  const [form, setForm] = React.useState<FormState>(() => emptyForm([]));
  const [catalogQuery, setCatalogQuery] = React.useState("");
  const [catalogModels, setCatalogModels] = React.useState<CatalogModel[] | null>(null);
  const [catalogStale, setCatalogStale] = React.useState(false);
  const [catalogError, setCatalogError] = React.useState<string | null>(null);
  const [vendors, setVendors] = React.useState<CatalogVendor[] | null>(null);
  const [preview, setPreview] = React.useState<{ id: string; record: ModelPayload } | null>(null);

  // Редактирование (AC9) и удаление (AC10)
  const [editing, setEditing] = React.useState<ModelInfo | null>(null);
  const [editForm, setEditForm] = React.useState<FormState | null>(null);
  const [deleting, setDeleting] = React.useState<ModelInfo | null>(null);

  /** Загрузка реестра + сверки цен. */
  const load = React.useCallback(async () => {
    try {
      const models = await fetchModels();
      setData(models);
      setError(null);
      // Сверка цен — по шлюзам, у которых есть модели (AC15). Ошибка сверки
      // не должна ломать страницу: цены просто не показываются.
      const gateways = [...new Set(models.available.map((m) => m.gateway))];
      const collected: Record<string, PriceComparison> = {};
      for (const gateway of gateways) {
        try {
          const result = await fetchPrices(gateway);
          Object.assign(collected, result.prices);
          if (result.warning) setNotice(result.warning);
        } catch {
          // Каталог недоступен — таблица остаётся без колонки сверки
        }
      }
      setPrices(collected);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  React.useEffect(() => {
    // Загрузка при монтировании: setState уходят в async-продолжение load
    // (после await) — паттерн VL-174, подавление ложного срабатывания
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  /** Поиск по каталогу (AC8, шаг «поиск модели»). */
  const searchCatalog = React.useCallback(
    async (gateway: string, query: string) => {
      if (gateway === "") return;
      setCatalogError(null);
      try {
        const result = await fetchCatalogModels(gateway, query);
        setCatalogModels(result.models);
        setCatalogStale(result.stale);
      } catch (err) {
        // Риск R2: каталог недоступен — модель вводится вручную
        setCatalogModels([]);
        setCatalogError((err as Error).message);
      }
    },
    [],
  );

  /** Выбор модели в каталоге → загрузка вендоров (AC8, шаг «вендор»). */
  async function pickCatalogModel(model: CatalogModel) {
    setForm((prev) => ({
      ...prev,
      model: model.id,
      label: prev.label === "" ? model.name : prev.label,
      context_window: model.contextWindow !== undefined ? String(model.contextWindow) : prev.context_window,
      input_per_1m: String(model.pricing.input_per_1m),
      output_per_1m: String(model.pricing.output_per_1m),
      cache_per_1m: String(model.pricing.cache_per_1m),
    }));
    setPreview(null);
    setVendors(null);
    try {
      const result = await fetchCatalogVendors(form.gateway, model.id);
      setVendors(result.vendors);
    } catch (err) {
      setVendors([]);
      setCatalogError((err as Error).message);
    }
  }

  /** Выбор вендора: его цена и контекст перекрывают цену модели (AC8). */
  function pickVendor(vendor: CatalogVendor) {
    setForm((prev) => ({
      ...prev,
      vendor: vendor.id,
      context_window: vendor.contextWindow !== undefined ? String(vendor.contextWindow) : prev.context_window,
      input_per_1m: String(vendor.pricing.input_per_1m),
      output_per_1m: String(vendor.pricing.output_per_1m),
      cache_per_1m: String(vendor.pricing.cache_per_1m),
    }));
    setPreview(null);
  }

  /** Предпросмотр итоговой записи (AC8, шаг «предпросмотр»). */
  async function buildPreview() {
    setBusy(true);
    setError(null);
    try {
      const resolved = await resolveModel({
        gateway: form.gateway,
        model: form.model.trim(),
        ...(form.vendor.trim() !== "" ? { vendor: form.vendor.trim() } : {}),
      });
      setPreview({ id: resolved.id, record: resolved.record });
      if (resolved.warning) setCatalogError(resolved.warning);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Сохранение новой модели. */
  async function saveNew() {
    setBusy(true);
    setError(null);
    try {
      setData(await createModel(payloadFromForm(form)));
      setAddOpen(false);
      setNotice("Модель добавлена");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Сохранение изменений существующей модели. */
  async function saveEdit() {
    if (editing === null || editForm === null) return;
    setBusy(true);
    setError(null);
    try {
      setData(await updateModel(editing.id, payloadFromForm(editForm)));
      setEditing(null);
      setEditForm(null);
      setNotice("Модель сохранена");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Удаление с подтверждением; сервер сам отказывает для default/занятых. */
  async function confirmDelete() {
    if (deleting === null) return;
    setBusy(true);
    setError(null);
    try {
      setData(await deleteModel(deleting.id));
      setDeleting(null);
      setNotice("Модель удалена");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Обновление тарифа из каталога (AC16). */
  async function refreshOne(id: string) {
    setBusy(true);
    setError(null);
    try {
      await refreshPricing(id);
      setNotice("Тариф обновлён из каталога");
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return (
      <div className="grid gap-3 p-2">
        <Skeleton className="h-10 w-64" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  const gateways = data.gateways;

  return (
    <div className="grid gap-4 p-2">
      <Card>
        <CardHeader>
          <CardTitle>Модели</CardTitle>
          <CardDescription>
            Модели из <code>.vibelog/settings.json</code>. Цены и размер контекста подтягиваются
            из каталога шлюза — на сайт провайдера ходить не нужно.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {error !== null && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </div>
          )}
          {notice !== null && (
            <div className="rounded-md border bg-muted/40 p-3 text-sm text-muted-foreground">
              {notice}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => {
                setForm(emptyForm(gateways));
                setCatalogModels(null);
                setVendors(null);
                setPreview(null);
                setCatalogError(null);
                setCatalogQuery("");
                setAddOpen(true);
              }}
              disabled={gateways.length === 0}
            >
              Добавить модель
            </Button>
            {gateways.length === 0 && (
              <span className="text-sm text-muted-foreground">
                Сначала задайте шлюз в секции <code>gateways</code> настроек.
              </span>
            )}
          </div>

          {data.available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Моделей пока нет — добавьте первую мастером выше.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Модель</TableHead>
                  <TableHead>Шлюз</TableHead>
                  <TableHead>Вендор</TableHead>
                  <TableHead>Тариф (ввод / вывод / кэш, ₽ за 1M)</TableHead>
                  <TableHead>Контекст</TableHead>
                  <TableHead>Цена</TableHead>
                  <TableHead className="text-right">Действия</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.available.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium">{m.label}</span>
                        <span className="text-xs text-muted-foreground">{m.id}</span>
                      </div>
                    </TableCell>
                    <TableCell>{m.gateway}</TableCell>
                    <TableCell>{m.vendor ?? "—"}</TableCell>
                    <TableCell className="font-mono text-xs">{formatPricing(m.pricing)}</TableCell>
                    <TableCell>{m.context_window ?? "—"}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <PriceBadge comparison={prices[m.id]} />
                        {m.id === data.default && <Badge>default</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={busy}
                          onClick={() => void refreshOne(m.id)}
                          title="Обновить тариф из каталога"
                        >
                          Тариф
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditing(m);
                            setEditForm(formFromModel(m));
                          }}
                        >
                          Изменить
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setDeleting(m)}
                        >
                          Удалить
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Мастер добавления (AC8): шлюз → поиск → вендор → предпросмотр → сохранение */}
      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Добавить модель</DialogTitle>
            <DialogDescription>
              Выберите шлюз, найдите модель в каталоге и укажите вендора — цены подставятся сами.
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label>Шлюз</Label>
              <Select
                value={form.gateway}
                onValueChange={(value) => {
                  setForm((prev) => ({ ...prev, gateway: value, model: "", vendor: "" }));
                  setCatalogModels(null);
                  setVendors(null);
                  setPreview(null);
                }}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Выберите шлюз" />
                </SelectTrigger>
                <SelectContent>
                  {gateways.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="catalog-query">Поиск модели в каталоге</Label>
              <div className="flex gap-2">
                <Input
                  id="catalog-query"
                  placeholder="например, deepseek"
                  value={catalogQuery}
                  onChange={(e) => setCatalogQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void searchCatalog(form.gateway, catalogQuery);
                  }}
                />
                <Button
                  variant="outline"
                  onClick={() => void searchCatalog(form.gateway, catalogQuery)}
                  disabled={form.gateway === ""}
                >
                  Найти
                </Button>
              </div>
              {catalogStale && (
                <span className="text-xs text-muted-foreground">
                  Каталог недоступен — показаны данные из кэша.
                </span>
              )}
              {catalogError !== null && (
                <span className="text-xs text-destructive">{catalogError}</span>
              )}
              {catalogModels !== null && catalogModels.length > 0 && (
                <div className="max-h-48 overflow-y-auto rounded-md border">
                  {catalogModels.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => void pickCatalogModel(m)}
                      className={`flex w-full flex-col items-start gap-0.5 border-b px-3 py-2 text-left last:border-b-0 hover:bg-muted/50 ${
                        form.model === m.id ? "bg-muted" : ""
                      }`}
                    >
                      <span className="text-sm font-medium">{m.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {m.id} · {formatPricing(m.pricing)} ₽/1M
                        {m.contextWindow !== undefined ? ` · ${m.contextWindow} токенов` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              {catalogModels !== null && catalogModels.length === 0 && catalogError === null && (
                <span className="text-xs text-muted-foreground">Ничего не найдено.</span>
              )}
            </div>

            {vendors !== null && vendors.length > 0 && (
              <div className="grid gap-1.5">
                <Label>Вендор (апстрим)</Label>
                <div className="grid gap-1">
                  {vendors.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => pickVendor(v)}
                      className={`flex items-center justify-between rounded-md border px-3 py-2 text-left text-sm hover:bg-muted/50 ${
                        form.vendor === v.id ? "bg-muted" : ""
                      }`}
                    >
                      <span>
                        {v.name} <span className="text-xs text-muted-foreground">({v.id})</span>
                      </span>
                      <span className="font-mono text-xs">{formatPricing(v.pricing)} ₽/1M</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="model-name">Имя модели у шлюза</Label>
                <Input
                  id="model-name"
                  value={form.model}
                  onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                  placeholder="author/model"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="model-label">Подпись</Label>
                <Input
                  id="model-label"
                  value={form.label}
                  onChange={(e) => setForm((prev) => ({ ...prev, label: e.target.value }))}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="model-vendor">Вендор (id)</Label>
                <Input
                  id="model-vendor"
                  value={form.vendor}
                  onChange={(e) => setForm((prev) => ({ ...prev, vendor: e.target.value }))}
                  placeholder="например, baidu"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="model-context">Контекст, токенов</Label>
                <Input
                  id="model-context"
                  inputMode="numeric"
                  value={form.context_window}
                  onChange={(e) => setForm((prev) => ({ ...prev, context_window: e.target.value }))}
                />
              </div>
            </div>

            <PricingFields form={form} onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))} />

            {preview !== null && (
              <div className="rounded-md border bg-muted/30 p-3 text-sm">
                <div className="font-medium">Итоговая запись</div>
                <div className="mt-1 font-mono text-xs">
                  id: {preview.id}
                  <br />
                  gateway: {preview.record.gateway} · model: {preview.record.model}
                  {preview.record.vendor ? ` · vendor: ${preview.record.vendor}` : ""}
                  <br />
                  pricing: {formatPricing(preview.record.pricing)}
                  {preview.record.context_window !== undefined
                    ? ` · context_window: ${preview.record.context_window}`
                    : ""}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => void buildPreview()} disabled={busy || form.model.trim() === ""}>
              Предпросмотр
            </Button>
            <Button onClick={() => void saveNew()} disabled={busy || form.model.trim() === ""}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Редактирование (AC9) */}
      <Dialog open={editing !== null} onOpenChange={(open) => { if (!open) { setEditing(null); setEditForm(null); } }}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Изменить модель</DialogTitle>
            <DialogDescription>{editing?.id}</DialogDescription>
          </DialogHeader>
          {editForm !== null && (
            <div className="grid gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-label">Подпись</Label>
                  <Input
                    id="edit-label"
                    value={editForm.label}
                    onChange={(e) => setEditForm({ ...editForm, label: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-description">Описание</Label>
                  <Input
                    id="edit-description"
                    value={editForm.description}
                    onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-model">Имя модели у шлюза</Label>
                  <Input
                    id="edit-model"
                    value={editForm.model}
                    onChange={(e) => setEditForm({ ...editForm, model: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-vendor">Вендор (id)</Label>
                  <Input
                    id="edit-vendor"
                    value={editForm.vendor}
                    onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })}
                  />
                </div>
                <div className="grid gap-1.5">
                  <Label>Режим API</Label>
                  <Select
                    value={editForm.api_mode}
                    onValueChange={(value) =>
                      setEditForm({ ...editForm, api_mode: value as "chat" | "responses" })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">chat</SelectItem>
                      <SelectItem value="responses">responses</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="edit-context">Контекст, токенов</Label>
                  <Input
                    id="edit-context"
                    inputMode="numeric"
                    value={editForm.context_window}
                    onChange={(e) => setEditForm({ ...editForm, context_window: e.target.value })}
                  />
                </div>
              </div>
              <PricingFields
                form={editForm}
                onChange={(patch) => setEditForm({ ...editForm, ...patch })}
              />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => void refreshOne(editing?.id ?? "")} disabled={busy}>
              Тариф из каталога
            </Button>
            <Button onClick={() => void saveEdit()} disabled={busy}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Удаление с подтверждением (AC10) */}
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open) setDeleting(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Удалить модель?</DialogTitle>
            <DialogDescription>
              {deleting?.label} ({deleting?.id}) будет удалена из settings.json. Модель по
              умолчанию и модель, закреплённую за сессией агента, удалить нельзя — сервер
              откажет с причиной.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Отмена
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={busy}>
              Удалить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
