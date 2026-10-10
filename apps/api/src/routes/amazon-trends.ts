/**
 * 热销日历（Amazon 选品赛道 /amazon/trends 用）。
 *
 * - GET  /api/v1/amazon/trends/calendar?country=US
 *   节日时间线：纯代码数据（apps/api/src/trends/holidays.ts），无外部调用。
 * - POST /api/v1/amazon/trends/recommend  body { country }
 *   AI 热销品类推荐：走现有 LLM（DeepSeek/OpenAI 兼容）链路，不新增 key；
 *   结果 Redis 缓存 7 天（key 含 country + 年月）；LLM 不可用时 503 + 明确文案，绝不编数据。
 *
 * 两个接口都要 session 认证（tenant 隔离靠 session；日历数据本身是公开的内置数据）。
 * recommend 按 tenant 限流 20 次/分钟（Redis；不可用时 fail-open）。
 */
import { Redis } from "ioredis";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { AppError, UnauthorizedError, ValidationError } from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import {
  COUNTRIES,
  COUNTRY_NAMES,
  getNowHotCategories,
  getUpcomingHolidays,
  isCountryCode,
  type CountryCode,
} from "../trends/holidays.js";
import {
  assertAiSettingsPepperConfigured,
  decryptSecret,
} from "../ai/crypto.js";
import { AiError, chatJson, chatJsonValidated } from "../ai/llm.js";

interface Deps {
  prisma: PrismaClient;
  /** 注入式 Redis（测试用）；生产缺省时按需懒建共享连接。 */
  redis?: CacheRedis;
  /** Injectable for tests. */
  chatJsonImpl?: typeof chatJson;
}

/** 缓存/限流用 Redis 最小接口。 */
export interface CacheRedis {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ...args: unknown[]): Promise<unknown>;
}

async function requireSession(
  deps: Deps,
  request: FastifyRequest
): Promise<SessionAuthInfo> {
  const info =
    request.sessionAuth ??
    (await authenticateSessionRequest(deps.prisma, request));
  if (!info) {
    throw new UnauthorizedError("Authentication required");
  }
  return info;
}

/* ------------------------------------------------------------------ */
/* 共享 Redis（懒建；失败 fail-open），与 traffic.ts 相同策略。          */
/* ------------------------------------------------------------------ */
let sharedRedis: Redis | null = null;
let sharedRedisBroken = false;

function getSharedRedis(): Redis | null {
  if (sharedRedisBroken) return null;
  if (sharedRedis) return sharedRedis;
  try {
    const client = new Redis(
      process.env.REDIS_URL ?? "redis://localhost:6379",
      {
        lazyConnect: true,
        enableOfflineQueue: false,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
      }
    );
    client.on("error", () => undefined);
    sharedRedis = client;
    return client;
  } catch {
    sharedRedisBroken = true;
    return null;
  }
}

function minuteStamp(now: Date = new Date()): string {
  return now.toISOString().slice(0, 16).replace(/[-T:]/g, "");
}

async function checkRateLimit(
  redis: CacheRedis | undefined,
  tenantId: string
): Promise<boolean> {
  const client = redis ?? getSharedRedis();
  if (!client) return true;
  try {
    const key = `amazon-trends:ratelimit:${tenantId}:${minuteStamp()}`;
    const count = await client.incr(key);
    if (count === 1) {
      try {
        await client.expire(key, 120);
      } catch {
        // 忽略
      }
    }
    return count <= 20;
  } catch {
    return true; // fail-open
  }
}

/* ------------------------------------------------------------------ */
/* LLM 设置读取（复用 AI 设置里的 DeepSeek/OpenAI 兼容配置，不新增 key） */
/* ------------------------------------------------------------------ */

interface LlmSettings {
  baseUrl?: string;
  model?: string;
  apiKeyEnc?: string;
}

