import { cookies } from "next/headers";
import {
  DEFAULT_LANG,
  LANG_COOKIE,
  type Lang,
} from "./dictionaries";

/** Resolve the current language from the `adlinklab-lang` cookie (server-only). */
export async function getLang(): Promise<Lang> {
  try {
    const store = await cookies();
    return store.get(LANG_COOKIE)?.value === "en" ? "en" : DEFAULT_LANG;
  } catch {
    return DEFAULT_LANG;
  }
}
