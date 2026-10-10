/**
 * 新手任务 API（第十二批）。
 *
 * - GET  /api/v1/onboard/tasks — 7 天任务列表（自动检测 + 手动标记合并）
 * - POST /api/v1/onboard/tasks/:key/done — 手动标记完成
 * - POST /api/v1/onboard/tasks/:key/undone — 取消标记
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import {
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";
import {
  authenticateSessionRequest,
  type SessionAuthInfo,
} from "../auth/sessions.js";
import { ONBOARD_TASKS, detectTaskCompletion } from "../onboard/tasks.js";
import { checkSiteReadiness } from "../onboard/site-check.js";

interface Deps {
  prisma: PrismaClient;
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

export function registerOnboardRoutes(
  app: FastifyInstance,
  deps: Deps
): void {
  const { prisma } = deps;
  // 网站就绪检查限流：10 次/分钟/tenant（内存）
  const siteCheckHits = new Map<string, number[]>();
  app.get("/api/v1/onboard/tasks", async (request) => {
    const info = await requireSession(deps, request);
    const [auto, manual] = await Promise.all([
      detectTaskCompletion(prisma, info.tenantId),
      prisma.onboardTask.findMany({
        where: { tenantId: info.tenantId },
        select: { taskKey: true, doneAt: true },
      }) as Promise<Array<{ taskKey: string; doneAt: Date | null }>>,
    ]);
    const manualMap = new Map(manual.map((m) => [m.taskKey, m.doneAt]));
    const items = ONBOARD_TASKS.map((t) => {
      const doneAt = manualMap.get(t.key) ?? null;
      const autoDone = t.autoCheck ? (auto[t.key] ?? false) : false;
      return {
        day: t.day,
        key: t.key,
        deepLink: t.deepLink,
        done: !!doneAt || autoDone,
        autoDetected: autoDone && !doneAt,
        manual: !!doneAt,
        doneAt: doneAt ? new Date(doneAt).toISOString() : null,
      };
    });
    const doneCount = items.filter((i) => i.done).length;
    return {
      items,
      doneCount,
      total: items.length,
      graduated: items.some((i) => i.key === "first_click" && i.done),
    };
  });

  /** POST 手动标记完成 */
  app.post<{
    Params: { key: string };
  }>("/api/v1/onboard/tasks/:key/done", async (request) => {
    const info = await requireSession(deps, request);
    const def = ONBOARD_TASKS.find((t) => t.key === request.params.key);
    if (!def) throw new NotFoundError("OnboardTask", request.params.key);
    await prisma.onboardTask.upsert({
      where: { tenantId_taskKey: { tenantId: info.tenantId, taskKey: def.key } },
      update: { doneAt: new Date(), deepLink: def.deepLink, day: def.day },
      create: {
        id: randomUUID(),
        tenantId: info.tenantId,
        day: def.day,
        taskKey: def.key,
        deepLink: def.deepLink,
        doneAt: new Date(),
      },
    });
    return { done: true };
  });

  /** POST 取消标记 */
  app.post<{
    Params: { key: string };
  }>("/api/v1/onboard/tasks/:key/undone", async (request) => {
    const info = await requireSession(deps, request);
    const def = ONBOARD_TASKS.find((t) => t.key === request.params.key);
    if (!def) throw new NotFoundError("OnboardTask", request.params.key);
    await prisma.onboardTask.upsert({
      where: { tenantId_taskKey: { tenantId: info.tenantId, taskKey: def.key } },
      update: { doneAt: null },
      create: {
        id: randomUUID(),
        tenantId: info.tenantId,
        day: def.day,
        taskKey: def.key,
        deepLink: def.deepLink,
        doneAt: null,
      },
    });
    return { done: false };
  });

  /** POST 网站就绪检查（第十四批） */
  app.post<{
    Body: { domain?: string };
  }>("/api/v1/onboard/site-check", async (request) => {
    const info = await requireSession(deps, request);
    const now = Date.now();
    const hits = (siteCheckHits.get(info.tenantId) ?? []).filter(
      (t) => now - t < 60_000
    );
    if (hits.length >= 10) {
      throw new ValidationError("检查频率超限（10 次/分钟），请稍后再试");
    }
    hits.push(now);
    siteCheckHits.set(info.tenantId, hits);
    const domain = (request.body?.domain ?? "").trim();
    if (!domain) throw new ValidationError("domain 必填");
    try {
      return await checkSiteReadiness(domain);
    } catch (e) {
      const err = e as { statusCode?: number; message?: string };
      if (err?.statusCode === 400) throw new ValidationError("域名格式不正确");
      throw new ValidationError(`检查失败：${err?.message ?? "未知错误"}`);
    }
  });
}
