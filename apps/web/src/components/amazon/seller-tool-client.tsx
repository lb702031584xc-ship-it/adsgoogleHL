"use client";

import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import {
  listCatalogNetworksAction,
  listCatalogProductsAction,
  type CatalogNetwork,
  type CatalogProduct,
} from "@/lib/api/catalog-actions";

/**
 * 卖家工具 P0 网页版：与桌面版 app.py 同一套筛选与利润逻辑。
 * - 潜力库：手动录入 / CSV 批量导入 / 从商品库导入，数据只存浏览器 localStorage。
 * - 从商品库导入：只读已同步的联盟目录（PB/YP 经 catalog-sync 同步的数据），
 *   不触发新的同步、不爬取亚马逊；导入只带目录里真实有的字段。
 * - 筛选模板：阈值全部可配置，默认值来自课程说法，不是平台规则。
 * - 利润门：完整成本利润核算，净利润 <= 0 直接拦截。
 * - 目录里没有采购成本、FBA、头程、月销量：导入后标“待补录”，绝不编造，
 *   补录后才算利润；联盟佣金只作参考展示，绝不计入卖家利润。
 * - IP 标签：商标 / 版权 / 专利三道检查只打标签，最终签字在人。
 */

type IpState = "未查" | "无风险" | "有风险";

interface Product {
  id: string;
  name: string;
  asin: string;
  category: string;
  price: number;
  cost: number;
  fbaFee: number;
  shipping: number;
  monthlySales: number;
  reviews: number;
  rating: number;
  ipTrademark: IpState;
  ipCopyright: IpState;
  ipPatent: IpState;
  notes: string;
  /** 来源：manual 手动 / csv CSV导入 / catalog 商品库导入 / sample 示例。 */
  source?: "manual" | "csv" | "catalog" | "sample";
  sourceNetwork?: string | null;
  /** 渠道链接：商品库 promoUrl（目录里的真实链接，原样展示，不改写）。 */
  sourceUrl?: string | null;
  sourceExternalId?: string | null;
  /** 联盟佣金参考（美元，目录 commissionAmount）：仅展示，不计入卖家利润。 */
  affiliateCommission?: number | null;
  /** true → 采购成本/FBA/头程尚未补录，利润不算、只标待补录。 */
  costUnknown?: boolean;
}

interface Settings {
  minPrice: number;
  minProfitRule: number;
  minMonthlySales: number;
  minMargin: number;
  maxReviews: number;
  defaultReturnRate: number;
  defaultAdRate: number;
}

const PRODUCTS_KEY = "adlinklab-seller-tool-products-v1";
const SETTINGS_KEY = "adlinklab-seller-tool-settings-v1";

const DEFAULT_SETTINGS: Settings = {
  minPrice: 80,
  minProfitRule: 5,
  minMonthlySales: 100,
  minMargin: 0.15,
  maxReviews: 500,
  defaultReturnRate: 0.05,
  defaultAdRate: 0.1,
};

const SAMPLE_PRODUCTS: Product[] = [
  { id: "sample-1", name: "示例-收纳篮", asin: "B0XXXXXXX1", category: "Home",
    price: 35.99, cost: 12, fbaFee: 4.2, shipping: 3, monthlySales: 1200,
    reviews: 54, rating: 4.5, ipTrademark: "无风险", ipCopyright: "无风险",
    ipPatent: "无风险", notes: "演示数据", source: "sample" },
  { id: "sample-2", name: "示例-低价配件", asin: "B0XXXXXXX2", category: "Home",
    price: 19.99, cost: 8, fbaFee: 3.39, shipping: 2, monthlySales: 3000,
    reviews: 800, rating: 4.2, ipTrademark: "未查", ipCopyright: "未查",
    ipPatent: "未查", notes: "演示数据，价格未达 80 但利润需复核", source: "sample" },
  { id: "sample-3", name: "示例-亏损款", asin: "B0XXXXXXX3", category: "Home",
    price: 29.99, cost: 25, fbaFee: 5, shipping: 3, monthlySales: 500,
    reviews: 100, rating: 4.0, ipTrademark: "未查", ipCopyright: "未查",
    ipPatent: "未查", notes: "演示数据，应被利润门拦截", source: "sample" },
];

