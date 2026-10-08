import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";

export async function PageShell({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const t = getDictionary(await getLang());
  return (
    <section className="max-w-4xl">
      <p className="text-sm font-semibold uppercase tracking-[0.14em] text-signal">
        AdLinkLab
      </p>
      <h1 className="mt-2 font-display text-4xl font-semibold tracking-tight text-ink">
        {title}
      </h1>
      <p className="mt-3 max-w-2xl text-lg text-ink/70">{description}</p>
      <div className="mt-8 rounded-xl border border-ink/10 bg-white/70 p-6 shadow-sm backdrop-blur">
        <p className="text-sm font-semibold text-ink">{t.ops.pageShell.skeletonTitle}</p>
        <p className="mt-2 text-sm text-ink/65">
          {t.ops.pageShell.skeletonBody}
        </p>
      </div>
    </section>
  );
}
