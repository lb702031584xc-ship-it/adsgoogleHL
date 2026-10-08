"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  createExperimentAction,
  listExperimentsAction,
} from "@/lib/api/experiments-actions";
import type {
  Experiment,
  ExperimentStatus,
  ExperimentVariantType,
} from "@/lib/api/experiments";
import type { ExperimentDict } from "@/i18n/dict/experiment";
import { ExperimentListView } from "./experiment-views";

const inputClass =
  "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink placeholder:text-ink/40";
const primaryClass =
  "rounded-lg bg-ink px-4 py-2 text-sm font-medium text-white hover:bg-ink/90 disabled:opacity-50";

const STATUSES: Array<"" | ExperimentStatus> = [
  "",
  "DRAFT",
  "RUNNING",
  "COMPLETED",
  "CANCELLED",
];

function VariantFields({
  side,
  dict,
  type,
  setType,
  linkId,
  setLinkId,
  label,
  setLabel,
}: {
  side: "A" | "B";
  dict: ExperimentDict;
  type: ExperimentVariantType;
  setType: (v: ExperimentVariantType) => void;
  linkId: string;
  setLinkId: (v: string) => void;
  label: string;
  setLabel: (v: string) => void;
}) {
  return (
    <fieldset className="rounded-lg border border-ink/15 p-3">
      <legend className="px-1 text-sm font-medium text-ink">
        {side === "A" ? dict.form.variantALabel : dict.form.variantBLabel}
      </legend>
      <div className="grid gap-2">
        <label className="text-xs text-ink/60">
          {dict.form.variantTypeLabel}
          <select
            className={inputClass}
            value={type}
            onChange={(e) => setType(e.target.value as ExperimentVariantType)}
          >
            <option value="LANDING_PAGE">{dict.variantType.LANDING_PAGE}</option>
            <option value="DIRECT_LINK">{dict.variantType.DIRECT_LINK}</option>
          </select>
        </label>
        <label className="text-xs text-ink/60">
          {dict.form.trackingLinkLabel}
          <input
            className={`${inputClass} font-mono`}
            value={linkId}
            onChange={(e) => setLinkId(e.target.value)}
            placeholder={dict.form.trackingLinkPlaceholder}
          />
        </label>
        <label className="text-xs text-ink/60">
          {dict.form.labelLabel}
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={dict.form.labelPlaceholder}
          />
        </label>
      </div>
    </fieldset>
  );
}

/** Experiments list + create form. */
export function ExperimentsClient({ dict }: { dict: ExperimentDict }) {
  const router = useRouter();
  const [items, setItems] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"" | ExperimentStatus>("");

  const [showForm, setShowForm] = useState(false);
  const [offerId, setOfferId] = useState("");
  const [name, setName] = useState("");
  const [typeA, setTypeA] = useState<ExperimentVariantType>("LANDING_PAGE");
  const [linkA, setLinkA] = useState("");
  const [labelA, setLabelA] = useState("");
  const [typeB, setTypeB] = useState<ExperimentVariantType>("DIRECT_LINK");
  const [linkB, setLinkB] = useState("");
  const [labelB, setLabelB] = useState("");
  const [splitA, setSplitA] = useState("50");
  const [creating, setCreating] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = async (status: "" | ExperimentStatus) => {
    setLoading(true);
    setError(null);
    const res = await listExperimentsAction(
      status ? { status } : undefined
    );
    if (res.ok) setItems(res.data.items);
    else setError(res.error);
    setLoading(false);
  };

  useEffect(() => {
    load(statusFilter);
  }, [statusFilter]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (
      !offerId.trim() ||
      !name.trim() ||
      !linkA.trim() ||
      !linkB.trim()
    ) {
      setFormError(dict.form.missingField);
      return;
    }
    setCreating(true);
    setFormError(null);
    const res = await createExperimentAction({
      offerId: offerId.trim(),
      name: name.trim(),
      variantA: {
        type: typeA,
        trackingLinkId: linkA.trim(),
        label: labelA.trim() || undefined,
      },
      variantB: {
        type: typeB,
        trackingLinkId: linkB.trim(),
        label: labelB.trim() || undefined,
      },
      trafficSplitA: Number(splitA) || 50,
    });
    setCreating(false);
    if (res.ok) {
      router.push(`/experiments/${res.data.id}`);
    } else {
      setFormError(res.error);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-ink">{dict.list.title}</h1>
          <p className="mt-1 text-sm text-ink/60">{dict.list.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-sm text-ink/60">
            {dict.list.statusFilter}{" "}
            <select
              className="rounded-lg border border-ink/15 bg-white px-2 py-1.5 text-sm"
              value={statusFilter}
              onChange={(e) =>
                setStatusFilter(e.target.value as "" | ExperimentStatus)
              }
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s === "" ? dict.list.all : dict.status[s]}
                </option>
              ))}
            </select>
          </label>
          <button
            className={primaryClass}
            onClick={() => setShowForm((v) => !v)}
          >
            {dict.list.new}
          </button>
        </div>
      </div>

      {showForm && (
        <form
          onSubmit={onCreate}
          className="space-y-3 rounded-lg border border-ink/15 bg-white p-4"
        >
          <p className="text-sm font-semibold text-ink">{dict.form.title}</p>
          <div className="grid gap-2 md:grid-cols-2">
            <label className="text-xs text-ink/60">
              {dict.form.offerIdLabel}
              <input
                className={`${inputClass} font-mono`}
                value={offerId}
                onChange={(e) => setOfferId(e.target.value)}
                placeholder={dict.form.offerIdPlaceholder}
              />
            </label>
            <label className="text-xs text-ink/60">
              {dict.form.nameLabel}
              <input
                className={inputClass}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={dict.form.namePlaceholder}
              />
            </label>
          </div>
          <div className="grid gap-2 md:grid-cols-2">
            <VariantFields
              side="A"
              dict={dict}
              type={typeA}
              setType={setTypeA}
              linkId={linkA}
              setLinkId={setLinkA}
              label={labelA}
              setLabel={setLabelA}
            />
            <VariantFields
              side="B"
              dict={dict}
              type={typeB}
              setType={setTypeB}
              linkId={linkB}
              setLinkId={setLinkB}
              label={labelB}
              setLabel={setLabelB}
            />
          </div>
          <label className="block max-w-xs text-xs text-ink/60">
            {dict.form.splitLabel}
            <input
              className={inputClass}
              type="number"
              min={1}
              max={99}
              value={splitA}
              onChange={(e) => setSplitA(e.target.value)}
            />
          </label>
          {formError && <p className="text-sm text-red-700">{formError}</p>}
          <button type="submit" className={primaryClass} disabled={creating}>
            {creating ? dict.form.creating : dict.form.create}
          </button>
        </form>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-ink/60">…</p>
      ) : error ? (
        <p className="py-10 text-center text-sm text-red-700">{error}</p>
      ) : (
        <ExperimentListView items={items} dict={dict} />
      )}
    </div>
  );
}
