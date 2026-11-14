/**
 * AutoAds-style 换链任务服务：CRUD、AuthCode、gettemplate、探链执行。
 * 探链仅做 HTTP 跟随跳转 + 落地页域名校验，不伪造第三方广告点击。
 */
import { randomBytes, randomUUID } from "node:crypto";
import type { Prisma, PrismaClient, UrlSwapTask } from "@prisma/client";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "@adlinklab/shared";

export type UrlSwapTaskStatus = "running" | "paused" | "error" | "completed";

export interface UrlSwapLink {
  url: string;
  remark: string;
}

export interface UrlSwapTaskInput {
  network?: string;
  campaignName: string;
  links: UrlSwapLink[];
  landingDomain: string;
  proxyType?: "http" | "socks5" | "none";
  geoVerifyEnabled?: boolean;
  proxyExtractUrl?: string;
  backupProxyExtractUrl?: string;
  targetRegions?: string[];
  uaStrategy?: "random" | "fixed";
  uaPlatform?: "desktop" | "mobile" | "any";
  referers?: string[];
  execIntervalMinutes?: number;
  rotateIntervalMinutes?: number;
  rotationEnabled?: boolean;
  status?: UrlSwapTaskStatus;
}

export interface UrlSwapTaskDto {
  id: string;
  network: string;
  campaignName: string;
  links: UrlSwapLink[];
  landingDomain: string;
  proxyType: "http" | "socks5" | "none";
  geoVerifyEnabled: boolean;
  proxyExtractUrl: string;
  backupProxyExtractUrl: string;
  targetRegions: string[];
  uaStrategy: "random" | "fixed";
  uaPlatform: "desktop" | "mobile" | "any";
  referers: string[];
  execIntervalMinutes: number;
  rotateIntervalMinutes: number;
  rotationEnabled: boolean;
  currentLinkIndex: number;
  lastRotatedAt: string | null;
  status: UrlSwapTaskStatus;
  linkChangeCount: number;
  lastExecAt: string | null;
  lastExecStatus: "success" | "failed" | null;
  lastExecMessage: string | null;
  lastProxyLine: string | null;
  activeTemplate: string | null;
  createdAt: string;
  updatedAt: string;
}

function clampInt(value: number, min: number, max: number) {
  const n = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, n));
}

function asLinks(raw: unknown): UrlSwapLink[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const row = item as { url?: unknown; remark?: unknown };
      const url = typeof row.url === "string" ? row.url.trim() : "";
      if (!url) return null;
      return {
        url,
        remark: typeof row.remark === "string" ? row.remark.trim() : "",
      };
    })
    .filter((x): x is UrlSwapLink => x != null);
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .filter(Boolean);
}

function applyTemplate(url: string, campaignName: string) {
  return url.replaceAll("{campaign_name}", encodeURIComponent(campaignName));
}

function hostnameOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function landingMatches(expected: string, actualHost: string): boolean {
  const want = expected
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .toLowerCase();
  const got = actualHost.toLowerCase();
  return got === want || got.endsWith(`.${want}`) || want.endsWith(got);
}

