import { randomUUID } from "node:crypto";
import type { SyncJobRepository } from "@adlinklab/domain";
import { createIdempotencyKey, type SyncJobType } from "@adlinklab/shared";
import { Queue, type ConnectionOptions } from "bullmq";
import { mutationLockKey, withMutationLock } from "./execution-guard.js";
import {
  classifyJobError,
  shouldSoftRetry,
  throwTerminalForBullMq,
  type ProcessorRetryContext,
} from "./retry-policy.js";

export const QUEUE_NAMES = {
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
  asinWatch: "asinWatch",
} as const satisfies Record<SyncJobType, string>;

/** Queues with real Worker + Processor (Phase 9.6). Names must stay stable. */
export type ImplementedQueueName =
  | "urlChange"
  | "conversionUpload"
  | "trafficMonitor"
  | "killSwitch"
  | "competitorWatch"
  | "rotation"
  | "deadLink"
  | "payoutWatch"
  | "budgetPacer"
  | "networkPull"
  | "weeklyReport"
  | "cashbackRateWatch"
  | "cashbackTermsWatch"
  | "cashbackLpScore"
  | "cashbackRedirectCheck"
  | "cashbackRateCompare";

export interface JobDefinition {
  name: SyncJobType;
  queueName: string;
  /** BullMQ job attempts (broker retries). */
  defaultAttempts: number;
  /** Exponential backoff base delay in ms. */
  backoffDelayMs: number;
  backoffType: "exponential";
}

/**
 * Job / retry catalog for all SyncJobType names.
 * Capability (IMPLEMENTED vs PLANNED) is NOT claimed here —
 * see queue-catalog.ts WORKER_REGISTRY / getQueueCatalog().
 */
export const JOB_DEFINITIONS: JobDefinition[] = [
  {
    name: "googleAdsSync",
    queueName: QUEUE_NAMES.googleAdsSync,
    defaultAttempts: 5,
    backoffDelayMs: 2_000,
    backoffType: "exponential",
  },
  {
    name: "urlChange",
    queueName: QUEUE_NAMES.urlChange,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "conversionUpload",
    queueName: QUEUE_NAMES.conversionUpload,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "clickProcessing",
    queueName: QUEUE_NAMES.clickProcessing,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "analyticsAggregation",
    queueName: QUEUE_NAMES.analyticsAggregation,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "trafficMonitor",
    queueName: QUEUE_NAMES.trafficMonitor,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "killSwitch",
    queueName: QUEUE_NAMES.killSwitch,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "competitorWatch",
    queueName: QUEUE_NAMES.competitorWatch,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "rotation",
    queueName: QUEUE_NAMES.rotation,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "deadLink",
    queueName: QUEUE_NAMES.deadLink,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "payoutWatch",
    queueName: QUEUE_NAMES.payoutWatch,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "budgetPacer",
    queueName: QUEUE_NAMES.budgetPacer,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "networkPull",
    queueName: QUEUE_NAMES.networkPull,
    defaultAttempts: 3,
    backoffDelayMs: 5_000,
    backoffType: "exponential",
  },
  {
    name: "weeklyReport",
    queueName: QUEUE_NAMES.weeklyReport,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "cashbackRateWatch",
    queueName: QUEUE_NAMES.cashbackRateWatch,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "cashbackTermsWatch",
    queueName: QUEUE_NAMES.cashbackTermsWatch,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "cashbackLpScore",
    queueName: QUEUE_NAMES.cashbackLpScore,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "cashbackRedirectCheck",
    queueName: QUEUE_NAMES.cashbackRedirectCheck,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "cashbackRateCompare",
    queueName: QUEUE_NAMES.cashbackRateCompare,
    defaultAttempts: 3,
    backoffDelayMs: 1_000,
    backoffType: "exponential",
  },
  {
    name: "asinWatch",
    queueName: QUEUE_NAMES.asinWatch,
    defaultAttempts: 3,
    backoffDelayMs: 2_000,
    backoffType: "exponential",
  },
];

export function createRedisConnection(): ConnectionOptions {
  const url = process.env.REDIS_URL ?? "redis://localhost:6379";
  // BullMQ requires maxRetriesPerRequest: null for blocking connections.
  return { url, maxRetriesPerRequest: null };
}

/**
 * Create BullMQ Queue clients only for IMPLEMENTED worker queues.
 * PLANNED queues remain named in JOB_DEFINITIONS / QUEUE_NAMES but are not
 * opened here — Queue existence must not imply Worker readiness.
 */
