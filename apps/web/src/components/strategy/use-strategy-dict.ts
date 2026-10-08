"use client";

import { useDict } from "@/i18n/use-dict";
import { useI18n } from "@/i18n/I18nProvider";
import { en, zh, type StrategyDict } from "@/i18n/dict/strategy";

/** UI language, safe outside I18nProvider (isolated test renders). */
function useUiLang(): "zh" | "en" {
  try {
    return useI18n().lang;
  } catch {
    return "en";
  }
}

/**
 * `t.strategy.*` once the coordinator registers the strategy dict in
 * dictionaries.ts; until then, degrade gracefully to this feature's own
 * standalone dict in the current UI language.
 */
export function useStrategyDict(): StrategyDict {
  const t = useDict();
  const lang = useUiLang();
  const fromAggregate = (t as unknown as { strategy?: StrategyDict }).strategy;
  return fromAggregate ?? (lang === "en" ? en : zh);
}
