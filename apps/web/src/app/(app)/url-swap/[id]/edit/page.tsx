"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  UrlSwapTaskForm,
  taskToForm,
} from "@/components/url-swap/task-form";
import {
  deleteUrlSwapTaskAction,
  getUrlSwapTaskAction,
  updateUrlSwapTaskAction,
} from "@/lib/api/url-swap-actions";
import type { UrlSwapTaskInput } from "@/lib/api/url-swap";

export default function EditUrlSwapPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [initial, setInitial] = useState<UrlSwapTaskInput | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await getUrlSwapTaskAction(params.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setInitial(taskToForm(res.data));
    })();
  }, [params.id]);

  if (error) {
    return (
      <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
        {error}
      </div>
    );
  }

  if (!initial) {
    return <div className="text-sm text-slate-400">加载中…</div>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
            编辑换链任务
          </h1>
          <p className="mt-1 text-sm text-slate-500">{initial.campaignName}</p>
        </div>
        <button
          type="button"
          className="rounded-lg border border-rose-200 px-3 py-1.5 text-sm text-rose-600 hover:bg-rose-50"
          onClick={async () => {
            if (!window.confirm("确认删除该换链任务？")) return;
            const res = await deleteUrlSwapTaskAction(params.id);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            router.push("/url-swap");
          }}
        >
          删除任务
        </button>
      </div>
      <UrlSwapTaskForm
        initial={initial}
        submitting={submitting}
        submitLabel={submitting ? "保存中…" : "保存修改"}
        onCancel={() => router.push("/url-swap")}
        onSubmit={async (value) => {
          setSubmitting(true);
          const res = await updateUrlSwapTaskAction(params.id, value);
          setSubmitting(false);
          if (!res.ok) throw new Error(res.error);
          router.push("/url-swap");
        }}
      />
    </div>
  );
}