export function createQueues(
  connection: ConnectionOptions
): Record<ImplementedQueueName, Queue> {
  return {
    urlChange: new Queue(QUEUE_NAMES.urlChange, { connection }),
    conversionUpload: new Queue(QUEUE_NAMES.conversionUpload, { connection }),
    trafficMonitor: new Queue(QUEUE_NAMES.trafficMonitor, { connection }),
    killSwitch: new Queue(QUEUE_NAMES.killSwitch, { connection }),
    competitorWatch: new Queue(QUEUE_NAMES.competitorWatch, { connection }),
    rotation: new Queue(QUEUE_NAMES.rotation, { connection }),
    deadLink: new Queue(QUEUE_NAMES.deadLink, { connection }),
    payoutWatch: new Queue(QUEUE_NAMES.payoutWatch, { connection }),
    budgetPacer: new Queue(QUEUE_NAMES.budgetPacer, { connection }),
    networkPull: new Queue(QUEUE_NAMES.networkPull, { connection }),
    weeklyReport: new Queue(QUEUE_NAMES.weeklyReport, { connection }),
    cashbackRateWatch: new Queue(QUEUE_NAMES.cashbackRateWatch, { connection }),
    cashbackTermsWatch: new Queue(QUEUE_NAMES.cashbackTermsWatch, { connection }),
    cashbackLpScore: new Queue(QUEUE_NAMES.cashbackLpScore, { connection }),
    cashbackRedirectCheck: new Queue(QUEUE_NAMES.cashbackRedirectCheck, { connection }),
    cashbackRateCompare: new Queue(QUEUE_NAMES.cashbackRateCompare, { connection }),
  };
}

/**
 * Idempotent job processor helper (Phase 8.3.3 state guards + 8.3.4 retry):
 * - COMPLETED → skip
 * - CANCELLED → skip (do not revive)
 * - PENDING / FAILED / RUNNING → claim RUNNING under mutation lock, run handler
 * - Retryable provider errors (Worker soft-retry): SyncJob → PENDING, rethrow for BullMQ
 * - Terminal errors: SyncJob → FAILED, UnrecoverableError for BullMQ
 *
 * SyncJob.attempts = business execution count (incremented on claim).
 * BullMQ attempts = broker retry budget (separate).
 */
export async function processIdempotentJob(
  syncJobs: SyncJobRepository,
  input: {
    type: SyncJobType;
    jobId: string;
    idempotencyKey: string;
    payload: Record<string, unknown>;
    tenantId?: string;
    handler: () => Promise<void>;
    retry?: ProcessorRetryContext;
  }
): Promise<{ skipped: boolean; status: string }> {
  return withMutationLock(mutationLockKey(input.jobId), async () => {
    const tenantId =
      input.tenantId ??
      (typeof input.payload.tenantId === "string"
        ? input.payload.tenantId
        : "00000000-0000-4000-8000-000000000001");
    const existing = await syncJobs.findByIdempotencyKey(
      tenantId,
      "SYNC_JOB",
      input.idempotencyKey
    );

    if (existing) {
      const status = existing.status.toUpperCase();
      if (status === "COMPLETED") {
        return { skipped: true, status: "COMPLETED" };
      }
      if (status === "CANCELLED") {
        return { skipped: true, status: "CANCELLED" };
      }
    }

    const job =
      existing ??
      (await syncJobs.create({
        id: randomUUID(),
        tenantId,
        jobId: input.jobId,
        type: input.type,
        status: "RUNNING",
        provider: "mock",
        idempotencyScope: "SYNC_JOB",
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
        attempts: 1,
        startedAt: new Date(),
      }));

    if (existing) {
      await syncJobs.update(job.id, {
        status: "RUNNING",
        attempts: job.attempts + 1,
        startedAt: new Date(),
        error: undefined,
        errorMessage: undefined,
      });
    }

    try {
      await input.handler();
      await syncJobs.update(job.id, {
        status: "COMPLETED",
        completedAt: new Date(),
      });
      return { skipped: false, status: "COMPLETED" };
    } catch (error) {
      const classified = classifyJobError(error);
      const soft = shouldSoftRetry({
        error,
        softRetryEnabled: input.retry?.softRetryEnabled,
        attemptsMade: input.retry?.attemptsMade,
        maxAttempts: input.retry?.maxAttempts,
      });

      if (soft) {
        // Soft fail — BullMQ will retry; SyncJob stays reclaimable PENDING.
        await syncJobs.update(job.id, {
          status: "PENDING",
          error: classified.message,
          errorMessage: classified.message,
        });
        throw error;
      }

      await syncJobs.update(job.id, {
        status: "FAILED",
        error: classified.message,
        errorMessage: classified.message,
      });

      if (input.retry?.softRetryEnabled) {
        // Worker path: stop BullMQ retries on terminal / exhausted.
        throwTerminalForBullMq(error);
      }
      throw error;
    }
  });
}

export function buildJobIdempotencyKey(
  type: SyncJobType,
  ...parts: Array<string | number | undefined>
): string {
  return createIdempotencyKey(type, ...parts);
}
