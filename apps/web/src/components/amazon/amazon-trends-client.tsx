"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { AmazonTrendsDict } from "@/i18n/dict/amazon-trends";
import {
  getTrendsCalendarAction,
  recommendTrendsAction,
  type TrendsCalendar,
  type TrendsRecommendResult,
} from "@/lib/api/amazon-trends-actions";

const COUNTRIES = ["US", "UK", "DE", "FR", "IT", "ES", "CA", "AU", "JP"];

function StageBadge({ stage, d }: { stage: "plan" | "prepare" | "sprint"; d: AmazonTrendsDict }) {
  const map = {
    plan: { text: d.stagePlan, cls: "bg-sky-100 text-sky-800" },
    prepare: { text: d.stagePrepare, cls: "bg-amber-100 text-amber-800" },
    sprint: { text: d.stageSprint, cls: "bg-red-100 text-red-800" },
  } as const;
  const s = map[stage];
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${s.cls}`}>
      {s.text}
    </span>
  );
}

export function AmazonTrendsClient({ dict: d }: { dict: AmazonTrendsDict }) {
  const [country, setCountry] = useState("US");
  const [calendar, setCalendar] = useState<TrendsCalendar | null>(null);
  const [calLoading, setCalLoading] = useState(false);
  const [calError, setCalError] = useState<string | null>(null);

  const [recommend, setRecommend] = useState<TrendsRecommendResult | null>(null);
  const [recLoading, setRecLoading] = useState(false);
  const [recError, setRecError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setCalLoading(true);
    setCalError(null);
    setRecommend(null);
    setRecError(null);
    void getTrendsCalendarAction(country).then((r) => {
      if (!alive) return;
      setCalLoading(false);
      if (r.ok) setCalendar(r.data);
      else setCalError(r.error);
    });
    return () => {
      alive = false;
    };
  }, [country]);

  async function onRecommend() {
    setRecLoading(true);
    setRecError(null);
    try {
      const r = await recommendTrendsAction(country);
      if (r.ok) setRecommend(r.data);
      else setRecError(`${d.recommendFailed}：${r.error}`);
    } finally {
      setRecLoading(false);
    }
  }

  const lang: "zh" | "en" =
    typeof document !== "undefined" &&
    document.cookie.includes("adlinklab-lang=en")
      ? "en"
      : "zh";

  return (
    <div className="space-y-6">
      {/* 国家选择 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h1 className="text-xl font-semibold text-ink">{d.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{d.description}</p>
        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink/80">
            {d.countryLabel}
          </label>
          <select
            className="rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
          >
            {COUNTRIES.map((c) => (
              <option key={c} value={c}>
                {d.countries[c] ?? c} ({c})
              </option>
            ))}
          </select>
        </div>
      </section>

      {/* 现在热销 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.nowHotTitle}</h2>
        {calLoading ? (
          <p className="mt-2 text-sm text-ink/50">…</p>
        ) : calError ? (
          <p className="mt-2 text-sm text-red-600">{calError}</p>
        ) : calendar && calendar.now.hotCategories.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {calendar.now.hotCategories.map((cat, i) => (
              <span
                key={i}
                className="rounded-full bg-emerald-50 px-3 py-1 text-sm text-emerald-800"
              >
                {lang === "en" ? cat.en : cat.zh}
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-2 text-sm text-ink/50">{d.nowHotEmpty}</p>
        )}
      </section>

      {/* 即将到来的购物节 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h2 className="text-base font-semibold text-ink">{d.upcomingTitle}</h2>
        {calLoading ? (
          <p className="mt-2 text-sm text-ink/50">…</p>
        ) : calError ? (
          <p className="mt-2 text-sm text-red-600">{calError}</p>
        ) : calendar && calendar.upcoming.length > 0 ? (
          <ol className="mt-3 space-y-3">
            {calendar.upcoming.map((h) => (
              <li
                key={h.id}
                className="rounded-lg border border-ink/10 p-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-ink">
                    {lang === "en" ? h.nameEn : h.nameZh}
                  </span>
                  <StageBadge stage={h.stage} d={d} />
                  <span className="text-xs text-ink/50">
                    {h.date} · {d.daysLeft} {h.daysLeft} 天
                  </span>
                </div>
                <p className="mt-1 text-sm text-ink/70">
                  {lang === "en" ? h.prepAdviceEn : h.prepAdviceZh}
                </p>
                <p className="mt-1 text-xs text-ink/50">
                  {d.categoriesLabel}：
                  {h.categories
                    .map((c) => (lang === "en" ? c.en : c.zh))
                    .join(" / ")}
                </p>
                {h.note ? (
                  <p className="mt-1 text-xs text-ink/40">{h.note}</p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-sm text-ink/50">{d.upcomingEmpty}</p>
        )}
      </section>

      {/* AI 热销推荐 */}
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold text-ink">{d.recommendTitle}</h2>
            <p className="mt-1 text-sm text-ink/60">{d.recommendDescription}</p>
          </div>
          <button
            type="button"
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-50"
            disabled={recLoading}
            onClick={onRecommend}
          >
            {recLoading ? d.recommending : d.recommendButton}
          </button>
        </div>
        {recError ? (
          <p className="mt-3 text-sm text-red-600">{recError}</p>
        ) : null}
        {recommend ? (
          <div className="mt-4">
            <p className="text-xs text-ink/50">
              {recommend.date}
              {recommend.cached ? ` ${d.recommendCached}` : null}
            </p>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {recommend.categories.map((cat, i) => (
                <div
                  key={i}
                  className="rounded-lg border border-ink/10 p-4"
                >
                  <h3 className="font-medium text-ink">{cat.name}</h3>
                  <p className="mt-1 text-sm text-ink/70">
                    <span className="font-medium">{d.reasonLabel}：</span>
                    {cat.reason}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">
                    <span className="font-medium">{d.examplesLabel}：</span>
                    {cat.examples.join(" / ")}
                  </p>
                  <p className="mt-1 text-sm text-ink/70">
                    <span className="font-medium">{d.adAngleLabel}：</span>
                    {cat.adAngle}
                  </p>
                  <div className="mt-2">
                    <p className="text-xs font-medium text-ink/55">
                      {d.keywordsLabel}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      {cat.keywords.map((kw, j) => (
                        <Link
                          key={j}
                          href={`/amazon/discovery?keyword=${encodeURIComponent(kw)}`}
                          className="rounded-full bg-sky-50 px-2.5 py-1 text-xs text-sky-800 transition hover:bg-sky-100"
                        >
                          {kw} → {d.goDiscover}
                        </Link>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : !recError ? (
          <p className="mt-3 text-sm text-ink/50">{d.recommendEmpty}</p>
        ) : null}
      </section>
    </div>
  );
}
