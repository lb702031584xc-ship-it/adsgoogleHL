"use client";

import { dictionaries, type Dict } from "./dictionaries";
import { useI18n } from "./I18nProvider";

/**
 * Dictionary for client components. Falls back to the English dictionary when
 * rendered outside `I18nProvider` (e.g. unit tests that render components in
 * isolation via `renderToStaticMarkup` and assert English copy).
 */
export function useDict(): Dict {
  try {
    return useI18n().t;
  } catch {
    return dictionaries.en;
  }
}
