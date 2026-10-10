"use client";

/**
 * 每次点击盈亏 + 推荐出价（第十一批）。
 *
 * ClickProfitLine：流水线盈亏门行的紧凑展示（服务端已算好，纯展示）。
 * ClickProfitCard：可复用卡片（offer 详情页），输入可调：佣金率、预估转化率；
 *   前端按同一公式本地计算（与后端 computeClickProfit 一致）。
 *
 * 公式（透明）：
 *   单次转化佣金 = 固定佣金 ?? 价格 × 佣金率
 *   盈亏平衡出价 = 佣金 × 预估转化率
 *   推荐出价 = 盈亏平衡出价 × 0.7（留 30% 安全边际）
 *   期望盈亏/点击 = 佣金 × 预估转化率 − 出价
 */
import { useState } from "react";

export interface ClickProfitDict {
  recommendedBid: string;
  profitPerClick: string;
  perClick: string;
  formulaTitle: string;
  formulaBody: string;
  calibrateNote: string;
  notViable: string;
  commissionRateLabel: string;
  cvrLabel: string;
  cvrHint: string;
  priceLabel: string;
  fixedCommissionLabel: string;
  fixedCommissionHint: string;
  breakEvenCpc: string;
  commissionPerSale: string;
}

interface ClickProfitShape {
  commissionPerSale: number | null;
  breakEvenCpc: number | null;
  recommendedBid: number | null;
  expectedProfitPerClick: number | null;
  viable: boolean;
  note: string | null;
}

function num(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function fmt(n: number | null): string {
  if (n === null) return "—";
  const sign = n > 0 ? "+" : "";
  return `${sign}$${n.toFixed(2)}`;
}

/** 流水线行内展示：推荐出价 / 期望盈亏（绿/红）。 */
export function ClickProfitLine({
  detail,
  dict: d,
}: {
  detail: Record<string, unknown>;
  dict: ClickProfitDict;
}) {
  const cp = detail.clickProfit as ClickProfitShape | undefined;
  if (!cp) return null;
  const profit = num(cp.expectedProfitPerClick);
  const bid = num(cp.recommendedBid);
  const [open, setOpen] = useState(false);
  return (
    <span className="mt-1 block">
      <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-ink/80">
          {d.recommendedBid} ${bid !== null ? bid.toFixed(2) : "—"}
        </span>
        <span
          className={`font-semibold ${profit !== null && profit >= 0 ? "text-emerald-700" : "text-red-600"}`}
        >
          {d.profitPerClick} {fmt(profit)} {d.perClick}
        </span>
        {!cp.viable && <span className="text-red-600">{d.notViable}</span>}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="text-signal hover:underline"
        >
          {open ? "▲" : `▼ ${d.formulaTitle}`}
        </button>
      </span>
      {open && (
        <span className="mt-0.5 block rounded bg-ink/[0.03] px-2 py-1 leading-relaxed text-ink/60">
          {d.formulaBody}
          <br />
          {d.calibrateNote}
        </span>
      )}
    </span>
  );
}

/** 可复用卡片：offer 详情页（输入可调，本地计算）。 */
export function ClickProfitCard({
  dict: d,
  defaultPrice,
  defaultCommissionRate,
}: {
  dict: ClickProfitDict;
  defaultPrice?: number | null;
  defaultCommissionRate?: number | null;
}) {
  const [price, setPrice] = useState(defaultPrice != null ? String(defaultPrice) : "");
  const [rate, setRate] = useState(
    defaultCommissionRate != null ? String(defaultCommissionRate * 100) : "4"
  );
  const [fixed, setFixed] = useState("");
  const [cvr, setCvr] = useState("2");

  const priceN = parseFloat(price);
  const rateN = parseFloat(rate) / 100;
  const fixedN = fixed.trim() === "" ? null : parseFloat(fixed);
  const cvrN = parseFloat(cvr) / 100;

  const commissionPerSale =
    fixedN !== null && Number.isFinite(fixedN) && fixedN > 0
      ? fixedN
      : Number.isFinite(priceN) && Number.isFinite(rateN) && priceN > 0 && rateN > 0
        ? Math.round(priceN * rateN * 100) / 100
        : null;
  const viable =
    commissionPerSale !== null &&
    commissionPerSale > 0 &&
    Number.isFinite(cvrN) &&
    cvrN > 0;
  const breakEvenCpc =
    viable && commissionPerSale !== null
      ? Math.round(commissionPerSale * cvrN * 100) / 100
      : null;
  const recommendedBid = breakEvenCpc !== null ? Math.round(breakEvenCpc * 0.7 * 100) / 100 : 0;
  const profit =
    viable && commissionPerSale !== null && breakEvenCpc !== null
      ? Math.round((commissionPerSale * cvrN - recommendedBid) * 100) / 100
      : null;

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-1.5 text-sm text-ink";
  const labelClass = "mb-1 block text-xs text-ink/60";

  return (
    <div className="rounded-xl border border-ink/10 bg-white p-5">
      <div className="grid gap-3 md:grid-cols-4">
        <div>
          <label className={labelClass}>{d.priceLabel}</label>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="29.99"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{d.commissionRateLabel}</label>
          <input
            inputMode="decimal"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder="4"
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{d.fixedCommissionLabel}</label>
          <input
            inputMode="decimal"
            value={fixed}
            onChange={(e) => setFixed(e.target.value)}
            placeholder={d.fixedCommissionHint}
            className={inputClass}
          />
        </div>
        <div>
          <label className={labelClass}>{d.cvrLabel}</label>
          <input
            inputMode="decimal"
            value={cvr}
            onChange={(e) => setCvr(e.target.value)}
            placeholder="2"
            className={inputClass}
          />
          <p className="mt-0.5 text-[11px] text-ink/50">{d.cvrHint}</p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <span className="text-ink/70">
          {d.commissionPerSale}：<span className="font-semibold text-ink">${commissionPerSale !== null ? commissionPerSale.toFixed(2) : "—"}</span>
        </span>
        <span className="text-ink/70">
          {d.breakEvenCpc}：<span className="font-semibold text-ink">${breakEvenCpc !== null ? breakEvenCpc.toFixed(2) : "—"}</span>
        </span>
        <span className="text-ink/70">
          {d.recommendedBid}：
          <span className="font-semibold text-ink">${recommendedBid.toFixed(2)}</span>
        </span>
        <span className="text-ink/70">
          {d.profitPerClick}：
          <span className={`font-semibold ${profit !== null && profit >= 0 ? "text-emerald-700" : "text-red-600"}`}>
            {fmt(profit)} {d.perClick}
          </span>
        </span>
      </div>
      {!viable && <p className="mt-2 text-sm text-red-600">{d.notViable}</p>}

      <p className="mt-3 text-xs leading-relaxed text-ink/50">{d.formulaBody}</p>
      <p className="mt-1 text-xs leading-relaxed text-ink/50">{d.calibrateNote}</p>
    </div>
  );
}
