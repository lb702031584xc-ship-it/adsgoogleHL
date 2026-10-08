"use client";

import { useI18n } from "@/i18n/I18nProvider";
import type { Lang } from "@/i18n/dictionaries";

export function LangSwitcher({ tone = "dark" }: { tone?: "dark" | "light" }) {
  const { lang, setLang } = useI18n();

  const btn = (l: Lang) => {
    const active = lang === l;
    if (tone === "dark") {
      return `rounded-md px-2.5 py-1 text-xs font-medium transition ${
        active
          ? "bg-white/20 text-white"
          : "text-mist/60 hover:bg-white/5 hover:text-white"
      }`;
    }
    return `rounded-md px-2.5 py-1 text-xs font-medium transition ${
      active ? "bg-ink text-paper" : "text-ink/50 hover:bg-ink/5 hover:text-ink"
    }`;
  };

  return (
    <div
      className={`inline-flex items-center gap-1 rounded-lg p-1 ${
        tone === "dark" ? "bg-white/5" : "bg-ink/5"
      }`}
      role="group"
      aria-label="Language / 语言"
    >
      <button type="button" onClick={() => setLang("zh")} className={btn("zh")}>
        中文
      </button>
      <button type="button" onClick={() => setLang("en")} className={btn("en")}>
        EN
      </button>
    </div>
  );
}
