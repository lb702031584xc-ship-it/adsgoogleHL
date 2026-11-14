"use client";

import { useMemo, useState } from "react";
import type { UrlSwapLink, UrlSwapTask, UrlSwapTaskInput } from "@/lib/api/url-swap";

const NETWORK_OPTIONS = [
  "A WIN",
  "CJ",
  "Impact",
  "Rakuten",
  "Amazon Associates",
  "PartnerBoost",
  "其他",
];

const inputClass =
  "w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20";
const labelClass = "mb-1.5 block text-sm font-medium text-slate-700";
const hintClass = "mt-1.5 text-xs leading-5 text-slate-400";
const btnPrimary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50";
const btnSecondary =
  "inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50";

export const EMPTY_TASK_FORM: UrlSwapTaskInput = {
  network: "A WIN",
  campaignName: "",
  links: [
    { url: "", remark: "1" },
    { url: "", remark: "2" },
  ],
  landingDomain: "",
  proxyType: "none",
  geoVerifyEnabled: false,
  proxyExtractUrl: "",
  backupProxyExtractUrl: "",
  targetRegions: ["US"],
  uaStrategy: "random",
  uaPlatform: "desktop",
  referers: ["https://www.facebook.com"],
  execIntervalMinutes: 10,
  rotateIntervalMinutes: 30,
  rotationEnabled: true,
  status: "running",
};

export function taskToForm(task: UrlSwapTask): UrlSwapTaskInput {
  return {
    network: task.network,
    campaignName: task.campaignName,
    links: task.links.map((link) => ({ ...link })),
    landingDomain: task.landingDomain,
    proxyType: task.proxyType,
    geoVerifyEnabled: task.geoVerifyEnabled,
    proxyExtractUrl: task.proxyExtractUrl,
    backupProxyExtractUrl: task.backupProxyExtractUrl,
    targetRegions: [...task.targetRegions],
    uaStrategy: task.uaStrategy,
    uaPlatform: task.uaPlatform,
    referers: [...task.referers],
    execIntervalMinutes: task.execIntervalMinutes,
    rotateIntervalMinutes: task.rotateIntervalMinutes,
    rotationEnabled: task.rotationEnabled,
    status: task.status,
  };
}

function guessLandingDomain(links: UrlSwapLink[]) {
  for (const link of links) {
    if (!link.url.trim()) continue;
    try {
      const parsed = new URL(link.url.trim());
      for (const key of ["murl", "url", "u", "dest", "destination"]) {
        const raw = parsed.searchParams.get(key);
        if (!raw) continue;
        const target = new URL(raw);
        return `${target.protocol}//${target.host}/`;
      }
    } catch {
      /* ignore */
    }
  }
  return "";
}

