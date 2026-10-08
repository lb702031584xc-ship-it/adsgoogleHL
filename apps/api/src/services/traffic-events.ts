import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@adlinklab/database";

/**
 * Phase 2 Traffic Intelligence — append-only traffic event journal.
 *
 * Chain: AD_CLICK → [LANDING_PAGE_VIEW] → AFFILIATE_CLICK → [MERCHANT_VISIT]
 *        → CONVERSION → [COMMISSION]
 *
 * Iron rule: event writes are best-effort. A journal failure must NEVER throw
 * into the main click / conversion flow — it is logged and swallowed.
 * Every event is observed data (dataQuality is always "OBSERVED"); values are
 * only recorded when real, never invented.
 *
 * Contract frozen (consumed by API/Web workers) — do not rename fields:
 *   { id, parentEventId, eventType, clickId, conversionId, trackingLinkId,
 *     timestamp(ISO), source, destination, metadata, dataQuality: "OBSERVED" }
 */

export const TRAFFIC_EVENT_TYPES = [
  "AD_CLICK",
  "LANDING_PAGE_VIEW",
  "AFFILIATE_CLICK",
  "MERCHANT_VISIT",
  "CONVERSION",
  "COMMISSION",
] as const;

export type TrafficEventType = (typeof TRAFFIC_EVENT_TYPES)[number];

export type TrafficEventMetadata = Record<
  string,
  string | number | boolean | null
>;

/** Frozen event DTO — consumed by the API and Web workers. */
export interface TrafficEventDto {
  id: string;
  parentEventId: string | null;
  eventType: TrafficEventType;
  clickId: string | null;
  conversionId: string | null;
  trackingLinkId: string | null;
  /** ISO-8601 */
  timestamp: string;
  source: string | null;
  destination: string | null;
  metadata: TrafficEventMetadata;
  dataQuality: "OBSERVED";
}

export interface RecordTrafficEventInput {
  tenantId: string;
  parentEventId?: string | null;
  eventType: TrafficEventType;
  clickId?: string | null;
  conversionId?: string | null;
  trackingLinkId?: string | null;
  timestamp?: Date;
  source?: string | null;
  destination?: string | null;
  metadata?: TrafficEventMetadata | null;
}

export interface TrafficEventCreateData {
  id: string;
  tenantId: string;
  parentEventId: string | null;
  eventType: TrafficEventType;
  clickId: string | null;
  conversionId: string | null;
  trackingLinkId: string | null;
  timestamp: Date;
  source: string | null;
  destination: string | null;
  metadata: TrafficEventMetadata | null;
}

export interface TrafficEventRow extends TrafficEventCreateData {
  createdAt: Date;
  deletedAt: Date | null;
}

/** Minimal persistence port — Prisma in production, in-memory in tests. */
export interface TrafficEventStore {
  create(data: TrafficEventCreateData): Promise<TrafficEventRow>;
  listByClick(tenantId: string, clickId: string): Promise<TrafficEventRow[]>;
}

export class PrismaTrafficEventStore implements TrafficEventStore {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: TrafficEventCreateData): Promise<TrafficEventRow> {
    const row = await this.prisma.trafficEvent.create({
      data: {
        id: data.id,
        tenantId: data.tenantId,
        parentEventId: data.parentEventId,
        eventType: data.eventType,
        clickId: data.clickId,
        conversionId: data.conversionId,
        trackingLinkId: data.trackingLinkId,
        timestamp: data.timestamp,
        source: data.source,
        destination: data.destination,
        metadata: data.metadata ?? undefined,
      },
    });
    return {
      id: row.id,
      tenantId: row.tenantId,
      parentEventId: row.parentEventId,
      eventType: row.eventType,
      clickId: row.clickId,
      conversionId: row.conversionId,
      trackingLinkId: row.trackingLinkId,
      timestamp: row.timestamp,
      source: row.source,
      destination: row.destination,
      metadata: (row.metadata ?? null) as TrafficEventMetadata | null,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    };
  }

  async listByClick(
    tenantId: string,
    clickId: string
  ): Promise<TrafficEventRow[]> {
    const rows = await this.prisma.trafficEvent.findMany({
      where: { tenantId, clickId, deletedAt: null },
      orderBy: { timestamp: "asc" },
    });
    return rows.map((row) => ({
      id: row.id,
      tenantId: row.tenantId,
      parentEventId: row.parentEventId,
      eventType: row.eventType,
      clickId: row.clickId,
      conversionId: row.conversionId,
      trackingLinkId: row.trackingLinkId,
      timestamp: row.timestamp,
      source: row.source,
      destination: row.destination,
      metadata: (row.metadata ?? null) as TrafficEventMetadata | null,
      createdAt: row.createdAt,
      deletedAt: row.deletedAt,
    }));
  }
}

