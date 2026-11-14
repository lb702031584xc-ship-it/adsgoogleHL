"use client";

import { useCallback, useEffect, useState } from "react";
import {
  getUrlSwapScriptAction,
  regenerateUrlSwapAuthAction,
} from "@/lib/api/url-swap-actions";
import type { UrlSwapScriptPayload } from "@/lib/api/url-swap";

export function UrlSwapScriptPanel() {
  const [data, setData] = useState<UrlSwapScriptPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await getUrlSwapScriptAction();
    if (!res.ok) setError(res.error);
    else setData(res.data);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="overflow-hidden rounded-xl border border-brand-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center gap-2 border-b border-brand-500/20 bg-brand-600 px-5 py-3 text-white">
        <h2 className="text-sm font-semibold">Google Ads 脚本代码</h2>
        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 disabled:opacity-50"
            disabled={loading}
            onClick={async () => {
              const res = await regenerateUrlSwapAuthAction();
              if (!res.ok) setError(res.error);
              else await load();
            }}
          >
            重置 AuthCode
          </button>
          <button
            type="button"
            className="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20 disabled:opacity-50"
            disabled={loading}
            onClick={() => void load()}
          >
            刷新
          </button>
        </div>
      </div>

      <div className="grid gap-4 p-5 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div>
          <p className="mb-3 text-sm text-slate-500">
            复制到 Google Ads → 工具与设置 → 脚本，按执行频率定时运行。
          </p>
          {error ? (
            <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}
          <div className="relative">
            <button
              type="button"
              className="absolute right-3 top-3 z-10 rounded-md border border-slate-600 bg-slate-800 px-2.5 py-1 text-xs text-white hover:bg-slate-700 disabled:opacity-50"
              disabled={!data}
              onClick={async () => {
                if (!data?.script) return;
                await navigator.clipboard.writeText(data.script);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? "已复制" : "复制"}
            </button>
            <pre className="max-h-72 overflow-auto rounded-lg border border-slate-800 bg-slate-950 p-4 text-xs leading-5 text-slate-100">
              {data?.script ?? (loading ? "加载中…" : "暂无脚本")}
            </pre>
          </div>
        </div>
        <div className="space-y-3 text-xs leading-5">
          <div className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sky-900">
            <div className="mb-2 text-sm font-semibold">使用说明</div>
            <ul className="list-disc space-y-1.5 pl-4">
              <li>复制脚本到 Google Ads Scripts</li>
              <li>授权后按任务频率设置定时</li>
              <li>脚本按广告系列名拉取 Tracking Template</li>
            </ul>
          </div>
          {data ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-slate-600">
              <div className="font-medium text-slate-800">AuthCode</div>
              <div className="mt-1 break-all font-mono text-[11px]">
                {data.apiAuthCode}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
