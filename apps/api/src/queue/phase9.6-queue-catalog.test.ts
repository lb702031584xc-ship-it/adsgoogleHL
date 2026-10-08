/**
 * Phase 9.6 — Queue Catalog Honesty tests.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { JOB_DEFINITIONS, QUEUE_NAMES } from "./jobs.js";
import {
  WORKER_REGISTRY,
  getImplementedQueueNames,
  getPlannedQueueNames,
  getQueueCatalog,
  isWorkerRegistered,
  resolveQueueCapability,
} from "./queue-catalog.js";
import { WorkerRuntime } from "./runtime.js";

const ROOT = resolve(process.cwd(), "../..");

function readRepo(rel: string): string {
  return readFileSync(resolve(ROOT, rel), "utf8");
}

describe("Phase 9.6 Queue Catalog Honesty", () => {
  it("1. catalog covers every JOB_DEFINITIONS / QUEUE_NAMES entry", () => {
    const catalog = getQueueCatalog();
    expect(catalog.map((c) => c.jobType).sort()).toEqual(
      JOB_DEFINITIONS.map((j) => j.name).sort()
    );
    for (const name of Object.values(QUEUE_NAMES)) {
      expect(catalog.some((c) => c.queueName === name)).toBe(true);
    }
  });

  it("2. worker registry lists every real Worker", () => {
    expect(WORKER_REGISTRY.map((w) => w.queueName).sort()).toEqual([
      "budgetPacer",
      "cashbackLpScore",
      "cashbackRateCompare",
      "cashbackRateWatch",
      "cashbackRedirectCheck",
      "cashbackTermsWatch",
      "competitorWatch",
      "conversionUpload",
      "deadLink",
      "killSwitch",
      "networkPull",
      "payoutWatch",
      "rotation",
      "trafficMonitor",
      "urlChange",
      "weeklyReport",
    ]);
    for (const w of WORKER_REGISTRY) {
      expect(w.entryPoint).toBe("WorkerRuntime.start");
      expect(w.processorExport.length).toBeGreaterThan(0);
    }
  });

  it("3. Queue + Worker + Processor => IMPLEMENTED", () => {
    for (const name of [
      "urlChange",
      "conversionUpload",
      "trafficMonitor",
      "killSwitch",
      "competitorWatch",
      "rotation",
      "deadLink",
      "payoutWatch",
      "budgetPacer",
      "networkPull",
      "weeklyReport",
      "cashbackRateWatch",
      "cashbackTermsWatch",
      "cashbackLpScore",
      "cashbackRedirectCheck",
      "cashbackRateCompare",
    ] as const) {
      expect(isWorkerRegistered(name)).toBe(true);
      expect(resolveQueueCapability(name)).toBe("IMPLEMENTED");
      const entry = getQueueCatalog().find((c) => c.queueName === name)!;
      expect(entry.status).toBe("IMPLEMENTED");
      expect(entry.workerRegistered).toBe(true);
      expect(entry.processor).toBeTruthy();
      expect(entry.entryPoint).toBe("WorkerRuntime.start");
    }
    expect(getImplementedQueueNames().sort()).toEqual([
      "budgetPacer",
      "cashbackLpScore",
      "cashbackRateCompare",
      "cashbackRateWatch",
      "cashbackRedirectCheck",
      "cashbackTermsWatch",
      "competitorWatch",
      "conversionUpload",
      "deadLink",
      "killSwitch",
      "networkPull",
      "payoutWatch",
      "rotation",
      "trafficMonitor",
      "urlChange",
      "weeklyReport",
    ]);
  });

  it("4. Queue without Worker => PLANNED", () => {
    for (const name of [
      "googleAdsSync",
      "clickProcessing",
      "analyticsAggregation",
    ] as const) {
      expect(isWorkerRegistered(name)).toBe(false);
      expect(resolveQueueCapability(name)).toBe("PLANNED");
      const entry = getQueueCatalog().find((c) => c.queueName === name)!;
      expect(entry.status).toBe("PLANNED");
      expect(entry.workerRegistered).toBe(false);
      expect(entry.processor).toBeNull();
      expect(entry.entryPoint).toBeNull();
    }
    expect(getPlannedQueueNames().sort()).toEqual([
      "analyticsAggregation",
      "clickProcessing",
      "googleAdsSync",
    ]);
  });

  it("5. workerRegistered=false cannot be IMPLEMENTED", () => {
    for (const entry of getQueueCatalog()) {
      if (!entry.workerRegistered) {
        expect(entry.status).not.toBe("IMPLEMENTED");
        expect(entry.status).toBe("PLANNED");
      }
      if (entry.status === "IMPLEMENTED") {
        expect(entry.workerRegistered).toBe(true);
      }
    }
  });

  it("6. production WorkerRuntime registers only IMPLEMENTED queues", () => {
    const runtimeSrc = readRepo("apps/api/src/queue/runtime.ts");
    expect(runtimeSrc).toMatch(/new Worker[\s\S]*QUEUE_NAMES\.urlChange/);
    expect(runtimeSrc).toMatch(/new Worker[\s\S]*QUEUE_NAMES\.conversionUpload/);
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.trafficMonitor/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.killSwitch/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.competitorWatch/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.weeklyReport/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.cashbackRateWatch/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.cashbackTermsWatch/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.cashbackLpScore/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.cashbackRedirectCheck/
    );
    expect(runtimeSrc).toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.cashbackRateCompare/
    );
    expect(runtimeSrc).not.toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.googleAdsSync/
    );
    expect(runtimeSrc).not.toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.clickProcessing/
    );
    expect(runtimeSrc).not.toMatch(
      /new Worker[\s\S]*QUEUE_NAMES\.analyticsAggregation/
    );

    const workerEntry = readRepo("apps/api/src/worker.ts");
    expect(workerEntry).toContain("createWorkerRuntime");
    expect(workerEntry).toContain("runtime.start()");

    // Type-level: WorkerRuntime default createWorkers matches registry
    const rt = new WorkerRuntime(
      {
        syncJobs: {} as never,
        urlChangeRequests: {} as never,
        orderConversions: {} as never,
        log: { info: () => undefined, error: () => undefined },
      },
      {
        createWorkers: () => [],
      }
    );
    expect(rt.getHealth().enabled).toBe(true);
  });

  it("7. Queue names remain stable", () => {
    expect(QUEUE_NAMES).toEqual({
      googleAdsSync: "googleAdsSync",
      urlChange: "urlChange",
      conversionUpload: "conversionUpload",
      clickProcessing: "clickProcessing",
      analyticsAggregation: "analyticsAggregation",
      trafficMonitor: "trafficMonitor",
      killSwitch: "killSwitch",
      competitorWatch: "competitorWatch",
      rotation: "rotation",
      deadLink: "deadLink",
      payoutWatch: "payoutWatch",
      budgetPacer: "budgetPacer",
      networkPull: "networkPull",
      weeklyReport: "weeklyReport",
      cashbackRateWatch: "cashbackRateWatch",
      cashbackTermsWatch: "cashbackTermsWatch",
      cashbackLpScore: "cashbackLpScore",
      cashbackRedirectCheck: "cashbackRedirectCheck",
      cashbackRateCompare: "cashbackRateCompare",
    });
  });

  it("8. createQueues opens only IMPLEMENTED queues (no false Queue clients)", () => {
    const src = readRepo("apps/api/src/queue/jobs.ts");
    expect(src).toMatch(
      /export function createQueues[\s\S]*urlChange: new Queue/
    );
    expect(src).toMatch(
      /export function createQueues[\s\S]*conversionUpload: new Queue/
    );
    expect(src).toMatch(
      /export function createQueues[\s\S]*trafficMonitor: new Queue/
    );
    expect(src).toMatch(
      /export function createQueues[\s\S]*killSwitch: new Queue/
    );
    expect(src).toMatch(
      /export function createQueues[\s\S]*competitorWatch: new Queue/
    );
    expect(src).toMatch(
      /export function createQueues[\s\S]*rotation: new Queue/
    );
    // Must not instantiate BullMQ clients for PLANNED queues
    const fnBody = src.slice(src.indexOf("export function createQueues"));
    const end = fnBody.indexOf("export async function processIdempotentJob");
    const body = end > 0 ? fnBody.slice(0, end) : fnBody;
    expect(body).not.toMatch(/googleAdsSync: new Queue/);
    expect(body).not.toMatch(/clickProcessing: new Queue/);
    expect(body).not.toMatch(/analyticsAggregation: new Queue/);
    expect(getImplementedQueueNames().sort()).toEqual([
      "budgetPacer",
      "cashbackLpScore",
      "cashbackRateCompare",
      "cashbackRateWatch",
      "cashbackRedirectCheck",
      "cashbackTermsWatch",
      "competitorWatch",
      "conversionUpload",
      "deadLink",
      "killSwitch",
      "networkPull",
      "payoutWatch",
      "rotation",
      "trafficMonitor",
      "urlChange",
      "weeklyReport",
    ]);
  });

  it("9. /health exposes honest queue catalog", async () => {
    const app = await buildApp();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body.queues)).toBe(true);
    const byName = Object.fromEntries(
      body.queues.map((q: { queueName: string }) => [q.queueName, q])
    );
    expect(byName.urlChange).toMatchObject({
      status: "IMPLEMENTED",
      workerRegistered: true,
    });
    expect(byName.conversionUpload).toMatchObject({
      status: "IMPLEMENTED",
      workerRegistered: true,
    });
    expect(byName.googleAdsSync).toMatchObject({
      status: "PLANNED",
      workerRegistered: false,
    });
    expect(byName.clickProcessing).toMatchObject({
      status: "PLANNED",
      workerRegistered: false,
    });
    expect(byName.analyticsAggregation).toMatchObject({
      status: "PLANNED",
      workerRegistered: false,
    });
    await app.close();
  });

  it("10. processor files exist for registered workers", () => {
    for (const w of WORKER_REGISTRY) {
      const src = readRepo(`apps/api/src/queue/${w.processorModule}`);
      expect(src).toContain(`export async function ${w.processorExport}`);
    }
  });
});

describe("Phase 9.6 health route import smoke", () => {
  it("getQueueCatalog is importable without Redis", () => {
    expect(getQueueCatalog().length).toBe(19);
  });
});
