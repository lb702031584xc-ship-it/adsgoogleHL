/**
 * Phase 4 Research Lab — self-owned test-site simulation.
 *
 * Given two preset HTML strings (e.g. served by your own test site), build
 * response snapshots and run the real detector + classifier over them. This
 * verifies the detection pipeline itself can catch differentials, without
 * touching any third-party site. Used by POST /api/v1/research/simulate and
 * by unit tests.
 */
import { createHash } from "node:crypto";
import { stripHtml } from "../ai/fetch-page.js";
import {
  bandForScore,
  compareResponses,
  scoreDifferential,
  type DifferentialBand,
  type DifferentialMetrics,
  type ResponseSnapshot,
} from "./detector.js";
import {
  classifyDifferential,
  type ClassifiedResponse,
  type ClassificationResult,
  type VariantDescriptor,
} from "./classifier.js";

export interface SimulatedHtmlInput {
  htmlA: string;
  htmlB: string;
  nameA?: string;
  nameB?: string;
  variantA?: VariantDescriptor;
  variantB?: VariantDescriptor;
  finalUrlA?: string;
  finalUrlB?: string;
  httpStatusA?: number;
  httpStatusB?: number;
  headersA?: Record<string, string>;
  headersB?: Record<string, string>;
}

export interface SimulationReport {
  metrics: DifferentialMetrics;
  score: number;
  band: DifferentialBand;
  classification: ClassificationResult;
  snapshots: { a: ResponseSnapshot; b: ResponseSnapshot };
}

function countTag(html: string, tag: string): number {
  const re = new RegExp(`<${tag}[\\s>]`, "gi");
  let n = 0;
  while (re.exec(html) !== null && n < 100_000) n += 1;
  return n;
}

function snapshotFromHtml(
  name: string,
  html: string,
  opts: {
    finalUrl?: string;
    httpStatus?: number;
    headers?: Record<string, string>;
  } = {}
): ResponseSnapshot {
  const text = stripHtml(html);
  return {
    variantName: name,
    httpStatus: opts.httpStatus ?? 200,
    finalUrl: opts.finalUrl ?? null,
    redirectChain: [],
    headers: opts.headers ?? {},
    htmlHash: createHash("sha256").update(html, "utf8").digest("hex"),
    contentHash: createHash("sha256").update(text, "utf8").digest("hex"),
    textExcerpt: text.slice(0, 500) || null,
    linksCount: countTag(html, "a"),
    scriptsCount: countTag(html, "script"),
  };
}

/** Run the full detect → score → classify pipeline on two HTML strings. */
export function simulateHtmlComparison(
  input: SimulatedHtmlInput
): SimulationReport {
  const nameA = input.nameA ?? "variant-a";
  const nameB = input.nameB ?? "variant-b";
  const snapA = snapshotFromHtml(nameA, input.htmlA, {
    finalUrl: input.finalUrlA,
    httpStatus: input.httpStatusA,
    headers: input.headersA,
  });
  const snapB = snapshotFromHtml(nameB, input.htmlB, {
    finalUrl: input.finalUrlB,
    httpStatus: input.httpStatusB,
    headers: input.headersB,
  });
  const a: ClassifiedResponse = {
    ...snapA,
    userAgent: input.variantA?.userAgent,
    acceptLanguage: input.variantA?.acceptLanguage,
  };
  const b: ClassifiedResponse = {
    ...snapB,
    userAgent: input.variantB?.userAgent,
    acceptLanguage: input.variantB?.acceptLanguage,
  };
  const metrics = compareResponses(snapA, snapB);
  const score = scoreDifferential(metrics);
  return {
    metrics,
    score,
    band: bandForScore(score),
    classification: classifyDifferential(a, b, metrics),
    snapshots: { a: snapA, b: snapB },
  };
}
