import { TermsWatchClient } from "@/components/cashback/terms-watch-client";

export const dynamic = "force-dynamic";

/** 功能 2 — 商家返利条款监控：列表 + 新增表单 + 手动立即检查。 */
export default async function TermsWatchPage() {
  return <TermsWatchClient />;
}