function calcProfit(price: number, cost: number, fbaFee: number, shipping: number,
                    returnRate: number, adRate: number): { profit: number; margin: number } {
  const profit = price - cost - fbaFee - shipping - returnRate * price - adRate * price;
  return { profit: Math.round(profit * 100) / 100, margin: price ? profit / price : 0 };
}

function ipStatus(p: Product): string {
  const flags: string[] = [];
  if (p.ipTrademark === "有风险") flags.push("商标");
  if (p.ipCopyright === "有风险") flags.push("版权");
  if (p.ipPatent === "有风险") flags.push("专利");
  if (flags.length > 0) return `需人工终审：${flags.join("、")}`;
  if ([p.ipTrademark, p.ipCopyright, p.ipPatent].includes("未查")) return "IP未查全";
  return "IP已查无风险";
}

function screenProduct(p: Product, s: Settings): string {
  if (p.costUnknown) return "待补录：缺采购成本/FBA/头程，无法算利润";
  const { profit, margin } = calcProfit(p.price, p.cost, p.fbaFee, p.shipping,
    s.defaultReturnRate, s.defaultAdRate);
  if (profit <= 0) return "拦截：净利润<=0";
  const reasons: string[] = [];
  if (margin < s.minMargin) reasons.push(`利润率${Math.round(margin * 100)}%<${Math.round(s.minMargin * 100)}%`);
  if (p.source === "catalog" && p.monthlySales === 0) {
    reasons.push("月销量未知（联盟目录无此字段）");
  } else if (p.monthlySales < s.minMonthlySales) {
    reasons.push(`月销量<${s.minMonthlySales}`);
  }
  if (p.price < s.minPrice && profit <= s.minProfitRule) reasons.push("价格与单件利润均未达双轨线");
  if (p.reviews > s.maxReviews) reasons.push("评论数偏高（仅提醒）");
  return reasons.length > 0 ? `待复核：${reasons.join("；")}` : "通过";
}

function parseCsv(text: string): Product[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim());
  const pick = (row: string[], names: string[]): string => {
    const idx = headers.findIndex((h) => names.includes(h));
    return idx >= 0 ? (row[idx] ?? "").trim() : "";
  };
  const num = (v: string): number => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const out: Product[] = [];
  for (const line of lines.slice(1)) {
    const row = line.split(",");
    const name = pick(row, ["产品名", "name"]);
    if (!name) continue;
    out.push({
      id: `csv-${Date.now()}-${out.length}`,
      name,
      asin: pick(row, ["ASIN", "asin"]),
      category: pick(row, ["类目", "category"]),
      price: num(pick(row, ["售价", "price"])),
      cost: num(pick(row, ["采购成本", "cost"])),
      fbaFee: num(pick(row, ["FBA配送", "fbaFee", "fba_fee"])),
      shipping: num(pick(row, ["头程", "shipping"])),
      monthlySales: Math.round(num(pick(row, ["月销量", "monthlySales", "monthly_sales"]))),
      reviews: Math.round(num(pick(row, ["评论数", "reviews"]))),
      rating: num(pick(row, ["评分", "rating"])),
      ipTrademark: "未查", ipCopyright: "未查", ipPatent: "未查",
      notes: pick(row, ["备注", "notes"]),
      source: "csv",
    });
  }
  return out;
}

function toCsv(products: Product[]): string {
  const header = "产品名,ASIN,类目,售价,采购成本,FBA配送,头程,月销量,评论数,评分,备注";
  const rows = products.map((p) => [p.name, p.asin, p.category, p.price, p.cost,
    p.fbaFee, p.shipping, p.monthlySales, p.reviews, p.rating, p.notes].join(","));
  return [header, ...rows].join("\n");
}