async function readLlmSettings(prisma: PrismaClient): Promise<LlmSettings> {
  const rows = await prisma.aiSetting.findMany();
  const out: LlmSettings = {};
  for (const r of rows as Array<{ key: string; value: string }>) {
    if (r.key === "llm.baseUrl") out.baseUrl = r.value;
    else if (r.key === "llm.model") out.model = r.value;
    else if (r.key === "llm.apiKeyEnc") out.apiKeyEnc = r.value;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* AI 推荐：prompt + 形状校验                                            */
/* ------------------------------------------------------------------ */

export interface RecommendCategory {
  /** 品类名 */
  name: string;
  /** 具体商品举例 */
  examples: string[];
  /** 推荐理由 */
  reason: string;
  /** 建议关键词（2-4 个） */
  keywords: string[];
  /** 广告角度一句话 */
  adAngle: string;
}

function validateRecommendShape(raw: unknown): { categories: RecommendCategory[] } {
  const o = raw as Record<string, unknown>;
  if (!o || !Array.isArray(o.categories)) {
    throw new AiError("LLM 返回形状非法：缺少 categories 数组");
  }
  const categories = (o.categories as unknown[]).map((c, i) => {
    const cc = c as Record<string, unknown>;
    const strArr = (v: unknown, name: string): string[] => {
      if (!Array.isArray(v) || v.some((x) => typeof x !== "string" || !x.trim())) {
        throw new AiError(`LLM 返回形状非法：categories[${i}].${name} 必须是非空字符串数组`);
      }
      return (v as string[]).map((x) => x.trim());
    };
    const str = (v: unknown, name: string): string => {
      if (typeof v !== "string" || !v.trim()) {
        throw new AiError(`LLM 返回形状非法：categories[${i}].${name} 必须是非空字符串`);
      }
      return v.trim();
    };
    const keywords = strArr(cc.keywords, "keywords");
    if (keywords.length < 2 || keywords.length > 4) {
      throw new AiError(`LLM 返回形状非法：categories[${i}].keywords 需要 2-4 个`);
    }
    return {
      name: str(cc.name, "name"),
      examples: strArr(cc.examples, "examples"),
      reason: str(cc.reason, "reason"),
      keywords,
      adAngle: str(cc.adAngle, "adAngle"),
    };
  });
  if (categories.length < 3 || categories.length > 8) {
    throw new AiError("LLM 返回形状非法：categories 需要 3-8 个");
  }
  return { categories };
}

function buildRecommendPrompt(
  country: CountryCode,
  now: Date,
  upcoming: { nameZh: string; nameEn: string; date: string; daysLeft: number }[]
): { system: string; user: string } {
  const cn = COUNTRY_NAMES[country];
  const dateStr = now.toISOString().slice(0, 10);
  const holidayLines =
    upcoming.length > 0
      ? upcoming
          .map((h) => `- ${h.nameZh} / ${h.nameEn}：${h.date}（还有 ${h.daysLeft} 天）`)
          .join("\n")
      : "（未来 90 天无主要购物节）";
  return {
    system:
      "你是 Amazon 选品顾问。只返回严格 JSON 对象，不要 markdown 代码围栏、不要解释文字。",
    user:
      `今天是 ${dateStr}。用户在 Amazon ${cn.zh}（${cn.en}）站点做选品。\n` +
      `未来 90 天的主要购物节：\n${holidayLines}\n\n` +
      `请结合当前季节与临近节日，推荐 3-8 个当下值得做的热销品类。\n` +
      `严格按以下 JSON 形状返回：\n` +
      `{"categories": [{"name": "品类名", "examples": ["具体商品举例1", "具体商品举例2"], "reason": "推荐理由（结合季节/节日）", "keywords": ["关键词1", "关键词2"], "adAngle": "广告角度一句话"}]}\n` +
      `要求：keywords 每个品类 2-4 个（英文关键词，适合 Amazon 站内搜索）；examples 具体到商品形态；reason 说明为什么现在热销；adAngle 一句话广告切入点。`,
  };
}

const RECOMMEND_CACHE_TTL_SECONDS = 7 * 24 * 3600;

function recommendCacheKey(country: CountryCode, now: Date): string {
  const ym = now.toISOString().slice(0, 7); // YYYY-MM
  return `amazon-trends:recommend:${country}:${ym}`;
}

/* ------------------------------------------------------------------ */
/* 路由注册                                                             */
/* ------------------------------------------------------------------ */

export async function registerAmazonTrendsRoutes(
  app: FastifyInstance,
  deps: Deps
): Promise<void> {
  const { prisma } = deps;

  /**
   * 节日日历：未来 90 天购物节时间线 + 现在热销品类。
   * 纯代码数据，无外部调用。
   */
  app.get<{
    Querystring: { country?: string };
  }>("/api/v1/amazon/trends/calendar", async (request) => {
    await requireSession(deps, request);
    const country = (request.query.country ?? "US").toUpperCase();
    if (!isCountryCode(country)) {
      throw new ValidationError(
        `country 非法，支持：${COUNTRIES.join(" / ")}`
      );
    }
    const now = new Date();
    return {
      country,
      countryName: COUNTRY_NAMES[country],
      now: {
        date: now.toISOString().slice(0, 10),
        hotCategories: getNowHotCategories(country, now),
      },
      upcoming: getUpcomingHolidays(country, now, 90),
    };
  });

  /**
   * AI 热销推荐：LLM 生成 3-8 个品类。Redis 缓存 7 天（key 含 country+年月）。
   * LLM 未配置或调用失败 → 503 + 明确文案，绝不编造数据。
   */
  app.post<{
    Body: { country?: unknown };
  }>("/api/v1/amazon/trends/recommend", async (request) => {
    const info = await requireSession(deps, request);
    const countryRaw = request.body?.country ?? "US";
    const country =
      typeof countryRaw === "string" ? countryRaw.toUpperCase() : "";
    if (!isCountryCode(country)) {
      throw new ValidationError(
        `country 非法，支持：${COUNTRIES.join(" / ")}`
      );
    }

    const allowed = await checkRateLimit(deps.redis, info.tenantId);
    if (!allowed) {
      throw new AppError("AI 推荐请求频率超限（20 次/分钟），请稍后再试", {
        code: "RATE_LIMITED",
        statusCode: 429,
      });
    }

    const now = new Date();
    const cacheKey = recommendCacheKey(country, now);
    const client = deps.redis ?? getSharedRedis();
    if (client) {
      try {
        const hit = await client.get(cacheKey);
        if (hit) {
          return { ...JSON.parse(hit), cached: true };
        }
      } catch {
        // 缓存失败不阻塞
      }
    }

    const settings = await readLlmSettings(prisma);
    if (!settings.baseUrl || !settings.model || !settings.apiKeyEnc) {
      throw new AppError(
        "AI 推荐不可用：LLM 未配置。请在“系统设置 → AI 设置”中配置 DeepSeek/OpenAI 兼容的 baseUrl、model 与 API Key 后再试。",
        { code: "LLM_NOT_CONFIGURED", statusCode: 503 }
      );
    }
    const pepper = assertAiSettingsPepperConfigured();
    const apiKey = decryptSecret(settings.apiKeyEnc, pepper);

    const upcoming = getUpcomingHolidays(country, now, 90);
    const { system, user } = buildRecommendPrompt(
      country,
      now,
      upcoming.map((h) => ({
        nameZh: h.nameZh,
        nameEn: h.nameEn,
        date: h.date,
        daysLeft: h.daysLeft,
      }))
    );

    let result: { categories: RecommendCategory[] };
    try {
      result = await chatJsonValidated(
        {
          baseUrl: settings.baseUrl,
          model: settings.model,
          apiKey,
          system,
          user,
        },
        validateRecommendShape,
        deps.chatJsonImpl ?? chatJson
      );
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError(
        "AI 推荐生成失败（LLM 调用异常），请稍后再试。本次未返回任何推荐数据。",
        { code: "LLM_FAILED", statusCode: 503 }
      );
    }

    const payload = {
      country,
      countryName: COUNTRY_NAMES[country],
      date: now.toISOString().slice(0, 10),
      categories: result.categories,
      cached: false,
    };
    if (client) {
      try {
        await client.set(
          cacheKey,
          JSON.stringify(payload),
          "EX",
          RECOMMEND_CACHE_TTL_SECONDS
        );
      } catch {
        // 缓存写入失败不阻塞
      }
    }
    return payload;
  });
}
