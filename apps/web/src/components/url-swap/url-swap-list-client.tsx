"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { UrlSwapScriptPanel } from "./script-panel";
import {
  deleteUrlSwapTaskAction,
  listUrlSwapTasksAction,
  runUrlSwapTaskAction,
  updateUrlSwapTaskAction,
} from "@/lib/api/url-swap-actions";
import type { UrlSwapSummary, UrlSwapTask } from "@/lib/api/url-swap";

const STATUS_OPTIONS = [
  { key: "all", label: "所有状态" },
  { key: "running", label: "运行中" },
  { key: "paused", label: "已暂停" },
  { key: "error", label: "异常" },
  { key: "completed", label: "已完成" },
] as const;

const STATUS_LABEL: Record<UrlSwapTask["status"], string> = {
  running: "运行中",
  paused: "已暂停",
  error: "异常",
  completed: "已完成",
};

const STATUS_TONE: Record<UrlSwapTask["status"], string> = {
  running: "bg-emerald-50 text-emerald-700",
  paused: "bg-amber-50 text-amber-700",
  error: "bg-rose-50 text-rose-700",
  completed: "bg-slate-100 text-slate-600",
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function UrlSwapListClient() {
  const [status, setStatus] =
    useState<(typeof STATUS_OPTIONS)[number]["key"]>("all");
  const [query, setQuery] = useState("");
  const [tasks, setTasks] = useState<UrlSwapTask[]>([]);
  const [summary, setSummary] = useState<UrlSwapSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await listUrlSwapTasksAction(true);
    if (!res.ok) {
      setError(res.error);
      setLoading(false);
      return;
    }
    setTasks(res.data.items);
    setSummary(res.data.summary ?? null);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return tasks.filter((task) => {
      if (status !== "all" && task.status !== status) return false;
      if (!q) return true;
      return [task.campaignName, task.network, task.landingDomain]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [tasks, status, query]);

  async function setTaskStatus(id: string, next: UrlSwapTask["status"]) {
    setActingId(id);
    const res = await updateUrlSwapTaskAction(id, { status: next });
    if (!res.ok) setError(res.error);
    else await load();
    setActingId(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            换链接任务
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            按广告系列名轮换联盟链接，Google Ads 脚本自动写入 Tracking Template
          </p>
        </div>
        <Link
          href="/url-swap/new"
          className="inline-flex items-center rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          创建换链任务
        </Link>
      </div>

      {summary ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {[
            ["全部", summary.total],
            ["运行中", summary.running],
            ["已暂停", summary.paused],
            ["异常", summary.error],
            ["已完成", summary.completed],
            ["换链次数", summary.linkChanges],
            ["成功率", `${summary.successRate}%`],
          ].map(([label, value]) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
            >
              <div className="text-xs text-slate-400">{label}</div>
              <div className="mt-1 text-xl font-semibold text-slate-900">
                {value}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <UrlSwapScriptPanel />

      <div className="flex flex-wrap items-center gap-2">
        {STATUS_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => setStatus(opt.key)}
            className={`rounded-full px-3 py-1 text-xs font-medium ${
              status === opt.key
                ? "bg-brand-600 text-white"
                : "bg-white text-slate-600 ring-1 ring-slate-200"
            }`}
          >
            {opt.label}
          </button>
        ))}
        <input
          className="ml-auto w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          placeholder="搜索系列名 / 联盟 / 域名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          type="button"
          className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>

      {error ? (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-2 text-sm text-rose-700">
          {error}
        </div>
      ) : null}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <table className="min-w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">广告系列</th>
              <th className="px-4 py-3">状态</th>
              <th className="px-4 py-3">链接</th>
              <th className="px-4 py-3">最近执行</th>
              <th className="px-4 py-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  加载中…
                </td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-slate-400">
                  还没有换链任务。
                  <Link href="/url-swap/new" className="ml-1 text-brand-600">
                    去创建
                  </Link>
                </td>
              </tr>
            ) : (
              visible.map((task) => (
                <tr key={task.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">
                      {task.campaignName}
                    </div>
                    <div className="text-xs text-slate-400">
                      {task.network} · {task.landingDomain}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_TONE[task.status]}`}
                    >
                      {STATUS_LABEL[task.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {task.links.length} 条 · 当前 #
                    {task.currentLinkIndex + 1} · 换链 {task.linkChangeCount}
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">
                    <div>{formatTime(task.lastExecAt)}</div>
                    <div className="max-w-[220px] truncate">
                      {task.lastExecMessage ?? "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      <Link
                        href={`/url-swap/${task.id}/edit`}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                      >
                        编辑
                      </Link>
                      <button
                        type="button"
                        disabled={actingId === task.id}
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50 disabled:opacity-50"
                        onClick={async () => {
                          setActingId(task.id);
                          const res = await runUrlSwapTaskAction(task.id);
                          if (!res.ok) setError(res.error);
                          else await load();
                          setActingId(null);
                        }}
                      >
                        立即执行
                      </button>
                      {task.status === "running" ? (
                        <button
                          type="button"
                          disabled={actingId === task.id}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                          onClick={() => void setTaskStatus(task.id, "paused")}
                        >
                          暂停
                        </button>
                      ) : (
                        <button
                          type="button"
                          disabled={actingId === task.id}
                          className="rounded-md border border-slate-200 px-2 py-1 text-xs hover:bg-slate-50"
                          onClick={() => void setTaskStatus(task.id, "running")}
                        >
                          启动
                        </button>
                      )}
                      <button
                        type="button"
                        disabled={actingId === task.id}
                        className="rounded-md border border-rose-200 px-2 py-1 text-xs text-rose-600 hover:bg-rose-50"
                        onClick={async () => {
                          if (!window.confirm(`确定删除「${task.campaignName}」？`))
                            return;
                          setActingId(task.id);
                          const res = await deleteUrlSwapTaskAction(task.id);
                          if (!res.ok) setError(res.error);
                          else await load();
                          setActingId(null);
                        }}
                      >
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