/** 商品库商品 → 潜力库商品：只映射目录真实字段，缺失的卖家成本一律不编造。 */
function catalogToProduct(item: CatalogProduct): Product {
  const noteParts: string[] = [];
  if (item.brand) noteParts.push(`品牌：${item.brand}`);
  if (item.networkName) noteParts.push(`联盟：${item.networkName}`);
  if (item.commissionAmount != null) noteParts.push(`联盟佣金参考：$${item.commissionAmount}（不计入卖家利润）`);
  if (item.syncedAt) noteParts.push(`商品库同步：${item.syncedAt.slice(0, 10)}`);
  return {
    id: `catalog-${item.id}`,
    name: item.name,
    asin: item.asin ?? "",
    category: "",
    price: item.price ?? 0,
    cost: 0,
    fbaFee: 0,
    shipping: 0,
    monthlySales: 0,
    reviews: item.reviewCount ?? 0,
    rating: 0,
    ipTrademark: "未查", ipCopyright: "未查", ipPatent: "未查",
    notes: noteParts.join("；"),
    source: "catalog",
    sourceNetwork: item.networkName ?? null,
    sourceUrl: item.promoUrl ?? null,
    sourceExternalId: item.externalId ?? null,
    affiliateCommission: item.commissionAmount ?? null,
    costUnknown: true,
  };
}

const EMPTY_FORM = {
  name: "", asin: "", category: "", price: "", cost: "", fbaFee: "",
  shipping: "", monthlySales: "", reviews: "", rating: "", notes: "",
};

