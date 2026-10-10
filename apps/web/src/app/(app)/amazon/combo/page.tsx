import { getLang } from "@/i18n/lang";
import { zh, en } from "@/i18n/dict/amazon-combo";
import { ComboListClient } from "@/components/amazon/combo-list-client";

export const dynamic = "force-dynamic";

/**
 * 组合测试（第九批）：以测代选，一次测 5-10 个品。
 */
export default async function AmazonComboPage() {
  const lang = await getLang();
  const d = lang === "en" ? en : zh;
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-ink/10 bg-white p-5">
        <h1 className="text-xl font-semibold text-ink">{d.title}</h1>
        <p className="mt-1 text-sm text-ink/60">{d.description}</p>
      </section>
      <ComboListClient dict={d} />
    </div>
  );
}
