import { Queue, Worker, type ConnectionOptions, type Job } from "bullmq";
import type { SyncJob, SyncJobRepository } from "@adlinklab/domain";
import type { PrismaClient } from "@adlinklab/database";
import type { OrderConversionService } from "../services/conversion-order.js";
import type { UrlChangeRequestService } from "../services/url-change-engine.js";
import {
  createRedisConnection,
  QUEUE_NAMES,
} from "./jobs.js";
import type {
  AdLinkLabJobData,
  BudgetPacerJobData,
  NetworkPullJobData,
  CompetitorWatchJobData,
  ConversionUploadJobData,
  DeadLinkJobData,
  KillSwitchJobData,
  PayoutWatchJobData,
  RotationJobData,
  TrafficMonitorJobData,
  UrlChangeJobData,
  WeeklyReportJobData,
  CashbackRateWatchJobData,
  CashbackTermsWatchJobData,
  CashbackLpScoreJobData,
  CashbackRedirectCheckJobData,
  CashbackRateCompareJobData,
  AsinWatchJobData,
} from "./job-data.js";
import {
  parseBudgetPacerJobData,
  parseNetworkPullJobData,
  parseCompetitorWatchJobData,
  parseDeadLinkJobData,
  parseKillSwitchJobData,
  parsePayoutWatchJobData,
  parseRotationJobData,
  parseTrafficMonitorJobData,
  parseWeeklyReportJobData,
  parseCashbackRateWatchJobData,
  parseCashbackTermsWatchJobData,
  parseCashbackLpScoreJobData,
  parseCashbackRedirectCheckJobData,
  parseCashbackRateCompareJobData,
  parseAsinWatchJobData,
} from "./job-data.js";
import { getDefaultJobOptions } from "./producer.js";
import { processBudgetPacerJob } from "./budget-pacer-worker.js";
import { processCompetitorWatchJob } from "./competitor-watch-worker.js";
import { processConversionUploadJob } from "./conversion-upload-worker.js";
import { processDeadLinkJob } from "./dead-link-worker.js";
import { processKillSwitchJob } from "./kill-switch-worker.js";
import { processPayoutWatchJob } from "./payout-watch-worker.js";
import { processCashbackRateWatchJob } from "./cashback-rate-watch-worker.js";
import { processCashbackTermsWatchJob } from "./cashback-terms-watch-worker.js";
import { processCashbackLpScoreJob } from "./cashback-lp-score-worker.js";
import { processCashbackRedirectCheckJob } from "./cashback-redirect-check-worker.js";
import { processCashbackRateCompareJob } from "./cashback-rate-compare-worker.js";
import { processAsinWatchJob } from "./asin-watch-worker.js";
import {
  NETWORK_PULL_JOB_NAME,
  NETWORK_PULL_REPEAT_PATTERN,
  NETWORK_PULL_REPEAT_TZ,
  processNetworkPullJob,
} from "./network-pull-worker.js";
import {
  createPrismaTrackingLinkRotationWriter,
  processRotationJob,
} from "./rotation-worker.js";
import { processTrafficMonitorJob } from "./traffic-monitor-worker.js";
import { processUrlChangeJob } from "./url-change-worker.js";
import {
  WEEKLY_REPORT_JOB_NAME,
  WEEKLY_REPORT_REPEAT_PATTERN,
  WEEKLY_REPORT_REPEAT_TZ,
  processWeeklyReportJob,
} from "./weekly-report-worker.js";
import {
  getJobDefinition,
  throwTerminalForBullMq,
  type ProcessorRetryContext,
} from "./retry-policy.js";

export type WorkerStatus = "stopped" | "running";

export interface WorkerHealth {
  enabled: boolean;
  status: WorkerStatus;
}

export class WorkerJobError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "WorkerJobError";
    this.code = code;
  }
}

export interface WorkerRuntimeDeps {
  syncJobs: SyncJobRepository;
  urlChangeRequests: UrlChangeRequestService;
  orderConversions: OrderConversionService;
  /** Prisma client — required for the traffic monitor worker. */
  prisma?: PrismaClient;
  /** Optional logger — defaults to console. */
  log?: {
    info: (msg: string, meta?: Record<string, unknown>) => void;
    error: (msg: string, meta?: Record<string, unknown>) => void;
  };
}

export interface WorkerLike {
  close(force?: boolean): Promise<void>;
}

