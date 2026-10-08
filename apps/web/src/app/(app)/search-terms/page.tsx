import { SearchTermsClient } from "@/components/search-terms/search-terms-client";

export const dynamic = "force-dynamic";

/** 自动化套件 2/5 — 搜索词自动否词：粘贴报告 → AI 分析 → 应用/忽略建议。 */
export default async function SearchTermsPage() {
  return <SearchTermsClient />;
}
