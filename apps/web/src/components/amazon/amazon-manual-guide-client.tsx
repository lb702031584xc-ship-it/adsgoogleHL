"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { AmazonManualGuideDict } from "@/i18n/dict/amazon-manual-guide";
import { parseAmazonProductUrlAction } from "@/lib/api/amazon-actions";

const LS_CHECKS = "adlinklab-manual-guide-checks";
const LS_CATS = "adlinklab-manual-guide-cats";
const LS_CANDIDATES = "adlinklab-manual-guide-candidates";
const LS_COUNTRY = "adlinklab-manual-guide-country";

// 扫榜三榜单路径（与 scan 步骤 checklist 前三项一一对应）
const SCAN_PATHS = ["/Best-Sellers/zgbs", "/gp/movers-and-shakers", "/gp/new-releases"];
const AMAZON_DOMAINS: Record<string, string> = {
  US: "www.amazon.com",
  UK: "www.amazon.co.uk",
  DE: "www.amazon.de",
  FR: "www.amazon.fr",
  IT: "www.amazon.it",
  ES: "www.amazon.es",
  CA: "www.amazon.ca",
  AU: "www.amazon.com.au",
  JP: "www.amazon.co.jp",
};

interface CandidateRow {
  id: string;
  name: string;
  asin: string;
  rank: string;
  note: string;
}

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function StepCard({
  step,
  d,
  open,
  onToggle,
  checks,
  onCheck,
  children,
  scanLinks,
}: {
  step: { id: string; dayLabel: string; title: string; intro: string[]; checklist: string[]; tools: { label: string; href: string; external?: boolean }[] };
  d: AmazonManualGuideDict;
  open: boolean;
  onToggle: () => void;
  checks: Record<string, boolean>;
  onCheck: (key: string, v: boolean) => void;
  children?: React.ReactNode;
  scanLinks?: string[];
}) {
  const done = step.checklist.filter((_, i) => checks[`${step.id}:${i}`]).length;
  const total = step.checklist.length;
  const complete = done === total;
  return (
    <section className="rounded-xl border border-ink/10 bg-white p-5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-3 text-left"
      >
        <span className="rounded-full bg-ink px-2.5 py-1 text-xs font-bold text-white">
          {step.dayLabel}
        </span>
        <span className="flex-1">
          <span className="block text-base font-semibold text-ink">{step.title}</span>
          <span className="text-xs text-ink/60">
            {done}/{total} · {complete ? d.stepDone : d.stepTodo}
          </span>
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${
            complete ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
          }`}
        >
          {complete ? d.stepDone : d.stepTodo}
        </span>
        <span className="text-sm text-ink/50">{open ? d.collapse : d.expand} ▾</span>
      </button>
      {open && (
        <div className="mt-4 space-y-4">
          {step.intro.map((p, i) => (
            <p key={i} className="text-sm leading-6 text-ink/80">
              {p}
            </p>
          ))}
          <ul className="space-y-2">
            {step.checklist.map((item, i) => {
              const key = `${step.id}:${i}`;
              const link = scanLinks && i < scanLinks.length ? scanLinks[i] : null;
              return (
                <li key={i}>
                  <div className="flex items-start gap-2.5 rounded-lg border border-ink/10 px-3 py-2 text-sm text-ink/85 transition hover:bg-ink/[0.03]">
                    <label className="mt-0.5 flex cursor-pointer">
                      <input
                        type="checkbox"
                        checked={!!checks[key]}
                        onChange={(e) => onCheck(key, e.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                    {link ? (
                      <a
                        href={link}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sky-700 underline underline-offset-2 hover:text-sky-900"
                      >
                        <span className={checks[key] ? "text-ink/50 line-through" : ""}>{item}</span> ↗
                      </a>
                    ) : (
                      <span className={checks[key] ? "text-ink/50 line-through" : ""}>{item}</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          {children}
          {step.tools.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {step.tools.map((t, ti) => {
                const href =
                  scanLinks && step.id === "scan" && ti < scanLinks.length ? scanLinks[ti] : t.href;
                return t.external ? (
                  <a
                    key={href}
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
                  >
                    {t.label} ↗
                  </a>
                ) : (
                  <Link
                    key={href}
                    href={href}
                    className="rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90"
                  >
                    {t.label}
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export function AmazonManualGuideClient({ dict: d }: { dict: AmazonManualGuideDict }) {
  const [checks, setChecks] = useState<Record<string, boolean>>({});
  const [cats, setCats] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<CandidateRow[]>([]);
  const [country, setCountry] = useState("US");
  const [pasteUrl, setPasteUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({ categories: true });
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setChecks(loadJson(LS_CHECKS, {}));
    setCats(loadJson<string[]>(LS_CATS, []));
    setCandidates(loadJson<CandidateRow[]>(LS_CANDIDATES, []));
    setCountry(loadJson(LS_COUNTRY, "US"));
    setReady(true);
  }, []);

  useEffect(() => {
    if (ready) localStorage.setItem(LS_CHECKS, JSON.stringify(checks));
  }, [checks, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_CATS, JSON.stringify(cats));
  }, [cats, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_CANDIDATES, JSON.stringify(candidates));
  }, [candidates, ready]);
  useEffect(() => {
    if (ready) localStorage.setItem(LS_COUNTRY, JSON.stringify(country));
  }, [country, ready]);

  const scanLinks = useMemo(() => {
    const domain = AMAZON_DOMAINS[country] ?? AMAZON_DOMAINS.US;
    return SCAN_PATHS.map((p) => `https://${domain}${p}`);
  }, [country]);

  const total = useMemo(
    () => d.steps.reduce((n, s) => n + s.checklist.length, 0),
    [d]
  );
  const done = useMemo(
    () =>
      d.steps.reduce(
        (n, s) => n + s.checklist.filter((_, i) => checks[`${s.id}:${i}`]).length,
        0
      ),
    [d, checks]
  );
  const pct = total ? Math.round((done / total) * 100) : 0;
  const allDone = total > 0 && done === total;

  const toggleCat = (id: string) =>
    setCats((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : prev.length >= 2 ? prev : [...prev, id]
    );

  const addRow = () =>
    setCandidates((prev) => [
      ...prev,
      { id: `${Date.now()}-${prev.length}`, name: "", asin: "", rank: "", note: "" },
    ]);
  const updateRow = (id: string, field: keyof Omit<CandidateRow, "id">, v: string) =>
    setCandidates((prev) => prev.map((r) => (r.id === id ? { ...r, [field]: v } : r)));
  const removeRow = (id: string) => setCandidates((prev) => prev.filter((r) => r.id !== id));

  const onCheck = (key: string, v: boolean) => setChecks((prev) => ({ ...prev, [key]: v }));
  const toggleStep = (id: string) => setOpen((prev) => ({ ...prev, [id]: !prev[id] }));

  const addFromUrl = async () => {
    const url = pasteUrl.trim();
    if (!url || parsing) return;
    setParsing(true);
    setParseError("");
    try {
      const res = await parseAmazonProductUrlAction(url);
      if (!res.ok) {
        setParseError(res.error);
        return;
      }
      if (!res.data.asin) {
        setParseError(d.parseUrlNoAsin);
        return;
      }
      setCandidates((prev) => [
        ...prev,
        {
          id: `${Date.now()}-${prev.length}`,
          name: res.data.name ?? "",
          asin: res.data.asin ?? "",
          rank: "",
          note: "",
        },
      ]);
      setPasteUrl("");
    } finally {
      setParsing(false);
    }
  };

  const inputCls =
    "w-full rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink placeholder:text-ink/35";

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-4 py-6">
      <header>
        <h1 className="text-2xl font-bold text-ink">{d.title}</h1>
        <p className="mt-2 text-sm leading-6 text-ink/70">{d.description}</p>
      </header>

      <div className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-ink">{d.progressLabel}</span>
          <span className="text-ink/60">
            {d.progressText.replace("{done}", String(done)).replace("{total}", String(total))} · {pct}%
          </span>
        </div>
        <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-ink/10">
          <div
            className="h-full rounded-full bg-emerald-500 transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      {allDone && (
        <section className="rounded-xl border border-emerald-300 bg-emerald-50 p-5">
          <h2 className="text-lg font-bold text-emerald-900">{d.congratsTitle}</h2>
          <p className="mt-2 text-sm leading-6 text-emerald-800">{d.congratsBody}</p>
          <h3 className="mt-4 text-sm font-semibold text-emerald-900">{d.nextStepsTitle}</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-emerald-800">
            {d.nextSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </section>
      )}

      {d.steps.map((step) => (
        <StepCard
          key={step.id}
          step={step}
          d={d}
          open={!!open[step.id]}
          onToggle={() => toggleStep(step.id)}
          checks={checks}
          onCheck={onCheck}
          scanLinks={step.id === "scan" ? scanLinks : undefined}
        >
          {step.id === "categories" && (
            <div>
              <p className="text-sm font-medium text-ink">{d.categoriesTitle}</p>
              <p className="mt-1 text-xs text-ink/60">{d.categoriesHint}</p>
              <p className="mt-2 text-xs font-semibold text-ink/70">
                {d.selectedCount.replace("{n}", String(cats.length))}
              </p>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {d.categories.map((c) => {
                  const selected = cats.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCat(c.id)}
                      className={`rounded-xl border p-3 text-left transition ${
                        selected
                          ? "border-emerald-500 bg-emerald-50"
                          : "border-ink/15 bg-white hover:border-ink/30"
                      }`}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-ink">{c.name}</span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-full border text-xs ${
                            selected ? "border-emerald-600 bg-emerald-600 text-white" : "border-ink/25 text-transparent"
                          }`}
                        >
                          ✓
                        </span>
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-ink/65">{c.desc}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {step.id === "scan" && (
            <div>
              <div className="mb-3 flex items-center gap-2">
                <label className="text-xs font-medium text-ink/70">{d.scanCountryLabel}</label>
                <select
                  value={country}
                  onChange={(e) => setCountry(e.target.value)}
                  className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm text-ink"
                >
                  {Object.keys(AMAZON_DOMAINS).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <p className="text-sm font-medium text-ink">{d.candidateTitle}</p>
              <p className="mt-1 text-xs text-ink/60">{d.candidateHint}</p>
              <div className="mt-3 flex gap-2">
                <input
                  className={inputCls}
                  value={pasteUrl}
                  onChange={(e) => setPasteUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") addFromUrl();
                  }}
                  placeholder={d.pasteUrlPlaceholder}
                />
                <button
                  type="button"
                  onClick={addFromUrl}
                  disabled={parsing || !pasteUrl.trim()}
                  className="shrink-0 rounded-lg bg-ink px-3 py-1.5 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-40"
                >
                  {d.addFromUrl}
                </button>
              </div>
              {parseError && <p className="mt-1 text-xs text-red-600">{parseError}</p>}
              <div className="mt-3 overflow-x-auto rounded-xl border border-ink/10">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="bg-ink/[0.04] text-left text-xs text-ink/60">
                      <th className="px-3 py-2 font-medium">{d.colName}</th>
                      <th className="px-3 py-2 font-medium">{d.colAsin}</th>
                      <th className="px-3 py-2 font-medium">{d.colRank}</th>
                      <th className="px-3 py-2 font-medium">{d.colNote}</th>
                      <th className="px-3 py-2 font-medium">{d.colAction}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((r) => (
                      <tr key={r.id} className="border-t border-ink/10">
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.name}
                            placeholder={d.namePlaceholder}
                            onChange={(e) => updateRow(r.id, "name", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.asin}
                            placeholder={d.asinPlaceholder}
                            onChange={(e) => updateRow(r.id, "asin", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.rank}
                            placeholder={d.rankPlaceholder}
                            onChange={(e) => updateRow(r.id, "rank", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            className={inputCls}
                            value={r.note}
                            placeholder={d.notePlaceholder}
                            onChange={(e) => updateRow(r.id, "note", e.target.value)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removeRow(r.id)}
                            className="rounded-lg border border-red-200 px-2 py-1 text-xs text-red-600 transition hover:bg-red-50"
                          >
                            {d.removeRow}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {candidates.length === 0 && (
                  <p className="px-3 py-4 text-center text-xs text-ink/50">{d.candidateEmpty}</p>
                )}
              </div>
              <button
                type="button"
                onClick={addRow}
                className="mt-2 rounded-lg border border-ink/15 px-3 py-1.5 text-sm text-ink/80 transition hover:bg-ink/5"
              >
                + {d.addRow}
              </button>
            </div>
          )}

          {step.id === "keepa" && (
            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-4">
                <p className="text-sm font-semibold text-emerald-900">{d.keepaPassTitle}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-emerald-900/90">
                  {d.keepaPass.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
              <div className="rounded-xl border border-red-200 bg-red-50/60 p-4">
                <p className="text-sm font-semibold text-red-900">{d.keepaFailTitle}</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs leading-5 text-red-900/90">
                  {d.keepaFail.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {step.id === "reviews" && (
            <div className="rounded-xl border border-ink/10 bg-ink/[0.03] p-4">
              <p className="text-sm font-semibold text-ink">{d.finalPickTitle}</p>
              <p className="mt-1 text-xs leading-5 text-ink/65">{d.finalPickHint}</p>
              <Link
                href="/amazon/pipeline"
                className="mt-3 inline-block rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white transition hover:opacity-90"
              >
                {d.goPipeline}
              </Link>
            </div>
          )}
        </StepCard>
      ))}
    </div>
  );
}
