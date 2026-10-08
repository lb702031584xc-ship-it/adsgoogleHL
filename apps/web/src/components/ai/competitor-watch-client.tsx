"use client";

/**
 * Lander Intel ② — competitor watch UI.
 * Add form (name + url + interval) + watch list + expandable change timeline.
 */
import { useEffect, useState } from "react";
import { useDict } from "@/i18n/use-dict";
import { EntityPageHeader } from "@/components/entities/ui";
import { formatDateTime } from "@/lib/api/entities-config";
import {
  checkCompetitorWatchNowAction,
  createCompetitorWatchAction,
  deleteCompetitorWatchAction,
  listCompetitorWatchChangesAction,
  listCompetitorWatchesAction,
  updateCompetitorWatchAction,
} from "@/lib/api/lander-actions";
import type {
  CompetitorChangeItem,
  CompetitorDiff,
  CompetitorWatch,
} from "@/lib/api/lander";

const INTERVAL_OPTIONS = [
  { seconds: 3600, key: "h1" },
  { seconds: 21600, key: "h6" },
  { seconds: 43200, key: "h12" },
  { seconds: 86400, key: "h24" },
] as const;

function fmtList(values: string[] | null | undefined): string {
  if (!values || values.length === 0) return "—";
  return values.join("， ");
}

function BeforeAfter({
  label,
  before,
  after,
  d,
}: {
  label: string;
  before: string | null;
  after: string;
  d: { before: string; after: string; firstDetection: string };
}) {
  return (
    <div className="rounded-lg bg-ink/[0.03] px-3 py-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-ink/50">
        {label}
      </div>
      {before === null ? (
        <div className="mt-1 text-sm text-ink/70">
          <span className="mr-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {d.firstDetection}
          </span>
          <span className="font-medium text-ink">{after}</span>
        </div>
      ) : (
        <div className="mt-1 grid gap-1 text-sm sm:grid-cols-2">
          <div>
            <span className="text-xs text-ink/50">{d.before}：</span>
            <span className="text-ink/70 line-through decoration-red-300">
              {before || "—"}
            </span>
          </div>
          <div>
            <span className="text-xs text-ink/50">{d.after}：</span>
            <span className="font-medium text-ink">{after}</span>
          </div>
        </div>
      )}
    </div>
  );
}

