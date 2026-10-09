"use client";

import type { TrafficGate } from "@/lib/api/amazon-types";

/**
 * 流量需求门卡片的文案字典（仅纯字符串，不许有函数）。
 * 由各页面从 i18n 字典里传入对应切片。
 */
export interface TrafficGateCardDict {
  /** 卡片标题 */
  title: string;
  /** 三态徽标：通过 */
  passed: string;
  /** 三态徽标：不通过 */
  notPassed: string;
  /** 三态徽标/缺值：暂无数据 */
  noData: string;
  /** gate 为 null 且非 loading 时的占位 */
  notChecked: string;
  /** loading 时的提示 */
  loading: string;
  /** 有官网 */
  officialSiteFound: string;
  /** 无官网 */
  officialSiteNotFound: string;
  /** 信号区小标题 */
  signals: string;
  /** 判定说明小标题 */
  reason: string;
  /** 信号行"阈值"前缀 */
  thresholdLabel: string;
}

function badgeClass(passed: boolean | null): string {
  if (passed === true) return "bg-green-100 text-green-800";
  if (passed === false) return "bg-red-100 text-red-800";
  return "bg-ink/10 text-ink/60";
}

function dotClass(passed: boolean | null): string {
  if (passed === true) return "bg-green-500";
  if (passed === false) return "bg-red-500";
  return "bg-ink/25";
}

function SignalRow({
  source,
  label,
  value,
  threshold,
  passed,
  note,
  dict,
}: {
  source: string;
  label: string;
  value: number | null;
  threshold: number | null;
  passed: boolean | null;
  note?: string;
  dict: TrafficGateCardDict;
}) {
  return (
    <li className="flex items-start gap-2">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${dotClass(passed)}`}
        aria-hidden
      />
      <div className="min-w-0 flex-1">
        <p className="break-words text-sm text-ink/85">
          <span className="font-medium">{label}</span>
          <span className="text-ink/50">（{source}）</span>
          {`：${value ?? dict.noData}`}
          {threshold !== null ? ` / ${dict.thresholdLabel} ${threshold}` : null}
        </p>
        {note ? <p className="text-xs text-ink/50">{note}</p> : null}
      </div>
    </li>
  );
}

export function TrafficGateCard({
  gate,
  loading,
  dict: d,
}: {
  gate: TrafficGate | null | undefined;
  loading: boolean;
  dict: TrafficGateCardDict;
}) {
  if (loading) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
            {d.loading}
          </span>
        </div>
        <div className="mt-3 space-y-2" aria-hidden>
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-4 animate-pulse rounded bg-ink/10" />
          ))}
        </div>
      </section>
    );
  }

  if (!gate) {
    return (
      <section className="rounded-xl border border-ink/10 bg-white p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
          <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs text-ink/60">
            {d.notChecked}
          </span>
        </div>
        <p className="mt-2 text-sm text-ink/50">{d.notChecked}</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-ink/10 bg-white p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-ink">{d.title}</h3>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${badgeClass(gate.passed)}`}
        >
          {gate.passed === true
            ? d.passed
            : gate.passed === false
              ? d.notPassed
              : d.noData}
        </span>
      </div>

      {gate.officialSite ? (
        <p
          className={`mt-2 text-sm ${gate.officialSite.found ? "text-green-700" : "text-ink/50"}`}
        >
          {gate.officialSite.found ? d.officialSiteFound : d.officialSiteNotFound}
          {gate.officialSite.domain ? `：${gate.officialSite.domain}` : null}
          {gate.officialSite.confidence ? (
            <span className="text-xs text-ink/40">（{gate.officialSite.confidence}）</span>
          ) : null}
        </p>
      ) : null}

      <div className="mt-2">
        <p className="text-xs font-medium text-ink/55">{d.reason}</p>
        <p className="mt-0.5 text-sm text-ink/80">{gate.reason}</p>
      </div>

      {gate.signals.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-ink/55">{d.signals}</p>
          <ul className="mt-1 space-y-1.5">
            {gate.signals.map((s, i) => (
              <SignalRow
                key={`${s.source}-${i}`}
                source={s.source}
                label={s.label}
                value={s.value}
                threshold={s.threshold}
                passed={s.passed}
                note={s.note}
                dict={d}
              />
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
