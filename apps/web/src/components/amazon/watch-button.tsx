"use client";

/**
 * "跟踪"按钮（第十批）：一键跟踪 ASIN，进入需求监控。
 */
import { useState } from "react";
import { addAsinWatchAction } from "@/lib/api/asin-watch-actions";

export interface WatchButtonDict {
  watch: string;
  watching: string;
  watched: string;
}

export function WatchButton({
  asin,
  title,
  dict,
}: {
  asin?: string | null;
  title?: string | null;
  dict: WatchButtonDict;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");

  if (!asin) return null;

  async function onClick() {
    if (state === "busy" || state === "done") return;
    setState("busy");
    const r = await addAsinWatchAction(asin as string, title ?? undefined);
    setState(r.ok ? "done" : "error");
    if (!r.ok) setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={state === "busy" || state === "done"}
      className={`rounded-lg px-2.5 py-1 text-xs font-medium ${
        state === "done"
          ? "bg-emerald-100 text-emerald-800"
          : "border border-ink/15 text-ink/70 hover:bg-ink/5"
      } disabled:opacity-60`}
    >
      {state === "busy" ? dict.watching : state === "done" ? `✓ ${dict.watched}` : `👁 ${dict.watch}`}
    </button>
  );
}