export function SellerToolClient() {
  const [products, setProducts] = useState<Product[]>([]);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [form, setForm] = useState(EMPTY_FORM);
  const [ipForm, setIpForm] = useState<{ trademark: IpState; copyright: IpState; patent: IpState }>(
    { trademark: "未查", copyright: "未查", patent: "未查" });
  const [showSettings, setShowSettings] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [calc, setCalc] = useState({ price: "50", cost: "15", fba: "5", ship: "3", ret: "0.05", ad: "0.10" });

  // 从商品库导入
  const [showCatalog, setShowCatalog] = useState(false);
  const [networks, setNetworks] = useState<CatalogNetwork[]>([]);
  const [networksLoaded, setNetworksLoaded] = useState(false);
  const [networkId, setNetworkId] = useState("");
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogItems, setCatalogItems] = useState<CatalogProduct[]>([]);
  const [catalogTotal, setCatalogTotal] = useState(0);
  const [catalogSelected, setCatalogSelected] = useState<string[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");

  // 补录成本（导入商品的成本/FBA/头程/月销量人工补录）
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFields, setEditFields] = useState({ cost: "", fbaFee: "", shipping: "", monthlySales: "" });

  useEffect(() => {
    try {
      const rawP = localStorage.getItem(PRODUCTS_KEY);
      if (rawP) setProducts(JSON.parse(rawP) as Product[]);
      const rawS = localStorage.getItem(SETTINGS_KEY);
      if (rawS) setSettings({ ...DEFAULT_SETTINGS, ...(JSON.parse(rawS) as Partial<Settings>) });
    } catch {
      // 本地数据损坏时从空开始，不阻塞页面。
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PRODUCTS_KEY, JSON.stringify(products));
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    } catch {
      // 隐私模式等写不进 localStorage 时只影响本地保存，不影响当次使用。
    }
  }, [products, settings, loaded]);

  const rows = useMemo(() => products.map((p) => {
    if (p.costUnknown) return { p, profit: null as number | null, margin: null as number | null, result: screenProduct(p, settings), ip: ipStatus(p) };
    const { profit, margin } = calcProfit(p.price, p.cost, p.fbaFee, p.shipping,
      settings.defaultReturnRate, settings.defaultAdRate);
    return { p, profit, margin, result: screenProduct(p, settings), ip: ipStatus(p) };
  }), [products, settings]);

  const calcResult = useMemo(() => {
    const vals = [calc.price, calc.cost, calc.fba, calc.ship, calc.ret, calc.ad].map((v) => parseFloat(v));
    if (vals.some((v) => !Number.isFinite(v))) return null;
    return calcProfit(vals[0], vals[1], vals[2], vals[3], vals[4], vals[5]);
  }, [calc]);

  const addProduct = () => {
    if (!form.name.trim()) {
      alert("产品名不能为空");
      return;
    }
    const num = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    setProducts((prev) => [{
      id: `p-${Date.now()}`,
      name: form.name.trim(), asin: form.asin.trim(), category: form.category.trim(),
      price: num(form.price), cost: num(form.cost), fbaFee: num(form.fbaFee),
      shipping: num(form.shipping), monthlySales: Math.round(num(form.monthlySales)),
      reviews: Math.round(num(form.reviews)), rating: num(form.rating),
      ipTrademark: ipForm.trademark, ipCopyright: ipForm.copyright, ipPatent: ipForm.patent,
      notes: form.notes.trim(),
      source: "manual",
    }, ...prev]);
    setForm(EMPTY_FORM);
    setIpForm({ trademark: "未查", copyright: "未查", patent: "未查" });
  };

  const importFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const items = parseCsv(String(reader.result ?? ""));
      if (items.length === 0) {
        alert("没有读到有效行，请检查 CSV 列名是否与示例一致");
        return;
      }
      setProducts((prev) => [...items, ...prev]);
      alert(`成功导入 ${items.length} 条`);
    };
    reader.readAsText(file, "UTF-8");
  };

  const exportFile = () => {
    const blob = new Blob([toCsv(products)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "seller-tool-products.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const openCatalogPanel = async () => {
    setShowCatalog((v) => !v);
    if (networksLoaded) return;
    const res = await listCatalogNetworksAction();
    if (res.ok) {
      setNetworks(res.data);
      setNetworksLoaded(true);
    }
  };

  const loadCatalog = async () => {
    setCatalogLoading(true);
    setCatalogError("");
    const res = await listCatalogProductsAction({
      networkId: networkId || undefined,
      q: catalogQ.trim() || undefined,
      page: 1,
      pageSize: 50,
      preset: false,
    });
    setCatalogLoading(false);
    if (!res.ok) {
      setCatalogError(res.error);
      setCatalogItems([]);
      setCatalogTotal(0);
      return;
    }
    setCatalogItems(res.data.items);
    setCatalogTotal(res.data.total);
    setCatalogSelected([]);
  };

  const importSelected = () => {
    const chosen = catalogItems.filter((item) => catalogSelected.includes(item.id));
    if (chosen.length === 0) return;
    const existingKeys = new Set(products
      .filter((p) => p.source === "catalog" && p.sourceExternalId && p.sourceNetwork)
      .map((p) => `${p.sourceNetwork}:${p.sourceExternalId}`));
    const fresh: Product[] = [];
    let skipped = 0;
    for (const item of chosen) {
      const key = `${item.networkName ?? ""}:${item.externalId ?? ""}`;
      if (item.externalId && existingKeys.has(key)) {
        skipped += 1;
        continue;
      }
      existingKeys.add(key);
      fresh.push(catalogToProduct(item));
    }
    if (fresh.length > 0) setProducts((prev) => [...fresh, ...prev]);
    alert(`导入 ${fresh.length} 条${skipped > 0 ? `，跳过已导入 ${skipped} 条` : ""}。导入商品标“待补录”，补录成本后才算利润。`);
    setCatalogSelected([]);
  };

  const startEdit = (p: Product) => {
    setEditingId(p.id);
    setEditFields({
      cost: p.costUnknown ? "" : String(p.cost),
      fbaFee: p.costUnknown ? "" : String(p.fbaFee),
      shipping: p.costUnknown ? "" : String(p.shipping),
      monthlySales: p.monthlySales > 0 ? String(p.monthlySales) : "",
    });
  };

  const saveEdit = () => {
    if (!editingId) return;
    const num = (v: string): number => {
      const n = parseFloat(v);
      return Number.isFinite(n) ? n : 0;
    };
    const allFilled = editFields.cost !== "" && editFields.fbaFee !== "" && editFields.shipping !== "";
    setProducts((prev) => prev.map((p) => p.id !== editingId ? p : {
      ...p,
      cost: num(editFields.cost),
      fbaFee: num(editFields.fbaFee),
      shipping: num(editFields.shipping),
      monthlySales: editFields.monthlySales === "" ? p.monthlySales : Math.round(num(editFields.monthlySales)),
      costUnknown: !allFilled,
    }));
    setEditingId(null);
  };

  const setField = (key: keyof typeof EMPTY_FORM) => (e: ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));

  const setSetting = (key: keyof Settings) => (e: ChangeEvent<HTMLInputElement>) => {
    const n = parseFloat(e.target.value);
    if (Number.isFinite(n)) setSettings((s) => ({ ...s, [key]: n }));
  };

  const sourceLabel = (p: Product): string => {
    if (p.source === "catalog") return p.sourceNetwork ?? "商品库";
    if (p.source === "csv") return "CSV导入";
    if (p.source === "sample") return "示例";
    return "手动";
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">卖家工具 P0：选品潜力库 + 利润门</h1>
        <p className="mt-1 text-sm text-ink/60">
          潜力库数据只存在你的浏览器本地（localStorage）。唯一调服务器接口的是“从商品库导入”，
          它只读商品库里已同步的联盟商品（PB/YP 经 catalog-sync 同步的数据），不触发新的同步、
          不爬取亚马逊。筛选阈值全部可在下方改，默认值来自课程说法，不是平台规则，
          执行前以当前 Seller Central 为准。IP 任一项“有风险”只打标签，必须人工终审，系统不会自动放行。
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => setProducts(SAMPLE_PRODUCTS)}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white">载入示例（3 条）</button>
        <button type="button" onClick={openCatalogPanel}
          className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white">
          {showCatalog ? "收起商品库导入" : "从商品库导入"}
        </button>
        <label className="cursor-pointer rounded-lg border border-ink/20 px-3 py-1.5 text-sm">
          导入 CSV
          <input type="file" accept=".csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importFile(f); e.target.value = ""; }} />
        </label>
        <button type="button" onClick={exportFile}
          className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm">导出 CSV</button>
        <button type="button" onClick={() => setShowSettings((v) => !v)}
          className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm">
          {showSettings ? "收起参数设置" : "参数设置"}
        </button>
        <button type="button" onClick={() => { if (confirm("清空全部本地产品？")) setProducts([]); }}
          className="rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-700">清空本地数据</button>
      </div>

      {showCatalog && (
        <div className="rounded-lg border border-ink/10 p-4">
          <h2 className="font-semibold">从商品库导入（只读已同步商品，不触发新同步）</h2>
          <p className="mt-1 text-xs text-ink/55">
            商品库里没有采购成本、FBA、头程、月销量，导入后一律标“待补录”，绝不编造；
            补录后才算利润。联盟佣金只作参考展示，不计入卖家利润。商品库是空的先去 /catalog 同步。
            这里不套用商品库预设筛选，列出的是该网络已同步的全部商品（每页 50 条）。
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <select value={networkId} onChange={(e) => setNetworkId(e.target.value)}
              className="rounded border border-ink/20 px-2 py-1.5 text-sm">
              <option value="">全部网络</option>
              {networks.map((n) => (
                <option key={n.id} value={n.id}>{n.name}（{n.kind}）</option>
              ))}
            </select>
            <input value={catalogQ} onChange={(e) => setCatalogQ(e.target.value)}
              placeholder="搜商品名 / 品牌"
              className="rounded border border-ink/20 px-2 py-1.5 text-sm" />
            <button type="button" onClick={loadCatalog} disabled={catalogLoading}
              className="rounded-lg bg-ink px-3 py-1.5 text-sm text-white disabled:opacity-50">
              {catalogLoading ? "加载中…" : "加载商品库"}
            </button>
            {catalogItems.length > 0 && (
              <button type="button" onClick={importSelected} disabled={catalogSelected.length === 0}
                className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm disabled:opacity-50">
                导入选中（{catalogSelected.length}）
              </button>
            )}
          </div>
          {catalogError && <p className="mt-2 text-sm text-red-700">{catalogError}</p>}
          {catalogItems.length > 0 && (
            <div className="mt-3 overflow-x-auto">
              <p className="mb-2 text-xs text-ink/55">共 {catalogTotal} 条，本页 {catalogItems.length} 条。勾选后点“导入选中”。</p>
              <table className="w-full min-w-[760px] text-sm">
                <thead>
                  <tr className="bg-ink/5 text-left">
                    <th className="px-2 py-1">
                      <input type="checkbox"
                        checked={catalogSelected.length === catalogItems.length}
                        onChange={(e) => setCatalogSelected(e.target.checked ? catalogItems.map((i) => i.id) : [])} />
                    </th>
                    {["商品名", "品牌", "网络", "售价$", "联盟佣金$", "评论数", "渠道链接", "同步"].map((h) => (
                      <th key={h} className="px-2 py-1 font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {catalogItems.map((item) => (
                    <tr key={item.id} className="border-t border-ink/10">
                      <td className="px-2 py-1">
                        <input type="checkbox" checked={catalogSelected.includes(item.id)}
                          onChange={(e) => setCatalogSelected((prev) => e.target.checked
                            ? [...prev, item.id] : prev.filter((id) => id !== item.id))} />
                      </td>
                      <td className="px-2 py-1">{item.name}</td>
                      <td className="px-2 py-1">{item.brand ?? "—"}</td>
                      <td className="px-2 py-1">{item.networkName ?? "—"}</td>
                      <td className="px-2 py-1">{item.price ?? "—"}</td>
                      <td className="px-2 py-1">{item.commissionAmount ?? "—"}</td>
                      <td className="px-2 py-1">{item.reviewCount ?? "—"}</td>
                      <td className="px-2 py-1">
                        {item.promoUrl
                          ? <a href={item.promoUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">打开</a>
                          : "—"}
                      </td>
                      <td className="px-2 py-1">{item.syncedAt ? item.syncedAt.slice(0, 10) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {showSettings && (
        <div className="rounded-lg border border-ink/10 p-4">
          <h2 className="font-semibold">筛选参数（改完自动保存到浏览器本地）</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["minPrice", "价格下限 $"], ["minProfitRule", "单件利润双轨线 $"],
              ["minMonthlySales", "月销量下限"], ["minMargin", "利润率下限（0.15=15%）"],
              ["maxReviews", "评论数提醒线"], ["defaultReturnRate", "默认退货率"],
              ["defaultAdRate", "默认广告占比"],
            ] as Array<[keyof Settings, string]>).map(([key, label]) => (
              <label key={key} className="text-sm">
                <span className="text-ink/60">{label}</span>
                <input type="number" step="any" value={settings[key]} onChange={setSetting(key)}
                  className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
              </label>
            ))}
          </div>
          <p className="mt-2 text-xs text-ink/55">
            入选规则：价格 ≥ 下限 或 单件利润 &gt; 双轨线，二选一；净利润 ≤ 0 直接拦截；其余未达标显示“待复核”并列出原因。
            缺成本的导入商品先显示“待补录”，不参与利润判断。
          </p>
        </div>
      )}

      <div className="rounded-lg border border-ink/10 p-4">
        <h2 className="font-semibold">利润试算（改数字即时算，不写入库）</h2>
        <div className="mt-3 grid grid-cols-3 gap-3 md:grid-cols-6">
          {([
            ["price", "售价 $"], ["cost", "采购成本 $"], ["fba", "FBA配送 $"],
            ["ship", "头程 $"], ["ret", "退货率"], ["ad", "广告占比"],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <input value={calc[key]} onChange={(e) => setCalc((c) => ({ ...c, [key]: e.target.value }))}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
            </label>
          ))}
        </div>
        <p className="mt-3 font-semibold">
          {calcResult
            ? `单件利润 $${calcResult.profit} ｜ 利润率 ${Math.round(calcResult.margin * 100)}%${calcResult.profit > 0 && calcResult.margin >= settings.minMargin ? " ✅ 通过" : " ⚠ 未达利润门"}`
            : "请输入数字"}
        </p>
      </div>

      <div className="rounded-lg border border-ink/10 p-4">
        <h2 className="font-semibold">新增产品</h2>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {([
            ["name", "产品名 *"], ["asin", "ASIN"], ["category", "类目"], ["price", "售价 $"],
            ["cost", "采购成本 $"], ["fbaFee", "FBA配送 $"], ["shipping", "头程 $"],
            ["monthlySales", "月销量"], ["reviews", "评论数"], ["rating", "评分"], ["notes", "备注"],
          ] as Array<[keyof typeof EMPTY_FORM, string]>).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <input value={form[key]} onChange={setField(key)}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
            </label>
          ))}
          {([
            ["trademark", "商标检查"], ["copyright", "版权检查"], ["patent", "专利检查"],
          ] as const).map(([key, label]) => (
            <label key={key} className="text-sm">
              <span className="text-ink/60">{label}</span>
              <select value={ipForm[key]}
                onChange={(e) => setIpForm((f) => ({ ...f, [key]: e.target.value as IpState }))}
                className="mt-1 w-full rounded border border-ink/20 px-2 py-1">
                <option value="未查">未查</option>
                <option value="无风险">无风险</option>
                <option value="有风险">有风险</option>
              </select>
            </label>
          ))}
        </div>
        <button type="button" onClick={addProduct}
          className="mt-4 rounded-lg bg-ink px-4 py-1.5 text-sm text-white">保存到潜力库</button>
      </div>

      {editingId && (
        <div className="rounded-lg border border-ink/10 p-4">
          <h2 className="font-semibold">补录成本（四项都填了才开始算利润，空着的仍算未知）</h2>
          <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            {([
              ["cost", "采购成本 $"], ["fbaFee", "FBA配送 $"],
              ["shipping", "头程 $"], ["monthlySales", "月销量（可空）"],
            ] as const).map(([key, label]) => (
              <label key={key} className="text-sm">
                <span className="text-ink/60">{label}</span>
                <input value={editFields[key]}
                  onChange={(e) => setEditFields((f) => ({ ...f, [key]: e.target.value }))}
                  className="mt-1 w-full rounded border border-ink/20 px-2 py-1" />
              </label>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={saveEdit}
              className="rounded-lg bg-ink px-4 py-1.5 text-sm text-white">保存补录</button>
            <button type="button" onClick={() => setEditingId(null)}
              className="rounded-lg border border-ink/20 px-3 py-1.5 text-sm">取消</button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-ink/10">
        <table className="w-full min-w-[980px] text-sm">
          <thead>
            <tr className="bg-ink/5 text-left">
              {["产品名", "ASIN", "类目", "售价$", "月销量", "评论数", "评分", "单件利润$", "利润率", "筛选结果", "来源", "IP状态", ""].map((h) => (
                <th key={h} className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={13} className="px-3 py-6 text-center text-ink/55">
                潜力库是空的：点“载入示例”看 3 条演示数据，或上面新增、导入 CSV、从商品库导入。
              </td></tr>
            )}
            {rows.map(({ p, profit, margin, result, ip }) => (
              <tr key={p.id} className="border-t border-ink/10">
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.asin || "—"}</td>
                <td className="px-3 py-2">{p.category || "—"}</td>
                <td className="px-3 py-2">{p.price}</td>
                <td className="px-3 py-2">{p.source === "catalog" && p.monthlySales === 0 ? "未知" : p.monthlySales}</td>
                <td className="px-3 py-2">{p.reviews}</td>
                <td className="px-3 py-2">{p.rating || "—"}</td>
                <td className="px-3 py-2">{profit == null ? "—" : profit}</td>
                <td className="px-3 py-2">{margin == null ? "—" : `${Math.round(margin * 100)}%`}</td>
                <td className="px-3 py-2">{result}</td>
                <td className="px-3 py-2">
                  {sourceLabel(p)}
                  {p.source === "catalog" && p.sourceUrl && (
                    <span> · <a href={p.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-700 underline">渠道链接</a></span>
                  )}
                </td>
                <td className="px-3 py-2">{ip}</td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <button type="button" onClick={() => startEdit(p)} className="mr-2 text-blue-700">
                    {p.costUnknown ? "补录成本" : "编辑成本"}
                  </button>
                  <button type="button" onClick={() => setProducts((prev) => prev.filter((x) => x.id !== p.id))}
                    className="text-red-700">删除</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink/55">
        CSV 列名：产品名、ASIN、类目、售价、采购成本、FBA配送、头程、月销量、评论数、评分、备注。
        商品库导入的映射关系：商品名/ASIN/售价/评论数/渠道链接取目录真实值；品牌、联盟、联盟佣金参考、同步日期写进备注；
        采购成本、FBA、头程、月销量目录里没有，导入后待补录，补录后才算利润。
        后续版本按 P1–P3 推进：Listing 生成与校验、广告结构与报告、站外与库存盈亏。
      </p>
    </div>
  );
}
