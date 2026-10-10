"use client";

/**
 * Offer 列表"测试止损"单元格（第七批）：已花/止损线进度条。
 * 懒加载 GET /api/v1/offers/:id/test-spend；无止损配置或无花费数据时显示"—"。
 */
import { useEffect, useState } from "react";
import {
  getTestSpendAction,
  type TestSpendData,
} from "@/lib/api/kill-switch-actions";

export interface TestSpendCellDict {
  column: string;
  spent: string;
  noData: string;
}

export function TestSpendCell({
  offerId,
  dict,
}: {
  offerId: string;
  dict: TestSpendCellDict;
}) {
  const [data, setData] = useState<TestSpendData | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getTestSpendAction(offerId).then((res) => {
      if (cancelled) return;
      if (res.ok) setData(res.data);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
    };
  }, [offerId]);

  if (!loaded) {
    return <span className="text-xs text-ink/40">…</span>;
  }
  const cap = data?.testSpendCap;
  const spend = data?.spend;
  if (cap == null || cap <= 0 || spend == null) {
    return <span className="text-ink/40">{dict.noData}</span>;
  }
  const progress = Math.min(100, (spend / cap) * 100);
  return (
    <div className="w-32">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-ink/60">
          {dict.spent} ${spend.toFixed(2)}/${cap.toFixed(0)}
        </span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-ink/10">
        <div
          className={`h-full rounded-full ${progress >= 100 ? "bg-red-500" : "bg-signal"}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
