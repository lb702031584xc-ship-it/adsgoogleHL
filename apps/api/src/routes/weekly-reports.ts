/**
 * Automation round 2 — weekly report API routes.
 *
 * Pure addition: new endpoints only, no existing route behavior changed.
 * Register in routes/index.ts with
 *   await registerWeeklyReportRoutes(app, prismaOnly, auth);
 *
 * - GET  /api/v1/weekly-reports
 * - GET  /api/v1/weekly-reports/:id
 * - POST /api/v1/weekly-reports/generate-now  (body: { weekStart?, weekEnd? })
 *
 * Session auth via requireTenant (tenant-isolated).
 */
import type { FastifyInstance } from "fastify";
import type { PrismaClient } from "@adlinklab/database";
import { ValidationError } from "@adlinklab/shared";
import {
  requireTenant,
  type AuthContext,
} from "../auth/tenant.js";
import {
  generateWeeklyReport,
  getLastWeekRange,
  getWeeklyReport,
  listWeeklyReports,
  type WeeklyReportLang,
} from "../services/weekly-report-service.js";

export interface WeeklyReportRouteServices {
  prisma: PrismaClient;
}

function serializeReport(row: {
  id: string;
  tenantId: string;
  weekStart: Date;
  weekEnd: Date;
  data: unknown;
  aiSummary: string;
  status: string;
  createdAt: Date;
}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    weekStart: row.weekStart.toISOString(),
    weekEnd: row.weekEnd.toISOString(),
    data: row.data,
    aiSummary: row.aiSummary,
    status: row.status,
    createdAt: row.createdAt.toISOString(),
  };
}

function parseOptionalDate(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be an ISO date string`);
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new ValidationError(`${field} must be an ISO date string`);
  }
  return d;
}

export async function registerWeeklyReportRoutes(
  app: FastifyInstance,
  services: WeeklyReportRouteServices,
  auth: AuthContext
): Promise<void> {
  const { prisma } = services;

  app.get("/api/v1/weekly-reports", async (request) => {
    const tenantId = requireTenant(auth, request);
    const rows = await listWeeklyReports(prisma, tenantId);
    return { reports: rows.map(serializeReport) };
  });

  app.get<{ Params: { id: string } }>(
    "/api/v1/weekly-reports/:id",
    async (request) => {
      const tenantId = requireTenant(auth, request);
      const row = await getWeeklyReport(prisma, tenantId, request.params.id);
      return serializeReport(row);
    }
  );

  app.post<{
    Body: { weekStart?: string; weekEnd?: string; lang?: string };
  }>("/api/v1/weekly-reports/generate-now", async (request, reply) => {
    const tenantId = requireTenant(auth, request);
    const body = request.body ?? {};
    let { weekStart, weekEnd } = {
      weekStart: parseOptionalDate(body.weekStart, "weekStart"),
      weekEnd: parseOptionalDate(body.weekEnd, "weekEnd"),
    };
    if ((weekStart === undefined) !== (weekEnd === undefined)) {
      throw new ValidationError("weekStart/weekEnd must be set together");
    }
    if (!weekStart || !weekEnd) {
      const range = getLastWeekRange(new Date());
      weekStart = range.weekStart;
      weekEnd = range.weekEnd;
    }
    const lang: WeeklyReportLang = body.lang === "en" ? "en" : "zh";
    const report = await generateWeeklyReport(
      prisma,
      tenantId,
      weekStart,
      weekEnd,
      { lang }
    );
    reply.code(201);
    return {
      id: report.id,
      tenantId: report.tenantId,
      weekStart: report.weekStart.toISOString(),
      weekEnd: report.weekEnd.toISOString(),
      data: report.data,
      aiSummary: report.aiSummary,
      status: report.status,
    };
  });
}