export interface WorkerRuntimeOptions {
  connection?: ConnectionOptions;
  /**
   * Inject workers (unit tests). When omitted, start() creates BullMQ Workers.
   * Importing this module never opens Redis — only start() does.
   */
  createWorkers?: (handlers: {
    urlChange: (job: Job<UrlChangeJobData>) => Promise<unknown>;
    conversionUpload: (
      job: Job<ConversionUploadJobData>
    ) => Promise<unknown>;
    trafficMonitor: (job: Job<TrafficMonitorJobData>) => Promise<unknown>;
    killSwitch: (job: Job<KillSwitchJobData>) => Promise<unknown>;
    competitorWatch: (
      job: Job<CompetitorWatchJobData>
    ) => Promise<unknown>;
    rotation: (job: Job<RotationJobData>) => Promise<unknown>;
    deadLink: (job: Job<DeadLinkJobData>) => Promise<unknown>;
    payoutWatch: (job: Job<PayoutWatchJobData>) => Promise<unknown>;
    budgetPacer: (job: Job<BudgetPacerJobData>) => Promise<unknown>;
    networkPull: (job: Job<NetworkPullJobData>) => Promise<unknown>;
    weeklyReport: (job: Job<WeeklyReportJobData>) => Promise<unknown>;
    cashbackRateWatch: (job: Job<CashbackRateWatchJobData>) => Promise<unknown>;
    cashbackTermsWatch: (job: Job<CashbackTermsWatchJobData>) => Promise<unknown>;
    cashbackLpScore: (job: Job<CashbackLpScoreJobData>) => Promise<unknown>;
    cashbackRedirectCheck: (job: Job<CashbackRedirectCheckJobData>) => Promise<unknown>;
    cashbackRateCompare: (job: Job<CashbackRateCompareJobData>) => Promise<unknown>;
    asinWatch: (job: Job<AsinWatchJobData>) => Promise<unknown>;
    connection: ConnectionOptions;
  }) => WorkerLike[];
  /** Graceful close wait (ms). BullMQ close waits for active jobs. */
  closeTimeoutMs?: number;
}

const defaultLog = {
  info: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) console.log(`[worker] ${msg}`, meta);
    else console.log(`[worker] ${msg}`);
  },
  error: (msg: string, meta?: Record<string, unknown>) => {
    if (meta) console.error(`[worker] ${msg}`, meta);
    else console.error(`[worker] ${msg}`);
  },
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function retryContextFromBullJob(
  job: Job,
  type: "urlChange" | "conversionUpload"
): ProcessorRetryContext {
  const defAttempts = getJobDefinition(type)?.defaultAttempts ?? 3;
  const maxAttempts =
    typeof job.opts.attempts === "number" && job.opts.attempts > 0
      ? job.opts.attempts
      : defAttempts;
  return {
    softRetryEnabled: true,
    attemptsMade: job.attemptsMade ?? 0,
    maxAttempts,
  };
}

/**
 * Phase 8.3.2/8.3.4 — BullMQ Worker runtime (urlChange + conversionUpload).
 * Does not open Redis until start(). Retry classification via retry-policy.ts.
 */
export class WorkerRuntime {
  private status: WorkerStatus = "stopped";
  private workers: WorkerLike[] = [];
  private schedulingQueues: Queue[] = [];
  private readonly log: NonNullable<WorkerRuntimeDeps["log"]>;
  private readonly closeTimeoutMs: number;
  private readonly connection: ConnectionOptions;
  private readonly createWorkers: NonNullable<WorkerRuntimeOptions["createWorkers"]>;
  /** True when tests inject createWorkers — skip Redis scheduling then. */
  private readonly workersInjected: boolean;

