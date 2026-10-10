/**
 * Keepa 截图 AI 看图判断（Day5 手动逐个核查的升级）。
 *
 * OCR 读不出 Keepa 曲线趋势，所以走 vision LLM 看图：用户上传
 * Keepa 价格历史（90 天）/ Sales Rank（90 天）截图，模型按规则判
 * pass / kill / unknown。信息不足时绝不硬判。
 *
 * 是否支持 vision 取决于用户配置的模型（DeepSeek 等不一定支持），
 * 不支持时 provider 会报错，由 isVisionUnsupportedError 识别，
 * 调用方转成明确的 400 指引。
 */
import {
  AiError,
  chatJsonValidated,
  chatJsonVision,
  type ChatJsonVisionArgs,
} from "../ai/llm.js";

export interface KeepaVisionImage {
  kind: "price" | "rank";
  /** data URL：data:image/{jpeg|png|webp};base64,... */
  dataUrl: string;
}

export type KeepaVisionVerdict = "pass" | "kill" | "unknown";

export interface KeepaVisionJudgment {
  verdict: KeepaVisionVerdict;
  reasons: string[];
  metrics: {
    /** 30 天跌幅百分比（估算）；看不出填 null */
    priceDrop30dPct: number | null;
    /** 排名是否稳定；看不出填 null */
    rankStable: boolean | null;
    /** 模型自评把握度 */
    confidence: "high" | "medium" | "low";
  };
}

const SYSTEM_PROMPT = `你是电商选品风控助手。用户会给你 Keepa 商品数据截图做选品判断。

截图可能是以下两种（按用户说明区分）：
- 价格历史图：Keepa 的 Amazon 价格 / New 价格曲线，时间范围约 90 天
- Sales Rank 图：类目排名曲线，时间范围约 90 天

判断规则（与人工核查标准对齐）：
- kill（淘汰）：30 天内价格跌幅超过 25%（利润守不住）；或排名大起大落（90 天内最高/最低排名悬殊，如相差 10 倍以上，多半是刷单或短期促销）
- pass（通过）：价格曲线过去 90 天平稳、没有频繁跳水，且排名长期稳定
- unknown（无法判断）：图片模糊看不清曲线、只有一张图信息不全、截图不是 Keepa 图表、或任何信息不足的情况。**信息不足时必须判 unknown，绝不硬判、绝不编数字**

输出要求：只返回 STRICT JSON 对象，不要 markdown 代码围栏，不要解释文字：
{
  "verdict": "pass" | "kill" | "unknown",
  "reasons": ["中文原因1", "中文原因2"],
  "metrics": {
    "priceDrop30dPct": 数字或null,
    "rankStable": true/false/null,
    "confidence": "high" | "medium" | "low"
  }
}
reasons 用中文写，每条一句话，说清依据（如"近30天价格从 $X 跌到 $Y，跌幅约 Z%"）。`;

function buildUserText(images: KeepaVisionImage[], asin?: string): string {
  const parts: string[] = [];
  if (asin) parts.push(`ASIN：${asin}`);
  images.forEach((img, i) => {
    parts.push(
      img.kind === "price"
        ? `图${i + 1}：Keepa 价格历史截图（约 90 天范围）。`
        : `图${i + 1}：Keepa Sales Rank 排名曲线截图（约 90 天范围）。`
    );
  });
  if (images.length === 1) {
    parts.push("注意：只有一张截图，另一种图表缺失，信息可能不足。");
  }
  parts.push("请按规则判断并只返回 STRICT JSON。");
  return parts.join("\n");
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 校验模型输出形状；形状不对时抛错（chatJsonValidated 会重试一次）。 */
export function validateVisionShape(obj: unknown): KeepaVisionJudgment {
  if (!isRecord(obj)) throw new AiError("vision judgment must be an object");
  const { verdict, reasons, metrics } = obj;
  if (verdict !== "pass" && verdict !== "kill" && verdict !== "unknown") {
    throw new AiError("vision judgment.verdict invalid");
  }
  if (!Array.isArray(reasons) || reasons.some((r) => typeof r !== "string")) {
    throw new AiError("vision judgment.reasons must be string[]");
  }
  if (!isRecord(metrics)) throw new AiError("vision judgment.metrics invalid");
  const { priceDrop30dPct, rankStable, confidence } = metrics;
  if (
    priceDrop30dPct !== null &&
    (typeof priceDrop30dPct !== "number" || !Number.isFinite(priceDrop30dPct))
  ) {
    throw new AiError("vision judgment.metrics.priceDrop30dPct invalid");
  }
  if (rankStable !== null && typeof rankStable !== "boolean") {
    throw new AiError("vision judgment.metrics.rankStable invalid");
  }
  if (confidence !== "high" && confidence !== "medium" && confidence !== "low") {
    throw new AiError("vision judgment.metrics.confidence invalid");
  }
  return {
    verdict,
    reasons: reasons as string[],
    metrics: {
      priceDrop30dPct,
      rankStable,
      confidence: confidence as "high" | "medium" | "low",
    },
  };
}

/**
 * 识别"模型不支持 vision"类 provider 错误。
 * 各家报错文案不同（image input not supported / vision not available /
 * invalid content type 等），按关键词组合判断，避免误伤普通报错。
 */
export function isVisionUnsupportedError(e: unknown): boolean {
  if (!(e instanceof AiError)) return false;
  const msg = e.message.toLowerCase();
  const mentionsImage = /image|vision|multimodal|image_url/.test(msg);
  const denies =
    /not supported|unsupported|not available|does not support|invalid|rejected|not allowed/.test(
      msg
    );
  return mentionsImage && denies;
}

export interface VisionLlmConfig {
  baseUrl: string;
  model: string;
  apiKey: string;
}

/**
 * 对 Keepa 截图做 AI 看图判断。
 * images 至少 1 张（price/rank 各至多 1 张，由调用方保证）。
 */
export async function judgeKeepaScreenshots(
  images: KeepaVisionImage[],
  llm: VisionLlmConfig,
  opts: { asin?: string; impl?: typeof chatJsonVision } = {}
): Promise<KeepaVisionJudgment> {
  if (images.length === 0) {
    throw new AiError("至少需要一张 Keepa 截图");
  }
  const args: ChatJsonVisionArgs = {
    baseUrl: llm.baseUrl,
    model: llm.model,
    apiKey: llm.apiKey,
    system: SYSTEM_PROMPT,
    user: buildUserText(images, opts.asin),
    images: images.map((i) => i.dataUrl),
  };
  return chatJsonValidated<KeepaVisionJudgment, ChatJsonVisionArgs>(
    args,
    validateVisionShape,
    opts.impl ?? chatJsonVision
  );
}
