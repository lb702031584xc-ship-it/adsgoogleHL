"use client";

/**
 * 教练模式通用拦截组件（第十三批）。
 *
 * CoachGate：渲染 findings —
 *  - kind=block：红色拦截卡（标题 + 解释 + 正确做法），父组件据此禁用提交。
 *  - kind=confirm：黄色二次确认卡（仍然继续 / 取消）。
 *
 * 另导出 interpolate() 做 {param} 插值。
 */
import type { CoachFinding } from "@/lib/api/coach-actions";
import type { CoachDict } from "@/i18n/dict/coach";

export function interpolate(template: string, params: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? `{${k}}`);
}

export function CoachGate({
  dict: d,
  findings,
  onConfirm,
  onCancel,
}: {
  dict: CoachDict;
  findings: CoachFinding[];
  onConfirm?: () => void;
  onCancel?: () => void;
}) {
  if (findings.length === 0) return null;
  const blocks = findings.filter((f) => f.kind === "block");
  const confirms = findings.filter((f) => f.kind === "confirm");

  return (
    <div className="space-y-2">
      {blocks.map((f, i) => {
        const t = d.findings[f.code];
        if (!t) return null;
        return (
          <div
            key={`b-${i}`}
            className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5"
          >
            <p className="text-sm font-semibold text-red-700">
              🛑 {d.blocked}：{t.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-600">
              {interpolate(t.body, f.params)}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-red-600">
              <span className="font-medium">✅ {interpolate(t.advice, f.params)}</span>
            </p>
          </div>
        );
      })}
      {confirms.map((f, i) => {
        const t = d.findings[f.code];
        if (!t) return null;
        return (
          <div
            key={`c-${i}`}
            className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5"
          >
            <p className="text-sm font-semibold text-amber-800">
              ⚠️ {d.confirmTitle}：{t.title}
            </p>
            <p className="mt-1 text-xs leading-relaxed text-amber-700">
              {interpolate(t.body, f.params)}
            </p>
            <p className="mt-1 text-xs text-amber-700">{interpolate(t.advice, f.params)}</p>
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={onConfirm}
                className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
              >
                {d.proceedAnyway}
              </button>
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-amber-300 px-3 py-1 text-xs text-amber-800 hover:bg-amber-100"
              >
                {d.cancel}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** 是否有硬拦截（父组件用它禁用提交按钮）。 */
export function hasCoachBlock(findings: CoachFinding[]): boolean {
  return findings.some((f) => f.kind === "block");
}
