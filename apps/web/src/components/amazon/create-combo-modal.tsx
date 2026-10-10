"use client";

/**
 * 生成组合测试页弹窗（第九批）：5-10 个候选品 → 榜单页 + 各自跟踪链接。
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  createComboTestAction,
  type ComboTestProductInput,
} from "@/lib/api/combo-actions";

export interface CreateComboDict {
  title: string;
  nameLabel: string;
  namePlaceholder: string;
  testDaysLabel: string;
  targetClicksLabel: string;
  create: string;
  creating: string;
  cancel: string;
  itemsCount: string;
  methodTitle: string;
  methodBody: string;
}

export function CreateComboModal({
  dict: d,
  items,
  onClose,
}: {
  dict: CreateComboDict;
  items: ComboTestProductInput[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [testDays, setTestDays] = useState("3");
  const [targetClicks, setTargetClicks] = useState("200");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onCreate() {
    setCreating(true);
    setError(null);
    const res = await createComboTestAction({
      items,
      name: name.trim() || undefined,
      testDays: parseInt(testDays) || undefined,
      targetClicks: parseInt(targetClicks) || undefined,
    });
    setCreating(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    router.push(`/amazon/combo/${res.data.runId}`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-lg rounded-xl bg-white p-6">
        <h3 className="text-lg font-semibold text-ink">{d.title}</h3>
        <p className="mt-1 text-sm text-ink/60">
          {d.itemsCount}：{items.length}
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">{d.nameLabel}</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={d.namePlaceholder}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">
                {d.testDaysLabel}
              </label>
              <input
                inputMode="numeric"
                value={testDays}
                onChange={(e) => setTestDays(e.target.value)}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">
                {d.targetClicksLabel}
              </label>
              <input
                inputMode="numeric"
                value={targetClicks}
                onChange={(e) => setTargetClicks(e.target.value)}
                className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-lg bg-ink/[0.03] p-3">
          <p className="text-sm font-medium text-ink">{d.methodTitle}</p>
          <p className="mt-1 text-xs leading-relaxed text-ink/60">{d.methodBody}</p>
        </div>

        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={creating}
            className="rounded-lg border border-ink/15 px-4 py-2 text-sm text-ink/70"
          >
            {d.cancel}
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-medium text-paper disabled:opacity-50"
          >
            {creating ? d.creating : d.create}
          </button>
        </div>
      </div>
    </div>
  );
}
