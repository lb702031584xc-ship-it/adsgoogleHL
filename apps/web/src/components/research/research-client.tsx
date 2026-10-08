"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { listResearchTestsAction } from "@/lib/api/research";
import type { ResearchTestSummary } from "@/lib/api/research";
import type { ResearchDict } from "@/i18n/dict/research";
import { ResearchBanner, ResearchListView } from "./research-views";

const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";

/** Research test list: /research */
export function ResearchListClient({ dict }: { dict: ResearchDict }) {
  const [items, setItems] = useState<ResearchTestSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      const res = await listResearchTestsAction();
      if (res.ok) setItems(res.data.items);
      else setError(res.error);
      setLoading(false);
    })();
  }, []);

  return (
    <div className="space-y-6">
      <ResearchBanner dict={dict} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{dict.list.title}</h1>
          <p className="mt-1 text-sm text-ink/60">{dict.list.description}</p>
        </div>
        <Link href="/research/new" className={primaryClass}>
          {dict.list.new}
        </Link>
      </div>

      {loading && <p className="text-sm text-ink/50">…</p>}
      {error && <p className="text-sm text-red-700">{error}</p>}
      {!loading && !error && (
        <ResearchListView
          items={items}
          dict={dict}
          hrefFor={(id) => `/research/${id}`}
        />
      )}
    </div>
  );
}