function toDto(row: UrlSwapTask): UrlSwapTaskDto {
  return {
    id: row.id,
    network: row.network,
    campaignName: row.campaignName,
    links: asLinks(row.links),
    landingDomain: row.landingDomain,
    proxyType: (row.proxyType as UrlSwapTaskDto["proxyType"]) || "none",
    geoVerifyEnabled: row.geoVerifyEnabled,
    proxyExtractUrl: row.proxyExtractUrl,
    backupProxyExtractUrl: row.backupProxyExtractUrl,
    targetRegions: asStringArray(row.targetRegions),
    uaStrategy: (row.uaStrategy as UrlSwapTaskDto["uaStrategy"]) || "random",
    uaPlatform: (row.uaPlatform as UrlSwapTaskDto["uaPlatform"]) || "desktop",
    referers: asStringArray(row.referers),
    execIntervalMinutes: row.execIntervalMinutes,
    rotateIntervalMinutes: row.rotateIntervalMinutes,
    rotationEnabled: row.rotationEnabled,
    currentLinkIndex: row.currentLinkIndex,
    lastRotatedAt: row.lastRotatedAt?.toISOString() ?? null,
    status: row.status as UrlSwapTaskStatus,
    linkChangeCount: row.linkChangeCount,
    lastExecAt: row.lastExecAt?.toISOString() ?? null,
    lastExecStatus: (row.lastExecStatus as UrlSwapTaskDto["lastExecStatus"]) ?? null,
    lastExecMessage: row.lastExecMessage,
    lastProxyLine: row.lastProxyLine,
    activeTemplate: row.activeTemplate,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function normalizeTaskInput(input: UrlSwapTaskInput) {
  const campaignName = input.campaignName?.trim();
  if (!campaignName) {
    throw new ValidationError("广告系列名称不能为空");
  }
  const landingDomain = input.landingDomain?.trim();
  if (!landingDomain) {
    throw new ValidationError("落地页域名不能为空");
  }
  const links = (input.links ?? [])
    .map((link) => ({
      url: link.url.trim(),
      remark: (link.remark ?? "").trim(),
    }))
    .filter((link) => link.url.length > 0);
  if (links.length === 0) {
    throw new ValidationError("至少需要一条联盟链接");
  }
  for (const link of links) {
    try {
      const u = new URL(link.url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("bad");
      }
    } catch {
      throw new ValidationError(`无效链接：${link.url}`);
    }
  }

  const execIntervalMinutes = clampInt(input.execIntervalMinutes ?? 10, 5, 60);
  const rotateIntervalMinutes = clampInt(
    input.rotateIntervalMinutes ?? 30,
    execIntervalMinutes,
    180
  );

  return {
    network: (input.network ?? "").trim() || "default",
    campaignName,
    links,
    landingDomain,
    proxyType: input.proxyType ?? "none",
    geoVerifyEnabled: input.geoVerifyEnabled ?? false,
    proxyExtractUrl: (input.proxyExtractUrl ?? "").trim(),
    backupProxyExtractUrl: (input.backupProxyExtractUrl ?? "").trim(),
    targetRegions: (input.targetRegions ?? ["US"]).filter(Boolean),
    uaStrategy: input.uaStrategy ?? "random",
    uaPlatform: input.uaPlatform ?? "desktop",
    referers: (input.referers ?? ["https://www.facebook.com"])
      .map((item) => item.trim())
      .filter(Boolean),
    execIntervalMinutes,
    rotateIntervalMinutes,
    rotationEnabled: input.rotationEnabled ?? true,
    status: input.status ?? ("running" as UrlSwapTaskStatus),
  };
}

function makeAuthCode() {
  return randomBytes(24).toString("base64url");
}

export class UrlSwapService {
  constructor(private readonly prisma: PrismaClient) {}

  async getOrCreateAuth(tenantId: string) {
    const existing = await this.prisma.urlSwapAuth.findUnique({
      where: { tenantId },
    });
    if (existing) return existing;
    return this.prisma.urlSwapAuth.create({
      data: {
        id: randomUUID(),
        tenantId,
        apiAuthCode: makeAuthCode(),
      },
    });
  }

  async regenerateAuth(tenantId: string) {
    const existing = await this.getOrCreateAuth(tenantId);
    return this.prisma.urlSwapAuth.update({
      where: { id: existing.id },
      data: { apiAuthCode: makeAuthCode() },
    });
  }

  async listTasks(tenantId: string, status?: string): Promise<UrlSwapTaskDto[]> {
    const rows = await this.prisma.urlSwapTask.findMany({
      where: {
        tenantId,
        ...(status && status !== "all" ? { status } : {}),
      },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(toDto);
  }

  async getTask(tenantId: string, id: string): Promise<UrlSwapTaskDto | null> {
    const row = await this.prisma.urlSwapTask.findFirst({
      where: { id, tenantId },
    });
    return row ? toDto(row) : null;
  }

  private async ensureUniqueCampaignName(
    tenantId: string,
    campaignName: string,
    excludeId?: string
  ) {
    const conflict = await this.prisma.urlSwapTask.findFirst({
      where: {
        tenantId,
        campaignName,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
    });
    if (conflict) {
      throw new ConflictError(`广告系列名称已存在：${campaignName}`);
    }
  }

  async createTask(
    tenantId: string,
    input: UrlSwapTaskInput
  ): Promise<UrlSwapTaskDto> {
    const normalized = normalizeTaskInput(input);
    await this.ensureUniqueCampaignName(tenantId, normalized.campaignName);
    const row = await this.prisma.urlSwapTask.create({
      data: {
        id: randomUUID(),
        tenantId,
        network: normalized.network,
        campaignName: normalized.campaignName,
        links: normalized.links as unknown as Prisma.InputJsonValue,
        landingDomain: normalized.landingDomain,
        proxyType: normalized.proxyType,
        geoVerifyEnabled: normalized.geoVerifyEnabled,
        proxyExtractUrl: normalized.proxyExtractUrl,
        backupProxyExtractUrl: normalized.backupProxyExtractUrl,
        targetRegions: normalized.targetRegions as unknown as Prisma.InputJsonValue,
        uaStrategy: normalized.uaStrategy,
        uaPlatform: normalized.uaPlatform,
        referers: normalized.referers as unknown as Prisma.InputJsonValue,
        execIntervalMinutes: normalized.execIntervalMinutes,
        rotateIntervalMinutes: normalized.rotateIntervalMinutes,
        rotationEnabled: normalized.rotationEnabled,
        status: normalized.status,
      },
    });
    return toDto(row);
  }

  async updateTask(
    tenantId: string,
    id: string,
    patch: Partial<UrlSwapTaskInput>
  ): Promise<UrlSwapTaskDto> {
    const current = await this.prisma.urlSwapTask.findFirst({
      where: { id, tenantId },
    });
    if (!current) throw new NotFoundError("UrlSwapTask", id);

    const merged: UrlSwapTaskInput = {
      network: patch.network ?? current.network,
      campaignName: patch.campaignName ?? current.campaignName,
      links: patch.links ?? asLinks(current.links),
      landingDomain: patch.landingDomain ?? current.landingDomain,
      proxyType:
        (patch.proxyType as UrlSwapTaskInput["proxyType"]) ??
        (current.proxyType as UrlSwapTaskInput["proxyType"]),
      geoVerifyEnabled: patch.geoVerifyEnabled ?? current.geoVerifyEnabled,
      proxyExtractUrl: patch.proxyExtractUrl ?? current.proxyExtractUrl,
      backupProxyExtractUrl:
        patch.backupProxyExtractUrl ?? current.backupProxyExtractUrl,
      targetRegions: patch.targetRegions ?? asStringArray(current.targetRegions),
      uaStrategy:
        (patch.uaStrategy as UrlSwapTaskInput["uaStrategy"]) ??
        (current.uaStrategy as UrlSwapTaskInput["uaStrategy"]),
      uaPlatform:
        (patch.uaPlatform as UrlSwapTaskInput["uaPlatform"]) ??
        (current.uaPlatform as UrlSwapTaskInput["uaPlatform"]),
      referers: patch.referers ?? asStringArray(current.referers),
      execIntervalMinutes:
        patch.execIntervalMinutes ?? current.execIntervalMinutes,
      rotateIntervalMinutes:
        patch.rotateIntervalMinutes ?? current.rotateIntervalMinutes,
      rotationEnabled: patch.rotationEnabled ?? current.rotationEnabled,
      status:
        (patch.status as UrlSwapTaskStatus) ??
        (current.status as UrlSwapTaskStatus),
    };

    const normalized = normalizeTaskInput(merged);
    await this.ensureUniqueCampaignName(
      tenantId,
      normalized.campaignName,
      id
    );

    const row = await this.prisma.urlSwapTask.update({
      where: { id },
      data: {
        network: normalized.network,
        campaignName: normalized.campaignName,
        links: normalized.links as unknown as Prisma.InputJsonValue,
        landingDomain: normalized.landingDomain,
        proxyType: normalized.proxyType,
        geoVerifyEnabled: normalized.geoVerifyEnabled,
        proxyExtractUrl: normalized.proxyExtractUrl,
        backupProxyExtractUrl: normalized.backupProxyExtractUrl,
        targetRegions: normalized.targetRegions as unknown as Prisma.InputJsonValue,
        uaStrategy: normalized.uaStrategy,
        uaPlatform: normalized.uaPlatform,
        referers: normalized.referers as unknown as Prisma.InputJsonValue,
        execIntervalMinutes: normalized.execIntervalMinutes,
        rotateIntervalMinutes: normalized.rotateIntervalMinutes,
        rotationEnabled: normalized.rotationEnabled,
        status: normalized.status,
        currentLinkIndex: Math.min(
          current.currentLinkIndex,
          Math.max(0, normalized.links.length - 1)
        ),
      },
    });
    return toDto(row);
  }

  async deleteTask(tenantId: string, id: string): Promise<void> {
    const current = await this.prisma.urlSwapTask.findFirst({
      where: { id, tenantId },
    });
    if (!current) throw new NotFoundError("UrlSwapTask", id);
    await this.prisma.urlSwapTask.delete({ where: { id } });
  }

  /** Public Ads Script endpoint: auth by apiauthcode across tenants. */
  async resolveTrackingTemplate(input: {
    apiAuthCode: string;
    campaignName: string;
  }): Promise<string | null> {
    const auth = await this.prisma.urlSwapAuth.findFirst({
      where: { apiAuthCode: input.apiAuthCode },
    });
    if (!auth) {
      throw new UnauthorizedError("apiauthcode 无效");
    }

    const campaignName = input.campaignName.trim();
    if (!campaignName) {
      throw new ValidationError("campaign_name 不能为空");
    }

    const task = await this.prisma.urlSwapTask.findFirst({
      where: { tenantId: auth.tenantId, campaignName },
    });

    if (!task || task.status === "completed") {
      return null;
    }

    const links = asLinks(task.links);
    if (!links.length) return null;

    let currentLinkIndex = task.currentLinkIndex;
    let lastRotatedAt = task.lastRotatedAt;
    let linkChangeCount = task.linkChangeCount;
    const rotateMs = task.rotateIntervalMinutes * 60_000;
    const due =
      task.rotationEnabled &&
      (!lastRotatedAt || Date.now() - lastRotatedAt.getTime() >= rotateMs);

    if (due && links.length > 1) {
      currentLinkIndex = (currentLinkIndex + 1) % links.length;
      lastRotatedAt = new Date();
      linkChangeCount += 1;
      await this.prisma.urlSwapTask.update({
        where: { id: task.id },
        data: { currentLinkIndex, lastRotatedAt, linkChangeCount },
      });
    } else if (!lastRotatedAt) {
      lastRotatedAt = new Date();
      await this.prisma.urlSwapTask.update({
        where: { id: task.id },
        data: { lastRotatedAt },
      });
    }

    if (task.activeTemplate) return task.activeTemplate;
    const link = links[currentLinkIndex] ?? links[0];
    return applyTemplate(link.url, campaignName);
  }

  async executeTask(
    tenantId: string,
    taskId: string,
    options?: { forceRotate?: boolean }
  ) {
    const row = await this.prisma.urlSwapTask.findFirst({
      where: { id: taskId, tenantId },
    });
    if (!row) throw new NotFoundError("UrlSwapTask", taskId);
    if (row.status !== "running" && !options?.forceRotate) {
      throw new ConflictError("任务未处于运行中");
    }

    const task = toDto(row);
    if (!task.links.length) {
      throw new ValidationError("任务没有联盟链接");
    }

    const rotateMs = task.rotateIntervalMinutes * 60_000;
    const due =
      options?.forceRotate ||
      (task.rotationEnabled &&
        (!task.lastRotatedAt ||
          Date.now() - new Date(task.lastRotatedAt).getTime() >= rotateMs));

    let linkIndex = task.currentLinkIndex;
    if (due && task.links.length > 1) {
      linkIndex = (task.currentLinkIndex + 1) % task.links.length;
    }

    const link = task.links[linkIndex] ?? task.links[0];
    const targetUrl = applyTemplate(link.url, task.campaignName);
    const userAgent =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const referer = task.referers[0] ?? null;
    const started = Date.now();

    let success = false;
    let message: string | null = null;
    let finalDomain: string | null = null;

    try {
      const response = await fetch(targetUrl, {
        method: "GET",
        redirect: "follow",
        headers: {
          "User-Agent": userAgent,
          ...(referer ? { Referer: referer } : {}),
        },
        signal: AbortSignal.timeout(25_000),
      });
      finalDomain = hostnameOf(response.url);
      if (!response.ok) {
        message = `HTTP ${response.status}`;
      } else if (
        task.landingDomain &&
        finalDomain &&
        !landingMatches(task.landingDomain, finalDomain)
      ) {
        message = `落地页不匹配：期望 ${task.landingDomain}，实际 ${finalDomain}`;
      } else {
        success = true;
        message = `探测成功 → ${finalDomain || response.url}`;
      }
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    const durationMs = Date.now() - started;
    const stamp = new Date();
    const template = targetUrl;

    const updated = await this.prisma.urlSwapTask.update({
      where: { id: task.id },
      data: {
        currentLinkIndex: success ? linkIndex : task.currentLinkIndex,
        lastRotatedAt:
          success && due ? stamp : row.lastRotatedAt,
        linkChangeCount:
          success && due && linkIndex !== task.currentLinkIndex
            ? task.linkChangeCount + 1
            : task.linkChangeCount,
        lastExecAt: stamp,
        lastExecStatus: success ? "success" : "failed",
        lastExecMessage: message,
        lastProxyLine: null,
        activeTemplate: success ? template : task.activeTemplate ?? template,
      },
    });

    const log = await this.prisma.urlSwapExecLog.create({
      data: {
        id: randomUUID(),
        tenantId,
        taskId: task.id,
        campaignName: task.campaignName,
        linkUrl: targetUrl,
        linkRemark: link.remark,
        status: success ? "success" : "failed",
        proxyLine: null,
        referer,
        userAgent,
        finalDomain,
        durationMs,
        message,
      },
    });

    return { task: toDto(updated), log };
  }

  summarize(tasks: UrlSwapTaskDto[]) {
    const running = tasks.filter((t) => t.status === "running").length;
    const paused = tasks.filter((t) => t.status === "paused").length;
    const error = tasks.filter((t) => t.status === "error").length;
    const completed = tasks.filter((t) => t.status === "completed").length;
    const linkChanges = tasks.reduce((sum, t) => sum + t.linkChangeCount, 0);
    const executed = tasks.filter((t) => t.lastExecStatus != null);
    const succeeded = executed.filter((t) => t.lastExecStatus === "success");
    const successRate =
      executed.length === 0
        ? 0
        : Math.round((succeeded.length / executed.length) * 1000) / 10;
    return {
      total: tasks.length,
      running,
      paused,
      error,
      completed,
      linkChanges,
      successRate,
    };
  }
}