  constructor(
    private readonly deps: WorkerRuntimeDeps,
    options: WorkerRuntimeOptions = {}
  ) {
    this.log = deps.log ?? defaultLog;
    this.closeTimeoutMs = options.closeTimeoutMs ?? 30_000;
    this.connection = options.connection ?? createRedisConnection();
    this.workersInjected = options.createWorkers !== undefined;
    this.createWorkers =
      options.createWorkers ??
      ((handlers) => [
        new Worker<UrlChangeJobData>(
          QUEUE_NAMES.urlChange,
          (job) => handlers.urlChange(job),
          { connection: handlers.connection, concurrency: 2 }
        ),
        new Worker<ConversionUploadJobData>(
          QUEUE_NAMES.conversionUpload,
          (job) => handlers.conversionUpload(job),
          { connection: handlers.connection, concurrency: 2 }
        ),
        new Worker<TrafficMonitorJobData>(
          QUEUE_NAMES.trafficMonitor,
          (job) => handlers.trafficMonitor(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<KillSwitchJobData>(
          QUEUE_NAMES.killSwitch,
          (job) => handlers.killSwitch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CompetitorWatchJobData>(
          QUEUE_NAMES.competitorWatch,
          (job) => handlers.competitorWatch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<RotationJobData>(
          QUEUE_NAMES.rotation,
          (job) => handlers.rotation(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<WeeklyReportJobData>(
          QUEUE_NAMES.weeklyReport,
          (job) => handlers.weeklyReport(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<DeadLinkJobData>(
          QUEUE_NAMES.deadLink,
          (job) => handlers.deadLink(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<PayoutWatchJobData>(
          QUEUE_NAMES.payoutWatch,
          (job) => handlers.payoutWatch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<BudgetPacerJobData>(
          QUEUE_NAMES.budgetPacer,
          (job) => handlers.budgetPacer(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<NetworkPullJobData>(
          QUEUE_NAMES.networkPull,
          (job) => handlers.networkPull(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CashbackRateWatchJobData>(
          QUEUE_NAMES.cashbackRateWatch,
          (job) => handlers.cashbackRateWatch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CashbackTermsWatchJobData>(
          QUEUE_NAMES.cashbackTermsWatch,
          (job) => handlers.cashbackTermsWatch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CashbackLpScoreJobData>(
          QUEUE_NAMES.cashbackLpScore,
          (job) => handlers.cashbackLpScore(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CashbackRedirectCheckJobData>(
          QUEUE_NAMES.cashbackRedirectCheck,
          (job) => handlers.cashbackRedirectCheck(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<CashbackRateCompareJobData>(
          QUEUE_NAMES.cashbackRateCompare,
          (job) => handlers.cashbackRateCompare(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
        new Worker<AsinWatchJobData>(
          QUEUE_NAMES.asinWatch,
          (job) => handlers.asinWatch(job),
          { connection: handlers.connection, concurrency: 1 }
        ),
      ]);
  }

  getHealth(): WorkerHealth {
    return {
      enabled: true,
      status: this.status,
    };
  }

  getStatus(): WorkerStatus {
    return this.status;
  }

  /**
   * Dispatch by queue name — used by BullMQ handlers and unit tests (no Redis).
   */
  async dispatch(
    queueName: string,
    data: unknown,
    retry?: ProcessorRetryContext
  ): Promise<unknown> {
    try {
      if (queueName === QUEUE_NAMES.urlChange) {
        return await this.handleUrlChangeData(
          parseUrlChangeJobData(data),
          retry
        );
      }
      if (queueName === QUEUE_NAMES.conversionUpload) {
        return await this.handleConversionUploadData(
          parseConversionUploadJobData(data),
          retry
        );
      }
      if (queueName === QUEUE_NAMES.trafficMonitor) {
        return await this.handleTrafficMonitorData(
          parseTrafficMonitorJobData(data)
        );
      }
      if (queueName === QUEUE_NAMES.killSwitch) {
        return await this.handleKillSwitchData(parseKillSwitchJobData(data));
      }
      if (queueName === QUEUE_NAMES.competitorWatch) {
        return await this.handleCompetitorWatchData(
          parseCompetitorWatchJobData(data)
        );
      }
      if (queueName === QUEUE_NAMES.rotation) {
        return await this.handleRotationData(parseRotationJobData(data));
      }
      if (queueName === QUEUE_NAMES.deadLink) {
        return await this.handleDeadLinkData(parseDeadLinkJobData(data));
      }
      if (queueName === QUEUE_NAMES.payoutWatch) {
        return await this.handlePayoutWatchData(parsePayoutWatchJobData(data));
      }
      if (queueName === QUEUE_NAMES.budgetPacer) {
        return await this.handleBudgetPacerData(parseBudgetPacerJobData(data));
      }
      if (queueName === QUEUE_NAMES.networkPull) {
        return await this.handleNetworkPullData(parseNetworkPullJobData(data));
      }
      if (queueName === QUEUE_NAMES.weeklyReport) {
        return await this.handleWeeklyReportData(parseWeeklyReportJobData(data));
      }
      if (queueName === QUEUE_NAMES.cashbackRateWatch) {
        return await this.handleCashbackRateWatchData(parseCashbackRateWatchJobData(data));
      }
      if (queueName === QUEUE_NAMES.cashbackTermsWatch) {
        return await this.handleCashbackTermsWatchData(parseCashbackTermsWatchJobData(data));
      }
      if (queueName === QUEUE_NAMES.cashbackLpScore) {
        return await this.handleCashbackLpScoreData(parseCashbackLpScoreJobData(data));
      }
      if (queueName === QUEUE_NAMES.cashbackRedirectCheck) {
        return await this.handleCashbackRedirectCheckData(parseCashbackRedirectCheckJobData(data));
      }
      if (queueName === QUEUE_NAMES.cashbackRateCompare) {
        return await this.handleCashbackRateCompareData(parseCashbackRateCompareJobData(data));
      }
      if (queueName === QUEUE_NAMES.asinWatch) {
        return await this.handleAsinWatchData(parseAsinWatchJobData(data));
      }
      throw new WorkerJobError(
        "UNKNOWN_QUEUE",
        `Unsupported queue for Phase 8.3.2 worker: ${queueName}`
      );
    } catch (error) {
      if (error instanceof WorkerJobError) {
        throwTerminalForBullMq(error);
      }
      throw error;
    }
  }

  async start(): Promise<void> {
    if (this.status === "running") return;

    this.workers = this.createWorkers({
      connection: this.connection,
      urlChange: async (job) => {
        this.log.info("urlChange job received", {
          bullJobId: job.id,
          jobId: job.data.jobId,
          attemptsMade: job.attemptsMade,
        });
        return this.handleUrlChangeData(
          job.data,
          retryContextFromBullJob(job, "urlChange")
        );
      },
      conversionUpload: async (job) => {
        this.log.info("conversionUpload job received", {
          bullJobId: job.id,
          jobId: job.data.jobId,
          attemptsMade: job.attemptsMade,
        });
        return this.handleConversionUploadData(
          job.data,
          retryContextFromBullJob(job, "conversionUpload")
        );
      },
      trafficMonitor: async (job) => {
        this.log.info("trafficMonitor job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleTrafficMonitorData(job.data);
      },
      killSwitch: async (job) => {
        this.log.info("killSwitch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleKillSwitchData(job.data);
      },
      competitorWatch: async (job) => {
        this.log.info("competitorWatch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCompetitorWatchData(job.data);
      },
      rotation: async (job) => {
        this.log.info("rotation job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleRotationData(job.data);
      },
      deadLink: async (job) => {
        this.log.info("deadLink job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleDeadLinkData(job.data);
      },
      payoutWatch: async (job) => {
        this.log.info("payoutWatch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handlePayoutWatchData(job.data);
      },
      budgetPacer: async (job) => {
        this.log.info("budgetPacer job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleBudgetPacerData(job.data);
      },
      networkPull: async (job) => {
        this.log.info("networkPull job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleNetworkPullData(job.data);
      },
      weeklyReport: async (job) => {
        this.log.info("weeklyReport job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleWeeklyReportData(job.data);
      },
      cashbackRateWatch: async (job) => {
        this.log.info("cashbackRateWatch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCashbackRateWatchData(job.data);
      },
      cashbackTermsWatch: async (job) => {
        this.log.info("cashbackTermsWatch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCashbackTermsWatchData(job.data);
      },
      cashbackLpScore: async (job) => {
        this.log.info("cashbackLpScore job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCashbackLpScoreData(job.data);
      },
      cashbackRedirectCheck: async (job) => {
        this.log.info("cashbackRedirectCheck job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCashbackRedirectCheckData(job.data);
      },
      cashbackRateCompare: async (job) => {
        this.log.info("cashbackRateCompare job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleCashbackRateCompareData(job.data);
      },
      asinWatch: async (job) => {
        this.log.info("asinWatch job received", {
          bullJobId: job.id,
          triggeredBy: job.data.triggeredBy,
          attemptsMade: job.attemptsMade,
        });
        return this.handleAsinWatchData(job.data);
      },
    });

    // Hourly repeatable schedules (worker-owned; idempotent upsert by
    // repeat key). Skipped when workers are injected (unit tests).
    if (!this.workersInjected && this.deps.prisma) {
      await this.ensureTrafficMonitorSchedule();
      await this.ensureKillSwitchSchedule();
      await this.ensureCompetitorWatchSchedule();
      await this.ensureRotationSchedule();
      await this.ensureDeadLinkSchedule();
      await this.ensurePayoutWatchSchedule();
      await this.ensureBudgetPacerSchedule();
      await this.ensureNetworkPullSchedule();
      await this.ensureWeeklyReportSchedule();
      await this.ensureCashbackRateWatchSchedule();
      await this.ensureCashbackTermsWatchSchedule();
      await this.ensureCashbackLpScoreSchedule();
      await this.ensureCashbackRedirectCheckSchedule();
      await this.ensureCashbackRateCompareSchedule();
      await this.ensureAsinWatchSchedule();
    }

    this.status = "running";
    this.log.info("WorkerRuntime started", {
      queues: [
        QUEUE_NAMES.urlChange,
        QUEUE_NAMES.conversionUpload,
        QUEUE_NAMES.trafficMonitor,
        QUEUE_NAMES.killSwitch,
        QUEUE_NAMES.competitorWatch,
        QUEUE_NAMES.rotation,
        QUEUE_NAMES.deadLink,
        QUEUE_NAMES.payoutWatch,
        QUEUE_NAMES.budgetPacer,
        QUEUE_NAMES.networkPull,
        QUEUE_NAMES.weeklyReport,
      ],
    });
  }

  /**
   * Ensure the hourly traffic-monitor repeatable job exists.
   * Re-adding with the same name + repeat pattern upserts the definition.
   */
  private async ensureTrafficMonitorSchedule(): Promise<void> {
    const queue = new Queue<TrafficMonitorJobData>(
      QUEUE_NAMES.trafficMonitor,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "trafficMonitor",
      { type: "trafficMonitor", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("trafficMonitor"),
      }
    );
    this.log.info("trafficMonitor hourly schedule ensured");
  }

  /**
   * Ensure the hourly kill-switch repeatable job exists.
   * Re-adding with the same name + repeat pattern upserts the definition.
   */
  private async ensureKillSwitchSchedule(): Promise<void> {
    const queue = new Queue<KillSwitchJobData>(QUEUE_NAMES.killSwitch, {
      connection: this.connection,
    });
    this.schedulingQueues.push(queue);
    await queue.add(
      "killSwitch",
      { type: "killSwitch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("killSwitch"),
      }
    );
    this.log.info("killSwitch hourly schedule ensured");
  }

  /**
   * Ensure the hourly competitor-watch repeatable job exists.
   * Re-adding with the same name + repeat pattern upserts the definition.
   * The scan itself enforces per-watch checkInterval (>= 1h).
   */
  private async ensureCompetitorWatchSchedule(): Promise<void> {
    const queue = new Queue<CompetitorWatchJobData>(
      QUEUE_NAMES.competitorWatch,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "competitorWatch",
      { type: "competitorWatch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("competitorWatch"),
      }
    );
    this.log.info("competitorWatch hourly schedule ensured");
  }

  /**
   * Ensure the hourly rotation repeatable job exists.
   * Re-adding with the same name + repeat pattern upserts the definition.
   * The rotation itself enforces per-group minimum interval (>= 1h).
   */
  private async ensureRotationSchedule(): Promise<void> {
    const queue = new Queue<RotationJobData>(
      QUEUE_NAMES.rotation,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "rotation",
      { type: "rotation", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("rotation"),
      }
    );
    this.log.info("rotation hourly schedule ensured");
  }

  /**
   * Automation pack: hourly dead-link schedule.
   */
  private async ensureDeadLinkSchedule(): Promise<void> {
    const queue = new Queue<DeadLinkJobData>(
      QUEUE_NAMES.deadLink,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "dead-link-check",
      { type: "deadLink", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("deadLink"),
      }
    );
    this.log.info("deadLink hourly schedule ensured");
  }

  /**
   * Automation pack: daily payout-watch schedule.
   */
  private async ensurePayoutWatchSchedule(): Promise<void> {
    const queue = new Queue<PayoutWatchJobData>(
      QUEUE_NAMES.payoutWatch,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "payout-watch-check",
      { type: "payoutWatch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 0 * * *" },
        ...getDefaultJobOptions("payoutWatch"),
      }
    );
    this.log.info("payoutWatch daily schedule ensured");
  }

  /**
   * Network API framework: daily offer-pull schedule (03:00 America/New_York).
   */
  private async ensureNetworkPullSchedule(): Promise<void> {
    const queue = new Queue<NetworkPullJobData>(
      QUEUE_NAMES.networkPull,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      NETWORK_PULL_JOB_NAME,
      { type: "networkPull", triggeredBy: "schedule" },
      {
        repeat: {
          pattern: NETWORK_PULL_REPEAT_PATTERN,
          tz: NETWORK_PULL_REPEAT_TZ,
        },
        ...getDefaultJobOptions("networkPull"),
      }
    );
    this.log.info("networkPull daily schedule ensured");
  }

  /**
   * Automation round 2: weekly report schedule — Monday 08:00 America/New_York.
   * Re-adding with the same name + repeat pattern upserts the definition.
   */
  private async ensureWeeklyReportSchedule(): Promise<void> {
    const queue = new Queue<WeeklyReportJobData>(
      QUEUE_NAMES.weeklyReport,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      WEEKLY_REPORT_JOB_NAME,
      { type: "weeklyReport", triggeredBy: "schedule" },
      {
        repeat: {
          pattern: WEEKLY_REPORT_REPEAT_PATTERN,
          tz: WEEKLY_REPORT_REPEAT_TZ,
        },
        ...getDefaultJobOptions("weeklyReport"),
      }
    );
    this.log.info("weeklyReport Monday 8am NY schedule ensured");
  }

  /**
   * Cashback automation pack (2026-10-08): hourly rate-watch schedule.
   */
  private async ensureCashbackRateWatchSchedule(): Promise<void> {
    const queue = new Queue<CashbackRateWatchJobData>(
      QUEUE_NAMES.cashbackRateWatch,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "cashback-rate-watch-check",
      { type: "cashbackRateWatch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 * * * *" },
        ...getDefaultJobOptions("cashbackRateWatch"),
      }
    );
    this.log.info("cashbackRateWatch hourly schedule ensured");
  }

  /**
   * Cashback automation pack (2026-10-08): daily terms-watch schedule.
   */
  private async ensureCashbackTermsWatchSchedule(): Promise<void> {
    const queue = new Queue<CashbackTermsWatchJobData>(
      QUEUE_NAMES.cashbackTermsWatch,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "cashback-terms-watch-check",
      { type: "cashbackTermsWatch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 2 * * *" },
        ...getDefaultJobOptions("cashbackTermsWatch"),
      }
    );
    this.log.info("cashbackTermsWatch daily schedule ensured");
  }

  /**
   * Cashback automation pack (2026-10-08): weekly lp-score schedule (Sundays).
   */
  private async ensureCashbackLpScoreSchedule(): Promise<void> {
    const queue = new Queue<CashbackLpScoreJobData>(
      QUEUE_NAMES.cashbackLpScore,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "cashback-lp-score-check",
      { type: "cashbackLpScore", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 3 * * 0" },
        ...getDefaultJobOptions("cashbackLpScore"),
      }
    );
    this.log.info("cashbackLpScore weekly schedule ensured");
  }

  /**
   * Cashback automation pack (2026-10-08): daily redirect-check schedule.
   */
  private async ensureCashbackRedirectCheckSchedule(): Promise<void> {
    const queue = new Queue<CashbackRedirectCheckJobData>(
      QUEUE_NAMES.cashbackRedirectCheck,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "cashback-redirect-check-check",
      { type: "cashbackRedirectCheck", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 4 * * *" },
        ...getDefaultJobOptions("cashbackRedirectCheck"),
      }
    );
    this.log.info("cashbackRedirectCheck daily schedule ensured");
  }

  /**
   * Cashback automation pack (2026-10-08): daily rate-compare schedule.
   */
  private async ensureCashbackRateCompareSchedule(): Promise<void> {
    const queue = new Queue<CashbackRateCompareJobData>(
      QUEUE_NAMES.cashbackRateCompare,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "cashback-rate-compare-check",
      { type: "cashbackRateCompare", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 5 * * *" },
        ...getDefaultJobOptions("cashbackRateCompare"),
      }
    );
    this.log.info("cashbackRateCompare daily schedule ensured");
  }

  /**
   * Ensure the daily ASIN-watch snapshot schedule exists (03:00).
   * Re-adding with the same name + repeat pattern upserts the definition.
   */
  private async ensureAsinWatchSchedule(): Promise<void> {
    const queue = new Queue<AsinWatchJobData>(
      QUEUE_NAMES.asinWatch,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "asin-watch-daily",
      { type: "asinWatch", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 3 * * *" },
        ...getDefaultJobOptions("asinWatch"),
      }
    );
    this.log.info("asinWatch daily schedule ensured");
  }

  /**
   * Automation pack: daily budget-pacer schedule.
   */
  private async ensureBudgetPacerSchedule(): Promise<void> {
    const queue = new Queue<BudgetPacerJobData>(
      QUEUE_NAMES.budgetPacer,
      { connection: this.connection }
    );
    this.schedulingQueues.push(queue);
    await queue.add(
      "budget-pacer-evaluate",
      { type: "budgetPacer", triggeredBy: "schedule" },
      {
        repeat: { pattern: "0 0 * * *" },
        ...getDefaultJobOptions("budgetPacer"),
      }
    );
    this.log.info("budgetPacer daily schedule ensured");
  }

  async close(): Promise<void> {
    if (this.status === "stopped" && this.workers.length === 0) return;

    const workers = this.workers;
    this.workers = [];
    const schedulingQueues = this.schedulingQueues;
    this.schedulingQueues = [];
    this.status = "stopped";

    const closeAll = Promise.all([
      ...workers.map((w) => w.close()),
      ...schedulingQueues.map((q) => q.close()),
    ]);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closeAll,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  `WorkerRuntime close timed out after ${this.closeTimeoutMs}ms`
                )
              ),
            this.closeTimeoutMs
          );
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }

    this.log.info("WorkerRuntime closed");
  }

  private async handleUrlChangeData(
    data: UrlChangeJobData,
    retry?: ProcessorRetryContext
  ) {
    const syncJob = await this.authorizeJob(data);
    return processUrlChangeJob({
      syncJobs: this.deps.syncJobs,
      urlChangeRequests: this.deps.urlChangeRequests,
      tenantId: syncJob.tenantId!,
      requestId: data.requestId,
      jobId: data.jobId,
      idempotencyKey: data.idempotencyKey,
      retry: retry ?? {
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts: getJobDefinition("urlChange")?.defaultAttempts ?? 3,
      },
    });
  }

  private async handleConversionUploadData(
    data: ConversionUploadJobData,
    retry?: ProcessorRetryContext
  ) {
    const syncJob = await this.authorizeJob(data);
    return processConversionUploadJob({
      syncJobs: this.deps.syncJobs,
      orderConversions: this.deps.orderConversions,
      tenantId: syncJob.tenantId!,
      conversionId: data.conversionId,
      jobId: data.jobId,
      idempotencyKey: data.idempotencyKey,
      customerId: data.customerId,
      googleAccountId: data.googleAccountId,
      retry: retry ?? {
        softRetryEnabled: true,
        attemptsMade: 0,
        maxAttempts:
          getJobDefinition("conversionUpload")?.defaultAttempts ?? 3,
      },
    });
  }

  private async handleTrafficMonitorData(data: TrafficMonitorJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "trafficMonitor worker requires prisma persistence"
      );
    }
    return processTrafficMonitorJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleKillSwitchData(data: KillSwitchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "killSwitch worker requires prisma persistence"
      );
    }
    return processKillSwitchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleCompetitorWatchData(data: CompetitorWatchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "competitorWatch worker requires prisma persistence"
      );
    }
    return processCompetitorWatchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleDeadLinkData(data: DeadLinkJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "deadLink worker requires prisma persistence"
      );
    }
    return processDeadLinkJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handlePayoutWatchData(data: PayoutWatchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "payoutWatch worker requires prisma persistence"
      );
    }
    return processPayoutWatchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleNetworkPullData(data: NetworkPullJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "networkPull worker requires prisma persistence"
      );
    }
    return processNetworkPullJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleWeeklyReportData(data: WeeklyReportJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "weeklyReport worker requires prisma persistence"
      );
    }
    return processWeeklyReportJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      weekStart: data.weekStart ? new Date(data.weekStart) : undefined,
      weekEnd: data.weekEnd ? new Date(data.weekEnd) : undefined,
      log: this.log,
    });
  }

  private async handleCashbackRateWatchData(data: CashbackRateWatchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "cashbackRateWatch worker requires prisma persistence"
      );
    }
    return processCashbackRateWatchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleCashbackTermsWatchData(data: CashbackTermsWatchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "cashbackTermsWatch worker requires prisma persistence"
      );
    }
    return processCashbackTermsWatchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleCashbackLpScoreData(data: CashbackLpScoreJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "cashbackLpScore worker requires prisma persistence"
      );
    }
    return processCashbackLpScoreJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleCashbackRedirectCheckData(data: CashbackRedirectCheckJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "cashbackRedirectCheck worker requires prisma persistence"
      );
    }
    return processCashbackRedirectCheckJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleAsinWatchData(data: AsinWatchJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "asinWatch worker requires prisma persistence"
      );
    }
    return processAsinWatchJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleCashbackRateCompareData(data: CashbackRateCompareJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "cashbackRateCompare worker requires prisma persistence"
      );
    }
    return processCashbackRateCompareJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleBudgetPacerData(data: BudgetPacerJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "budgetPacer worker requires prisma persistence"
      );
    }
    return processBudgetPacerJob({
      prisma: this.deps.prisma,
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
      log: this.log,
    });
  }

  private async handleRotationData(data: RotationJobData) {
    if (!this.deps.prisma) {
      throw new WorkerJobError(
        "NO_PRISMA",
        "rotation worker requires prisma persistence"
      );
    }
    return processRotationJob({
      prisma: this.deps.prisma,
      trackingLinks: createPrismaTrackingLinkRotationWriter(this.deps.prisma),
      triggeredBy: data.triggeredBy,
      tenantId: data.tenantId,
    });
  }

  /**
   * job.data.tenantId is untrusted — SyncJob from repository is authority.
   */
  private async authorizeJob(
    data: AdLinkLabJobData
  ): Promise<SyncJob & { tenantId: string }> {
    const claimedTenantId = data.tenantId?.trim();
    if (!claimedTenantId) {
      throw new WorkerJobError("MALFORMED_JOB", "job.data.tenantId is required");
    }

    let syncJob: SyncJob | null = null;
    if (data.syncJobId) {
      syncJob = await this.deps.syncJobs.findById(data.syncJobId);
      if (!syncJob) {
        throw new WorkerJobError(
          "SYNC_JOB_NOT_FOUND",
          `SyncJob not found: ${data.syncJobId}`
        );
      }
    } else {
      syncJob =
        (await this.deps.syncJobs.findByJobId(data.jobId)) ??
        (await this.deps.syncJobs.findByIdempotencyKey(
          claimedTenantId,
          "SYNC_JOB",
          data.idempotencyKey
        ));
      if (!syncJob) {
        throw new WorkerJobError(
          "SYNC_JOB_NOT_FOUND",
          `SyncJob not found for jobId=${data.jobId}`
        );
      }
    }

    const authoritativeTenantId = syncJob.tenantId?.trim();
    if (!authoritativeTenantId) {
      throw new WorkerJobError(
        "TENANT_MISMATCH",
        "SyncJob is missing tenantId (authority)"
      );
    }
    if (authoritativeTenantId !== claimedTenantId) {
      this.log.error("tenant isolation failure — refusing job", {
        claimedTenantId,
        authoritativeTenantId,
        syncJobId: syncJob.id,
        jobId: data.jobId,
      });
      throw new WorkerJobError(
        "TENANT_MISMATCH",
        "job.data.tenantId does not match SyncJob.tenantId"
      );
    }

    const status = syncJob.status.toUpperCase();
    if (status === "CANCELLED") {
      throw new WorkerJobError(
        "SYNC_JOB_CANCELLED",
        `SyncJob ${syncJob.id} is CANCELLED`
      );
    }

    return { ...syncJob, tenantId: authoritativeTenantId };
  }
}

export function parseUrlChangeJobData(data: unknown): UrlChangeJobData {
  if (!isRecord(data)) {
    throw new WorkerJobError("MALFORMED_JOB", "urlChange job.data must be an object");
  }
  if (data.type !== undefined && data.type !== "urlChange") {
    throw new WorkerJobError("MALFORMED_JOB", "urlChange job.data.type mismatch");
  }
  const tenantId = requireString(data, "tenantId");
  const requestId = requireString(data, "requestId");
  const idempotencyKey = requireString(data, "idempotencyKey");
  const jobId = requireString(data, "jobId");
  const syncJobId =
    data.syncJobId === undefined || data.syncJobId === null
      ? undefined
      : requireString(data, "syncJobId");
  return {
    type: "urlChange",
    tenantId,
    requestId,
    idempotencyKey,
    jobId,
    syncJobId,
  };
}

export function parseConversionUploadJobData(
  data: unknown
): ConversionUploadJobData {
  if (!isRecord(data)) {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      "conversionUpload job.data must be an object"
    );
  }
  if (data.type !== undefined && data.type !== "conversionUpload") {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      "conversionUpload job.data.type mismatch"
    );
  }
  const tenantId = requireString(data, "tenantId");
  const conversionId = requireString(data, "conversionId");
  const idempotencyKey = requireString(data, "idempotencyKey");
  const jobId = requireString(data, "jobId");
  const syncJobId =
    data.syncJobId === undefined || data.syncJobId === null
      ? undefined
      : requireString(data, "syncJobId");
  const customerId =
    data.customerId === undefined || data.customerId === null
      ? undefined
      : String(data.customerId);
  const googleAccountId =
    data.googleAccountId === undefined || data.googleAccountId === null
      ? undefined
      : String(data.googleAccountId);
  return {
    type: "conversionUpload",
    tenantId,
    conversionId,
    idempotencyKey,
    jobId,
    syncJobId,
    customerId,
    googleAccountId,
  };
}

function requireString(
  data: Record<string, unknown>,
  key: string
): string {
  const value = data[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WorkerJobError(
      "MALFORMED_JOB",
      `job.data.${key} must be a non-empty string`
    );
  }
  return value;
}

export function createWorkerRuntime(
  deps: WorkerRuntimeDeps,
  options?: WorkerRuntimeOptions
): WorkerRuntime {
  return new WorkerRuntime(deps, options);
}

export function stoppedWorkerHealth(): WorkerHealth {
  return { enabled: false, status: "stopped" };
}