export class InMemoryTrafficEventStore implements TrafficEventStore {
  private readonly rows = new Map<string, TrafficEventRow>();

  async create(data: TrafficEventCreateData): Promise<TrafficEventRow> {
    const row: TrafficEventRow = {
      ...data,
      createdAt: new Date(),
      deletedAt: null,
    };
    this.rows.set(row.id, row);
    return row;
  }

  async listByClick(
    tenantId: string,
    clickId: string
  ): Promise<TrafficEventRow[]> {
    return [...this.rows.values()]
      .filter(
        (r) =>
          r.tenantId === tenantId && r.clickId === clickId && !r.deletedAt
      )
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }

  /** Test helper. */
  clear(): void {
    this.rows.clear();
  }
}

export interface TrafficEventLogger {
  warn(message: string, meta?: Record<string, unknown>): void;
}

const defaultLogger: TrafficEventLogger = {
  warn: (message, meta) => {
    if (meta) console.warn(`[traffic-events] ${message}`, meta);
    else console.warn(`[traffic-events] ${message}`);
  },
};

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toDto(row: TrafficEventRow): TrafficEventDto {
  return {
    id: row.id,
    parentEventId: row.parentEventId,
    eventType: row.eventType,
    clickId: row.clickId,
    conversionId: row.conversionId,
    trackingLinkId: row.trackingLinkId,
    timestamp: row.timestamp.toISOString(),
    source: row.source,
    destination: row.destination,
    metadata: (row.metadata ?? {}) as TrafficEventMetadata,
    dataQuality: "OBSERVED",
  };
}

export interface ClickChainInput {
  tenantId: string;
  clickId: string;
  trackingLinkId: string;
  /** Real click occurrence time. */
  timestamp: Date;
  /** Real HTTP referer, or null when absent. */
  referer?: string | null;
  /** Real inbound request URL, or null when unknown — never fabricated. */
  requestUrl?: string | null;
  landingPageId?: string | null;
  /** Real landing page URL, or null when unknown. */
  landingPageUrl?: string | null;
  /** Real redirect URL from the click result. */
  redirectUrl: string;
}

export interface MerchantVisitInput {
  tenantId: string;
  clickId: string;
  trackingLinkId?: string | null;
  /** Real merchant URL visited, or null when unknown. */
  destination?: string | null;
  source?: string | null;
  metadata?: TrafficEventMetadata | null;
}

export interface ConversionChainInput {
  tenantId: string;
  clickId: string;
  conversionId: string;
  trackingLinkId?: string | null;
  /** Real conversion time. */
  timestamp: Date;
  /** Merchant-related real identifier (e.g. merchant business order id), or null. */
  source?: string | null;
  conversionAction: string;
  /** Decimal string — never float. Absent → no COMMISSION event. */
  value?: string | null;
  currency?: string | null;
}

/** Latest-first preference for conversion parents (deepest chain event wins). */
const CONVERSION_PARENT_TYPES: TrafficEventType[] = [
  "MERCHANT_VISIT",
  "AFFILIATE_CLICK",
  "LANDING_PAGE_VIEW",
  "AD_CLICK",
];

