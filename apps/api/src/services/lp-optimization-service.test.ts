/**
 * lp-optimization-service unit tests (DB-free: mocked prisma delegate).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { NotFoundError, ValidationError } from "@adlinklab/shared";
import {
  archiveTask,
  listTasks,
  maybeCreateTask,
  MAX_STORED_ISSUES,
  OPTIMIZATION_SCORE_THRESHOLD,
  priorityForScores,
  updateTaskStatus,
  worstDimensionForScores,
  worstDimensionFromIssues,
  type LanderAnalysisResult as ServiceResult,
  type LpOptimizationPrisma,
  type OptimizationTaskRow,
} from "./lp-optimization-service.js";

function makePrisma(): LpOptimizationPrisma & {
  tasks: {
    findFirst: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  pages: { findMany: ReturnType<typeof vi.fn> };
} {
  const tasks = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const pages = { findMany: vi.fn() };
  return {
    landingPageOptimizationTask: tasks,
    landingPage: pages,
    tasks,
    pages,
  };
}

function analysisResult(
  overallScore: number,
  scores?: Partial<Record<string, number>>
): ServiceResult {
  const base = {
    performance: 80,
    cta: 80,
    trust: 80,
    mobile: 80,
    copy: 80,
    bounceRisk: 20,
    ...scores,
  };
  return {
    scores: base,
    issues: [{ dimension: "cta", severity: "high", message: "cta issue" }],
    overallScore,
    summary: { title: "t", h1: "h", excerpt: "e" },
  } as ServiceResult;
}

function taskRow(overrides: Partial<OptimizationTaskRow>): OptimizationTaskRow {
  return {
    id: "task-1",
    tenantId: "tenant-1",
    landingPageId: "page-1",
    score: 55,
    issues: [
      { dimension: "cta", severity: "high", message: "m1" },
      { dimension: "trust", severity: "low", message: "m2" },
    ],
    priority: "HIGH",
    status: "PENDING",
    createdAt: new Date("2026-10-06T00:00:00Z"),
    completedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("maybeCreateTask", () => {
  it("returns null without touching the DB when score >= threshold", async () => {
    const prisma = makePrisma();
    const out = await maybeCreateTask(
      prisma,
      "tenant-1",
      "page-1",
      analysisResult(OPTIMIZATION_SCORE_THRESHOLD)
    );
    expect(out).toBeNull();
    expect(prisma.tasks.findFirst).not.toHaveBeenCalled();
    expect(prisma.tasks.create).not.toHaveBeenCalled();

    const above = await maybeCreateTask(
      prisma,
      "tenant-1",
      "page-1",
      analysisResult(95)
    );
    expect(above).toBeNull();
    expect(prisma.tasks.create).not.toHaveBeenCalled();
  });

  it("creates a PENDING task when score is below threshold", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(null);
    const created = taskRow({ id: "new-1", status: "PENDING" });
    prisma.tasks.create.mockResolvedValue(created);

    const out = await maybeCreateTask(
      prisma,
      "tenant-1",
      "page-1",
      analysisResult(55)
    );
    expect(out).toEqual(created);
    const createData = prisma.tasks.create.mock.calls[0][0].data;
    expect(createData.tenantId).toBe("tenant-1");
    expect(createData.landingPageId).toBe("page-1");
    expect(createData.score).toBe(55);
    expect(createData.status).toBe("PENDING");
    expect(typeof createData.id).toBe("string");
  });

  it("dedupes: refreshes an existing PENDING task instead of creating", async () => {
    const prisma = makePrisma();
    const existing = taskRow({ id: "existing-1", score: 50 });
    prisma.tasks.findFirst.mockResolvedValue(existing);
    const refreshed = { ...existing, score: 42 };
    prisma.tasks.update.mockResolvedValue(refreshed);

    const out = await maybeCreateTask(
      prisma,
      "tenant-1",
      "page-1",
      analysisResult(42)
    );
    expect(out).toEqual(refreshed);
    expect(prisma.tasks.create).not.toHaveBeenCalled();
    expect(prisma.tasks.update).toHaveBeenCalledTimes(1);
    const updateArgs = prisma.tasks.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: "existing-1" });
    expect(updateArgs.data.score).toBe(42);
  });

  it("dedupes: existing IN_PROGRESS task is refreshed, not duplicated", async () => {
    const prisma = makePrisma();
    const existing = taskRow({ id: "existing-2", status: "IN_PROGRESS" });
    prisma.tasks.findFirst.mockResolvedValue(existing);
    prisma.tasks.update.mockResolvedValue(existing);

    await maybeCreateTask(prisma, "tenant-1", "page-1", analysisResult(30));
    expect(prisma.tasks.findFirst.mock.calls[0][0].where.status).toEqual({
      in: ["PENDING", "IN_PROGRESS"],
    });
    expect(prisma.tasks.create).not.toHaveBeenCalled();
  });

  it("truncates stored issues to the max cap", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(null);
    prisma.tasks.create.mockImplementation(async (args: { data: unknown }) => {
      void args;
      return taskRow({});
    });
    const many = Array.from({ length: MAX_STORED_ISSUES + 30 }, (_, i) => ({
      dimension: "cta" as const,
      severity: "low" as const,
      message: `issue ${i}`,
    }));
    const result = analysisResult(40);
    result.issues = many;
    await maybeCreateTask(prisma, "tenant-1", "page-1", result);
    const stored = prisma.tasks.create.mock.calls[0][0].data.issues as unknown[];
    expect(stored).toHaveLength(MAX_STORED_ISSUES);
  });
});

describe("priorityForScores / worstDimensionForScores", () => {
  const good = {
    performance: 80,
    cta: 80,
    trust: 80,
    mobile: 80,
    copy: 80,
    bounceRisk: 20,
  };

  it("HIGH when any quality dimension < 40", () => {
    expect(priorityForScores({ ...good, cta: 39 })).toBe("HIGH");
    expect(priorityForScores({ ...good, performance: 0 })).toBe("HIGH");
  });

  it("MEDIUM when weakest dimension is in [40, 60)", () => {
    expect(priorityForScores({ ...good, cta: 40 })).toBe("MEDIUM");
    expect(priorityForScores({ ...good, trust: 59 })).toBe("MEDIUM");
  });

  it("LOW when all quality dimensions >= 60", () => {
    expect(priorityForScores({ ...good, cta: 60 })).toBe("LOW");
    expect(priorityForScores(good)).toBe("LOW");
  });

  it("inverts bounceRisk: high risk lowers quality", () => {
    // bounceRisk 90 → quality 10 → HIGH priority
    expect(priorityForScores({ ...good, bounceRisk: 90 })).toBe("HIGH");
    expect(worstDimensionForScores({ ...good, bounceRisk: 90 })).toBe(
      "bounceRisk"
    );
  });

  it("picks the weakest quality dimension", () => {
    expect(worstDimensionForScores({ ...good, copy: 10 })).toBe("copy");
    expect(worstDimensionForScores(good)).toBe("performance"); // all quality 80, tie-break order
  });
});

describe("worstDimensionFromIssues", () => {
  it("picks the dimension with the most severity-weighted votes", () => {
    const out = worstDimensionFromIssues([
      { dimension: "trust", severity: "low", message: "x" },
      { dimension: "cta", severity: "high", message: "y" },
      { dimension: "trust", severity: "low", message: "z" },
    ]);
    // trust: 2 votes, cta: 3 votes (high=3)
    expect(out).toBe("cta");
  });

  it("falls back when no issues", () => {
    expect(worstDimensionFromIssues([])).toBe("performance");
  });
});

describe("listTasks", () => {
  it("sorts HIGH → MEDIUM → LOW then oldest first, with landing page refs", async () => {
    const prisma = makePrisma();
    const low = taskRow({
      id: "low",
      priority: "LOW",
      createdAt: new Date("2026-10-05T00:00:00Z"),
      landingPageId: "p-low",
    });
    const high = taskRow({
      id: "high",
      priority: "HIGH",
      createdAt: new Date("2026-10-06T00:00:00Z"),
      landingPageId: "p-high",
    });
    const med = taskRow({
      id: "med",
      priority: "MEDIUM",
      createdAt: new Date("2026-10-04T00:00:00Z"),
      landingPageId: "p-med",
    });
    prisma.tasks.findMany.mockResolvedValue([low, high, med]);
    prisma.pages.findMany.mockResolvedValue([
      { id: "p-high", name: "High LP", url: "https://a/x", domain: "a" },
      { id: "p-med", name: "Med LP", url: "https://b/y", domain: "b" },
    ]);

    const { items, total } = await listTasks(prisma, "tenant-1");
    expect(total).toBe(3);
    expect(items.map((i) => i.id)).toEqual(["high", "med", "low"]);
    expect(items[0].landingPage?.name).toBe("High LP");
    expect(items[1].landingPage?.name).toBe("Med LP");
    expect(items[2].landingPage).toBeNull(); // p-low missing → null
    expect(items[0].worstDimension).toBe("cta");
    expect(prisma.tasks.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tenant-1",
    });
  });

  it("filters by status", async () => {
    const prisma = makePrisma();
    prisma.tasks.findMany.mockResolvedValue([]);
    prisma.pages.findMany.mockResolvedValue([]);
    await listTasks(prisma, "tenant-1", "DONE");
    expect(prisma.tasks.findMany.mock.calls[0][0].where).toEqual({
      tenantId: "tenant-1",
      status: "DONE",
    });
  });
});

describe("updateTaskStatus", () => {
  it("PENDING → IN_PROGRESS", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(taskRow({ status: "PENDING" }));
    const updated = taskRow({ status: "IN_PROGRESS" });
    prisma.tasks.update.mockResolvedValue(updated);

    const out = await updateTaskStatus(
      prisma,
      "tenant-1",
      "task-1",
      "IN_PROGRESS"
    );
    expect(out.status).toBe("IN_PROGRESS");
    expect(prisma.tasks.update.mock.calls[0][0].data.status).toBe(
      "IN_PROGRESS"
    );
  });

  it("IN_PROGRESS → DONE stamps completedAt", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(taskRow({ status: "IN_PROGRESS" }));
    prisma.tasks.update.mockImplementation(
      async (args: { data: { completedAt?: Date } }) => {
        expect(args.data.completedAt).toBeInstanceOf(Date);
        return taskRow({ status: "DONE", completedAt: args.data.completedAt ?? null });
      }
    );
    const out = await updateTaskStatus(prisma, "tenant-1", "task-1", "DONE");
    expect(out.status).toBe("DONE");
    expect(out.completedAt).toBeInstanceOf(Date);
  });

  it("no-op when the status is unchanged", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(taskRow({ status: "DONE" }));
    const out = await updateTaskStatus(prisma, "tenant-1", "task-1", "DONE");
    expect(out.status).toBe("DONE");
    expect(prisma.tasks.update).not.toHaveBeenCalled();
  });

  it("rejects backward transitions", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(
      taskRow({ status: "IN_PROGRESS" })
    );
    await expect(
      updateTaskStatus(prisma, "tenant-1", "task-1", "PENDING")
    ).rejects.toBeInstanceOf(ValidationError);
    expect(prisma.tasks.update).not.toHaveBeenCalled();
  });

  it("rejects leaving DONE", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(taskRow({ status: "DONE" }));
    await expect(
      updateTaskStatus(prisma, "tenant-1", "task-1", "IN_PROGRESS")
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it("throws NotFoundError for unknown or foreign-tenant tasks", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(null);
    await expect(
      updateTaskStatus(prisma, "tenant-1", "missing", "DONE")
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("archiveTask", () => {
  it("hard-deletes a tenant task", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(taskRow({}));
    prisma.tasks.delete.mockResolvedValue(taskRow({}));
    const out = await archiveTask(prisma, "tenant-1", "task-1");
    expect(out).toEqual({ ok: true });
    expect(prisma.tasks.delete).toHaveBeenCalledWith({
      where: { id: "task-1" },
    });
  });

  it("throws NotFoundError for unknown or foreign-tenant tasks", async () => {
    const prisma = makePrisma();
    prisma.tasks.findFirst.mockResolvedValue(null);
    await expect(archiveTask(prisma, "tenant-1", "missing")).rejects.toBeInstanceOf(
      NotFoundError
    );
    expect(prisma.tasks.delete).not.toHaveBeenCalled();
  });
});