function DiffView({
  diff,
  dict,
}: {
  diff: CompetitorDiff;
  dict: {
    before: string;
    after: string;
    firstDetection: string;
    fields: {
      title: string;
      price: string;
      cta: string;
      sectionsAdded: string;
      sectionsRemoved: string;
    };
  };
}) {
  const d = {
    before: dict.before,
    after: dict.after,
    firstDetection: dict.firstDetection,
  };
  return (
    <div className="space-y-2">
      {diff.title && (
        <BeforeAfter
          label={dict.fields.title}
          before={diff.title.before}
          after={diff.title.after}
          d={d}
        />
      )}
      {diff.price && (
        <BeforeAfter
          label={dict.fields.price}
          before={diff.price.before ? fmtList(diff.price.before) : null}
          after={fmtList(diff.price.after)}
          d={d}
        />
      )}
      {diff.cta && (
        <BeforeAfter
          label={dict.fields.cta}
          before={diff.cta.before ? fmtList(diff.cta.before) : null}
          after={fmtList(diff.cta.after)}
          d={d}
        />
      )}
      {diff.sectionsAdded && diff.sectionsAdded.length > 0 && (
        <div className="rounded-lg bg-green-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-green-700">
            {dict.fields.sectionsAdded}
          </div>
          <ul className="mt-1 list-inside list-disc text-sm text-ink/80">
            {diff.sectionsAdded.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {diff.sectionsRemoved && diff.sectionsRemoved.length > 0 && (
        <div className="rounded-lg bg-red-50 px-3 py-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            {dict.fields.sectionsRemoved}
          </div>
          <ul className="mt-1 list-inside list-disc text-sm text-ink/80">
            {diff.sectionsRemoved.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function CompetitorWatchClient() {
  const t = useDict();
  const d = t.ai.competitorWatch;

  const [watches, setWatches] = useState<CompetitorWatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [interval, setInterval] = useState<number>(3600);
  const [adding, setAdding] = useState(false);

  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [changes, setChanges] = useState<Record<string, CompetitorChangeItem[]>>(
    {}
  );
  const [timelineError, setTimelineError] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [checkNote, setCheckNote] = useState<Record<string, string>>({});

  const inputClass =
    "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/35 focus:border-signal focus:outline-none";
  const labelClass = "mb-1 block text-sm font-medium text-ink/80";

  async function refresh() {
    const res = await listCompetitorWatchesAction();
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setWatches(res.data.items);
  }

  useEffect(() => {
    (async () => {
      setLoading(true);
      const res = await listCompetitorWatchesAction();
      setLoading(false);
      if (!res.ok) setError(res.error || d.loadFailed);
      else setWatches(res.data.items);
    })();
  }, []);

  function assertHttpUrl(raw: string): boolean {
    try {
      const u = new URL(raw);
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  async function onAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError(d.needName);
      return;
    }
    if (!url.trim()) {
      setError(d.needUrl);
      return;
    }
    if (!assertHttpUrl(url.trim())) {
      setError(d.invalidUrl);
      return;
    }
    setError(null);
    setAdding(true);
    try {
      const res = await createCompetitorWatchAction({
        name: name.trim(),
        url: url.trim(),
        checkInterval: interval,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setName("");
      setUrl("");
      setInterval(3600);
      await refresh();
    } finally {
      setAdding(false);
    }
  }

  async function onToggle(watch: CompetitorWatch) {
    const res = await updateCompetitorWatchAction(watch.id, {
      isActive: !watch.isActive,
    });
    if (!res.ok) setError(res.error);
    else
      setWatches((ws) =>
        ws.map((w) =>
          w.id === watch.id ? { ...w, isActive: !watch.isActive } : w
        )
      );
  }

  async function onDelete(watch: CompetitorWatch) {
    if (!window.confirm(d.confirmDelete)) return;
    const res = await deleteCompetitorWatchAction(watch.id);
    if (!res.ok) setError(res.error);
    else {
      setWatches((ws) => ws.filter((w) => w.id !== watch.id));
      if (expandedId === watch.id) setExpandedId(null);
    }
  }

  async function onToggleTimeline(watch: CompetitorWatch) {
    if (expandedId === watch.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(watch.id);
    setTimelineError(null);
    if (!changes[watch.id]) {
      const res = await listCompetitorWatchChangesAction(watch.id);
      if (!res.ok) setTimelineError(res.error || d.timelineFailed);
      else
        setChanges((c) => ({ ...c, [watch.id]: res.data.items }));
    }
  }

  async function onCheckNow(watch: CompetitorWatch) {
    setCheckingId(watch.id);
    setCheckNote((n) => ({ ...n, [watch.id]: "" }));
    try {
      const res = await checkCompetitorWatchNowAction(watch.id);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const r = res.data;
      if (r.skippedByRobots) {
        setCheckNote((n) => ({ ...n, [watch.id]: d.skippedByRobots }));
      } else if (r.fetchFailed) {
        setCheckNote((n) => ({ ...n, [watch.id]: d.fetchFailedNote }));
      } else if (r.changed) {
        // Reload timeline so the new change shows up.
        const tl = await listCompetitorWatchChangesAction(watch.id);
        if (tl.ok) setChanges((c) => ({ ...c, [watch.id]: tl.data.items }));
        setExpandedId(watch.id);
      }
      await refresh();
    } finally {
      setCheckingId(null);
    }
  }

  return (
    <div>
      <EntityPageHeader title={d.title} description={d.description} />

      {/* Add form */}
      <form
        onSubmit={onAdd}
        className="mt-6 rounded-xl border border-ink/10 bg-white/70 p-5"
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{d.form.nameLabel}</label>
            <input
              type="text"
              className={inputClass}
              placeholder={d.form.namePlaceholder}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>{d.form.urlLabel}</label>
            <input
              type="text"
              className={inputClass}
              placeholder={d.form.urlPlaceholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className={labelClass}>{d.form.intervalLabel}</label>
            <select
              className={inputClass}
              value={interval}
              onChange={(e) => setInterval(Number(e.target.value))}
            >
              {INTERVAL_OPTIONS.map((o) => (
                <option key={o.key} value={o.seconds}>
                  {d.form.intervals[o.key]}
                </option>
              ))}
            </select>
          </div>
          <button
            type="submit"
            disabled={adding}
            className="rounded-lg bg-signal px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {adding ? d.form.adding : d.form.add}
          </button>
        </div>
      </form>

      {error && (
        <div className="mt-4 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Watch list */}
      <div className="mt-6 space-y-4">
        {loading ? (
          <div className="rounded-xl border border-ink/10 bg-white p-5 text-sm text-ink/60">
            …
          </div>
        ) : watches.length === 0 ? (
          <div className="rounded-xl border border-ink/10 bg-white p-5 text-sm text-ink/60">
            {d.noWatches}
          </div>
        ) : (
          watches.map((w) => (
            <div
              key={w.id}
              className="rounded-xl border border-ink/10 bg-white p-5"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-ink">{w.name}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        w.isActive
                          ? "bg-green-100 text-green-800"
                          : "bg-ink/10 text-ink/60"
                      }`}
                    >
                      {w.isActive ? d.active : d.paused}
                    </span>
                    <span className="rounded-full bg-ink/10 px-2 py-0.5 text-xs font-medium text-ink/60">
                      {w.changeCount} {d.changes}
                    </span>
                  </div>
                  <div className="mt-1 break-all text-sm text-ink/60">
                    {w.url}
                  </div>
                  <div className="mt-1 text-xs text-ink/50">
                    {d.lastChecked}：
                    {w.lastCheckedAt
                      ? formatDateTime(w.lastCheckedAt)
                      : d.neverChecked}
                  </div>
                  {checkNote[w.id] && (
                    <div className="mt-1 text-xs text-amber-700">
                      {checkNote[w.id]}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => onCheckNow(w)}
                    disabled={checkingId === w.id}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-ink/5 disabled:opacity-50"
                  >
                    {checkingId === w.id ? d.checking : d.checkNow}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggleTimeline(w)}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-ink/5"
                  >
                    {expandedId === w.id ? d.hideTimeline : d.viewTimeline}
                  </button>
                  <button
                    type="button"
                    onClick={() => onToggle(w)}
                    className="rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-ink/5"
                  >
                    {w.isActive ? d.paused : d.active}
                  </button>
                  <button
                    type="button"
                    onClick={() => onDelete(w)}
                    className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50"
                  >
                    {d.delete}
                  </button>
                </div>
              </div>

              {expandedId === w.id && (
                <div className="mt-4 border-t border-ink/10 pt-4">
                  {timelineError ? (
                    <div className="text-sm text-red-600">{timelineError}</div>
                  ) : !changes[w.id] ? (
                    <div className="text-sm text-ink/60">…</div>
                  ) : changes[w.id].length === 0 ? (
                    <div className="text-sm text-ink/60">{d.noChanges}</div>
                  ) : (
                    <div className="space-y-4">
                      {changes[w.id].map((c) => (
                        <div key={c.id}>
                          <div className="mb-2 text-xs font-medium text-ink/50">
                            {d.changedAt}：
                            {c.changedAt
                              ? formatDateTime(c.changedAt)
                              : "—"}
                          </div>
                          <DiffView diff={c.diffSummary} dict={d} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
