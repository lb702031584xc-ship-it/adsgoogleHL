import { OptimizationQueueClient } from "@/components/landing-pages/optimization-queue-client";

export const dynamic = "force-dynamic";

/** 落地页优化队列：分析器低分结果 → 任务卡片，按优先级排序逐个修复。 */
export default async function LpOptimizationQueuePage() {
  return <OptimizationQueueClient />;
}
