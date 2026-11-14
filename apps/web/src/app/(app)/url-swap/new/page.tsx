"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  EMPTY_TASK_FORM,
  UrlSwapTaskForm,
} from "@/components/url-swap/task-form";
import { createUrlSwapTaskAction } from "@/lib/api/url-swap-actions";

export default function NewUrlSwapPage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">
          创建换链任务
        </h1>
        <p className="mt-1 text-sm text-slate-500">
          配置广告系列与联盟链接，保存后即可通过 Google Ads 脚本自动换链
        </p>
      </div>
      <UrlSwapTaskForm
        initial={EMPTY_TASK_FORM}
        submitting={submitting}
        submitLabel={submitting ? "保存中…" : "创建任务"}
        onCancel={() => router.push("/url-swap")}
        onSubmit={async (value) => {
          setSubmitting(true);
          const res = await createUrlSwapTaskAction(value);
          setSubmitting(false);
          if (!res.ok) throw new Error(res.error);
          router.push("/url-swap");
        }}
      />
    </div>
  );
}
