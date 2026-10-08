import Link from "next/link";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { EntityPageHeader, ErrorState } from "@/components/entities/ui";
import { AnalysisReport } from "@/components/ai/analysis-report";
import { getAnalysisAction } from "@/lib/api/ai-actions";

export const dynamic = "force-dynamic";

/** Full view of one saved AI analysis. */
export default async function AiAnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  const { id } = await params;

  const res = await getAnalysisAction(id);
  if (!res.ok) {
    return (
      <div>
        <EntityPageHeader
          title={t.ai.analyze.report.title}
          description={t.ai.analyze.title}
        />
        <ErrorState title={t.common.error.title} message={res.error} />
        <p className="mt-4">
          <Link href="/ai/analyze" className="underline underline-offset-2">
            {t.ai.detail.back}
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-4">
        <Link
          href="/ai/analyze"
          className="text-sm text-ink/60 underline underline-offset-2 hover:text-ink"
        >
          ← {t.ai.detail.back}
        </Link>
      </p>
      <AnalysisReport analysis={res.data} />
    </div>
  );
}
