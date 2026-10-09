"use client";

/**
 * Per-row enable/pause button for the campaigns list.
 * Click → inline confirm → queue a campaign-toggle task via server action →
 * show "queued, script executing" and poll the task until it is terminal.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  getCampaignToggleTaskAction,
  toggleCampaignAction,
  type CampaignToggleAction,
} from "@/lib/api/campaign-toggle-actions";

/**
 * Serializable strings for the toggle button.
 * The i18n dict contains a `confirmBody(name, action)` *function*, which RSC
 * cannot serialize into a Client Component prop (it throws "Functions cannot
 * be passed directly to Client Components" as a server-side exception).
 * The server component must pre-resolve it per row and pass this plain object.
 */
export interface CampaignToggleStrings {
  enable: string;
  pause: string;
  confirmEnableTitle: string;
  confirmPauseTitle: string;
  /** Pre-resolved server-side from confirmBody(campaignName, actionWord). */
  confirmBody: string;
  confirm: string;
  cancel: string;
  queued: string;
  succeeded: string;
  failed: string;
  queueFailed: string;
  taskId: string;
  unknownError: string;
}

type Phase =
  | "idle"
  | "confirming"
  | "queueing"
  | "queued"
  | "done"
  | "error";

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);

export function CampaignToggleButton({
  campaignId,
  googleAccountId,
  currentStatus,
  t,
}: {
  campaignId: string;
  googleAccountId: string;
  currentStatus: string;
  t: CampaignToggleStrings;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [taskStatus, setTaskStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  const action: CampaignToggleAction =
    currentStatus === "PAUSED" ? "ENABLE" : "PAUSE";

  const stopPolling = useCallback(() => {
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  useEffect(() => stopPolling, [stopPolling]);

  const startPolling = useCallback(
    (id: string) => {
      stopPolling();
      pollTimer.current = setInterval(async () => {
        const res = await getCampaignToggleTaskAction(id);
        if (!res.ok) {
          setError(res.error || t.unknownError);
          setPhase("error");
          stopPolling();
          return;
        }
        setTaskStatus(res.task.status);
        if (TERMINAL.has(res.task.status)) {
          stopPolling();
          setPhase("done");
        }
      }, 3000);
    },
    [stopPolling, t]
  );

  const onConfirm = useCallback(async () => {
    setPhase("queueing");
    setError(null);
    const res = await toggleCampaignAction(
      campaignId,
      action,
      googleAccountId
    );
    if (!res.ok) {
      setError(res.error || t.unknownError);
      setPhase("error");
      return;
    }
    setTaskId(res.taskId);
    setTaskStatus(res.task.status);
    setPhase("queued");
    if (!TERMINAL.has(res.task.status)) {
      startPolling(res.taskId);
    } else {
      setPhase("done");
    }
  }, [action, campaignId, googleAccountId, startPolling, t]);

  const baseBtn =
    "rounded-md border px-2.5 py-1 text-[13px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";

  if (phase === "done") {
    const ok = taskStatus === "COMPLETED";
    return (
      <span
        className={`inline-block rounded-md px-2.5 py-1 text-[13px] ${
          ok ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
        }`}
        title={taskId ? `${t.taskId}: ${taskId}` : undefined}
      >
        {ok ? t.succeeded : t.failed}
      </span>
    );
  }

  if (phase === "error") {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-[13px] text-red-600">
          {t.queueFailed}: {error}
        </span>
        <button
          type="button"
          className={`${baseBtn} border-ink/20 text-ink hover:bg-ink/5`}
          onClick={() => {
            setPhase("idle");
            setError(null);
          }}
        >
          {t.cancel}
        </button>
      </span>
    );
  }

  if (phase === "confirming") {
    return (
      <span className="inline-flex flex-col gap-1.5">
        <span className="text-[13px] font-medium text-ink">
          {action === "ENABLE"
            ? t.confirmEnableTitle
            : t.confirmPauseTitle}
        </span>
        <span className="max-w-[260px] text-[12px] text-ink/60">
          {t.confirmBody}
        </span>
        <span className="inline-flex gap-1.5">
          <button
            type="button"
            className={`${baseBtn} border-transparent text-white ${
              action === "ENABLE"
                ? "bg-emerald-600 hover:bg-emerald-700"
                : "bg-amber-600 hover:bg-amber-700"
            }`}
            onClick={onConfirm}
          >
            {t.confirm}
          </button>
          <button
            type="button"
            className={`${baseBtn} border-ink/20 text-ink hover:bg-ink/5`}
            onClick={() => setPhase("idle")}
          >
            {t.cancel}
          </button>
        </span>
      </span>
    );
  }

  if (phase === "queueing" || phase === "queued") {
    return (
      <span
        className="inline-block rounded-md bg-sky-50 px-2.5 py-1 text-[13px] text-sky-700"
        title={taskId ? `${t.taskId}: ${taskId}` : undefined}
      >
        {t.queued}
      </span>
    );
  }

  return (
    <button
      type="button"
      className={`${baseBtn} ${
        action === "ENABLE"
          ? "border-emerald-600/30 text-emerald-700 hover:bg-emerald-50"
          : "border-amber-600/30 text-amber-700 hover:bg-amber-50"
      }`}
      onClick={() => setPhase("confirming")}
    >
      {action === "ENABLE" ? t.enable : t.pause}
    </button>
  );
}