export class TrafficEventService {
  constructor(
    private readonly store: TrafficEventStore,
    private readonly logger: TrafficEventLogger = defaultLogger
  ) {}

  /**
   * Record a single event. NEVER throws — returns null when the write fails
   * so the main flow is never affected.
   */
  async recordTrafficEvent(
    input: RecordTrafficEventInput
  ): Promise<TrafficEventDto | null> {
    try {
      const row = await this.store.create({
        id: randomUUID(),
        tenantId: input.tenantId,
        parentEventId: input.parentEventId ?? null,
        eventType: input.eventType,
        clickId: input.clickId ?? null,
        conversionId: input.conversionId ?? null,
        trackingLinkId: input.trackingLinkId ?? null,
        timestamp: input.timestamp ?? new Date(),
        source: input.source ?? null,
        destination: input.destination ?? null,
        metadata: input.metadata ?? null,
      });
      return toDto(row);
    } catch (error) {
      this.logger.warn("record_failed", {
        eventType: input.eventType,
        tenantId: input.tenantId,
        clickId: input.clickId ?? null,
        error: toMessage(error),
      });
      return null;
    }
  }

  /**
   * Latest event of a click among the given types: the deepest event in the
   * parent chain (chain order is the tie-breaker, not wall-clock timestamps,
   * which can tie at millisecond resolution). Never throws — null on failure.
   */
  async findLatestEvent(
    tenantId: string,
    clickId: string,
    eventTypes?: TrafficEventType[]
  ): Promise<TrafficEventDto | null> {
    try {
      const chain = await this.getEventChain(tenantId, clickId);
      const filtered = eventTypes
        ? chain.filter((d) => eventTypes.includes(d.eventType))
        : chain;
      return filtered.length > 0 ? filtered[filtered.length - 1] : null;
    } catch (error) {
      this.logger.warn("find_latest_failed", {
        tenantId,
        clickId,
        error: toMessage(error),
      });
      return null;
    }
  }

  /**
   * Full event chain for a click, ordered root → leaf by following
   * parentEventId links (each depth level timestamp-ordered).
   */
  async getEventChain(
    tenantId: string,
    clickId: string
  ): Promise<TrafficEventDto[]> {
    const rows = await this.store.listByClick(tenantId, clickId);
    const dtos = rows.map(toDto);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    const children = new Map<string | null, TrafficEventDto[]>();
    for (const dto of dtos) {
      const key =
        dto.parentEventId && byId.has(dto.parentEventId)
          ? dto.parentEventId
          : null;
      const list = children.get(key) ?? [];
      list.push(dto);
      children.set(key, list);
    }
    for (const list of children.values()) {
      // Stable for timestamp ties (insertion order = causal order).
      list.sort((a, b) =>
        a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0
      );
    }
    const ordered: TrafficEventDto[] = [];
    const visit = (parentId: string | null): void => {
      for (const child of children.get(parentId) ?? []) {
        ordered.push(child);
        visit(child.id);
      }
    };
    visit(null);
    return ordered;
  }