export function UrlSwapTaskForm({
  initial = EMPTY_TASK_FORM,
  submitting,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: UrlSwapTaskInput;
  submitting?: boolean;
  submitLabel: string;
  onSubmit: (value: UrlSwapTaskInput) => Promise<void> | void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<UrlSwapTaskInput>(initial);
  const [error, setError] = useState<string | null>(null);
  const refererText = useMemo(
    () => (form.referers ?? []).join("\n"),
    [form.referers]
  );

  const updateLink = (index: number, patch: Partial<UrlSwapLink>) => {
    setForm((prev) => ({
      ...prev,
      links: prev.links.map((link, i) =>
        i === index ? { ...link, ...patch } : link
      ),
    }));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await onSubmit({
        ...form,
        referers: refererText
          .split("\n")
          .map((line) => line.trim())
          .filter(Boolean),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "保存失败");
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-800">任务配置</h2>
        </div>
        <div className="space-y-5 px-5 py-5">
          <div>
            <label className={labelClass}>联盟 *</label>
            <input
              className={inputClass}
              list="url-swap-network-options"
              required
              value={form.network ?? ""}
              onChange={(e) => setForm({ ...form, network: e.target.value })}
            />
            <datalist id="url-swap-network-options">
              {NETWORK_OPTIONS.filter((item) => item !== "其他").map((item) => (
                <option key={item} value={item} />
              ))}
            </datalist>
          </div>

          <div>
            <label className={labelClass}>广告系列名称 *</label>
            <input
              className={inputClass}
              required
              value={form.campaignName}
              onChange={(e) =>
                setForm({ ...form, campaignName: e.target.value })
              }
              placeholder="必须与 Google Ads 中的广告系列名称完全一致"
            />
            <p className={hintClass}>
              必须与 Google Ads 脚本中的 campaign.getName() 一致
            </p>
          </div>

          <div>
            <label className={labelClass}>联盟链接 *</label>
            <div className="mt-2 space-y-3">
              {form.links.map((link, index) => (
                <div
                  key={`link-${index}`}
                  className="rounded-lg border border-slate-200 bg-slate-50 p-3"
                >
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px_auto]">
                    <input
                      className={inputClass}
                      required
                      value={link.url}
                      onChange={(e) => updateLink(index, { url: e.target.value })}
                      placeholder="https://click.example.com/..."
                    />
                    <input
                      className={inputClass}
                      value={link.remark}
                      onChange={(e) =>
                        updateLink(index, { remark: e.target.value })
                      }
                      placeholder="备注"
                    />
                    <button
                      type="button"
                      className="rounded-md px-2 text-sm text-rose-500 hover:bg-rose-50 disabled:opacity-40"
                      disabled={form.links.length <= 1}
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          links: prev.links.filter((_, i) => i !== index),
                        }))
                      }
                    >
                      删除
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              className="mt-3 w-full rounded-lg border border-dashed border-brand-300 bg-brand-50/50 px-3 py-2.5 text-sm font-medium text-brand-700 hover:bg-brand-50"
              onClick={() =>
                setForm((prev) => ({
                  ...prev,
                  links: [
                    ...prev.links,
                    { url: "", remark: String(prev.links.length + 1) },
                  ],
                }))
              }
            >
              + 添加链接
            </button>
          </div>

          <div>
            <label className={labelClass}>落地页域名 *</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                className={`${inputClass} flex-1`}
                required
                value={form.landingDomain}
                onChange={(e) =>
                  setForm({ ...form, landingDomain: e.target.value })
                }
                placeholder="https://example.com/"
              />
              <button
                type="button"
                className={btnPrimary}
                onClick={() => {
                  const guessed = guessLandingDomain(form.links);
                  if (!guessed) {
                    setError("未能从联盟链接解析落地页，请手动填写");
                    return;
                  }
                  setError(null);
                  setForm((prev) => ({ ...prev, landingDomain: guessed }));
                }}
              >
                自动填充
              </button>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>执行频率（分钟）</label>
              <input
                className={inputClass}
                type="number"
                min={5}
                max={60}
                required
                value={form.execIntervalMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    execIntervalMinutes: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className={labelClass}>轮换频率（分钟）</label>
              <input
                className={inputClass}
                type="number"
                min={5}
                max={180}
                value={form.rotateIntervalMinutes}
                onChange={(e) =>
                  setForm({
                    ...form,
                    rotateIntervalMinutes: Number(e.target.value),
                  })
                }
              />
            </div>
          </div>

          <label className="flex items-start gap-2.5">
            <input
              type="checkbox"
              className="mt-1 h-4 w-4 rounded border-slate-300 text-brand-600"
              checked={form.rotationEnabled ?? true}
              onChange={(e) =>
                setForm({ ...form, rotationEnabled: e.target.checked })
              }
            />
            <span>
              <span className="text-sm font-medium text-slate-700">
                启用链接轮换
              </span>
              <p className={hintClass}>按轮换频率自动切换联盟链接</p>
            </span>
          </label>

          <div>
            <label className={labelClass}>Referer（每行一个）</label>
            <textarea
              className={`${inputClass} min-h-24`}
              value={refererText}
              onChange={(e) =>
                setForm({ ...form, referers: e.target.value.split("\n") })
              }
            />
          </div>

          {error ? (
            <div className="rounded-lg bg-rose-50 px-4 py-2 text-sm text-rose-700">
              {error}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3 border-t border-slate-100 pt-5">
            <button type="submit" className={btnPrimary} disabled={submitting}>
              {submitLabel}
            </button>
            <button type="button" className={btnSecondary} onClick={onCancel}>
              取消
            </button>
          </div>
        </div>
      </section>

      <aside className="h-fit space-y-3 xl:sticky xl:top-4">
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs leading-5 text-amber-900/85">
          <div className="mb-2 text-sm font-semibold text-amber-950">重要</div>
          <ul className="list-disc space-y-1.5 pl-4">
            <li>广告系列名必须与 Google Ads 完全一致</li>
            <li>链接支持 {"{campaign_name}"} 变量</li>
            <li>保存后到列表页复制 Ads 脚本并定时运行</li>
          </ul>
        </div>
      </aside>
    </form>
  );
}
