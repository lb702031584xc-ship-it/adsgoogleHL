import type { ReactNode } from "react";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { LangSwitcher } from "@/components/lang-switcher";

/** Minimal centered layout for public auth pages (no sidebar). */
export default async function AuthLayout({
  children,
}: {
  children: ReactNode;
}) {
  const lang = await getLang();
  const t = getDictionary(lang);
  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <p className="font-display text-3xl tracking-tight text-ink">
            AdLinkLab
          </p>
          <p className="mt-1 text-sm text-ink/50">
            {t.common.brand.phase("Phase 8.4.7")}
          </p>
        </div>
        <div className="rounded-2xl border border-ink/10 bg-white/80 p-8 shadow-sm backdrop-blur">
          {children}
        </div>
        <div className="mt-6 flex justify-center">
          <LangSwitcher tone="light" />
        </div>
      </div>
    </div>
  );
}