  /**
   * Click redirect chain: AD_CLICK → [LANDING_PAGE_VIEW] → AFFILIATE_CLICK.
   * Never throws.
   */
  async emitClickChain(input: ClickChainInput): Promise<void> {
    try {
      const adClick = await this.recordTrafficEvent({
        tenantId: input.tenantId,
        parentEventId: null,
        eventType: "AD_CLICK",
        clickId: input.clickId,
        trackingLinkId: input.trackingLinkId,
        timestamp: input.timestamp,
        source: input.referer ?? null,
        destination: input.requestUrl ?? null,
      });

      let parent: TrafficEventDto | null = adClick;
      if (input.landingPageId && input.landingPageUrl) {
        const lpView = await this.recordTrafficEvent({
          tenantId: input.tenantId,
          parentEventId: parent?.id ?? null,
          eventType: "LANDING_PAGE_VIEW",
          clickId: input.clickId,
          trackingLinkId: input.trackingLinkId,
          source: input.requestUrl ?? null,
          destination: input.landingPageUrl,
        });
        if (lpView) parent = lpView;
      }

      await this.recordTrafficEvent({
        tenantId: input.tenantId,
        parentEventId: parent?.id ?? null,
        eventType: "AFFILIATE_CLICK",
        clickId: input.clickId,
        trackingLinkId: input.trackingLinkId,
        source: input.landingPageUrl ?? null,
        destination: input.redirectUrl,
      });
    } catch (error) {
      this.logger.warn("emit_click_chain_failed", {
        tenantId: input.tenantId,
        clickId: input.clickId,
        error: toMessage(error),
      });
    }
  }

  /**
   * Merchant visit — the user reached the merchant after the affiliate click.
   * Parent is the deepest click-chain event (AFFILIATE_CLICK preferred).
   * Never throws — returns null on failure.
   */
  async emitMerchantVisit(
    input: MerchantVisitInput
  ): Promise<TrafficEventDto | null> {
    try {
      const parent = await this.findLatestEvent(
        input.tenantId,
        input.clickId,
        ["AFFILIATE_CLICK", "LANDING_PAGE_VIEW", "AD_CLICK"]
      );
      return await this.recordTrafficEvent({
        tenantId: input.tenantId,
        parentEventId: parent?.id ?? null,
        eventType: "MERCHANT_VISIT",
        clickId: input.clickId,
        trackingLinkId: input.trackingLinkId ?? null,
        source: input.source ?? null,
        destination: input.destination ?? null,
        metadata: input.metadata ?? null,
      });
    } catch (error) {
      this.logger.warn("emit_merchant_visit_failed", {
        tenantId: input.tenantId,
        clickId: input.clickId,
        error: toMessage(error),
      });
      return null;
    }
  }

  /**
   * Conversion chain: CONVERSION → [COMMISSION when value is present].
   * CONVERSION's parent is the deepest click event (MERCHANT_VISIT when the
   * visit was recorded, else the latest AFFILIATE_CLICK, else AD_CLICK).
   * Never throws.
   */
  async emitConversionChain(input: ConversionChainInput): Promise<void> {
    try {
      const parent = await this.findLatestEvent(
        input.tenantId,
        input.clickId,
        CONVERSION_PARENT_TYPES
      );
      const metadata: TrafficEventMetadata = {
        conversionAction: input.conversionAction,
      };
      if (input.value != null) metadata.value = input.value;
      if (input.currency != null) metadata.currency = input.currency;

      const conversion = await this.recordTrafficEvent({
        tenantId: input.tenantId,
        parentEventId: parent?.id ?? null,
        eventType: "CONVERSION",
        clickId: input.clickId,
        conversionId: input.conversionId,
        trackingLinkId: input.trackingLinkId ?? null,
        timestamp: input.timestamp,
        source: input.source ?? null,
        metadata,
      });

      if (input.value != null && conversion) {
        const commissionMetadata: TrafficEventMetadata = {
          value: input.value,
        };
        if (input.currency != null)
          commissionMetadata.currency = input.currency;
        await this.recordTrafficEvent({
          tenantId: input.tenantId,
          parentEventId: conversion.id,
          eventType: "COMMISSION",
          clickId: input.clickId,
          conversionId: input.conversionId,
          trackingLinkId: input.trackingLinkId ?? null,
          timestamp: input.timestamp,
          metadata: commissionMetadata,
        });
      }
    } catch (error) {
      this.logger.warn("emit_conversion_chain_failed", {
        tenantId: input.tenantId,
        clickId: input.clickId,
        conversionId: input.conversionId,
        error: toMessage(error),
      });
    }
  }
}
