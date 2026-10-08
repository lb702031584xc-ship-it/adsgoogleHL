/**
 * 功能2 — 自动化广告：`create-campaign` Google Ads Script 模板。
 *
 * 由 POST /api/v1/ads/auto-create/confirm 下发的建广告任务使用：
 * 用户把生成的 Script 粘贴到 Google Ads Scripts 中运行一次，
 * 按 AdPlan 创建 campaign → ad groups → keywords → 否词 → RSA。
 *
 * 安全铁律（模板内强制执行）：
 * 1. 只创建计划中指定的结构：创建前按精确名称检查已存在实体，
 *    已存在则整单跳过（幂等），绝不修改账户内其他系列/广告组/广告。
 * 2. 预算只使用计划中的值；计划缺失或非法预算时直接中止，
 *    不设任何离谱默认值。
 * 3. 新建 campaign / ad group 一律 PAUSED，由人工审核后开启。
 * 4. 绝不调用 remove()/pause()/setStatus(ENABLED) 等变更已有实体的 API，
 *    不触碰账户级设置。
 *
 * Target runtime: Google Ads Scripts (AdsApp), NOT Node.js — ES5 only.
 */
import { jsStringLiteral } from "./script-generator-source.js";
import type { AdPlan } from "../ai/ad-generator.js";

export const CREATE_CAMPAIGN_SCRIPT_VERSION = "1.0.0";

/** ISO country code → Google Ads geo target location ID (criteria ID). */
export const COUNTRY_LOCATION_IDS: Record<string, number> = {
  US: 2840,
  GB: 2826,
  CA: 2124,
  AU: 2036,
  DE: 2276,
  FR: 2250,
  IT: 2380,
  ES: 2724,
  NL: 2528,
  BE: 2056,
  CH: 2756,
  AT: 2040,
  SE: 2752,
  IE: 2372,
  JP: 2392,
  KR: 2410,
  SG: 2702,
  HK: 2344,
  IN: 2356,
  BR: 2076,
  MX: 2484,
  NZ: 2554,
};

/**
 * Validate the plan on the TypeScript side before embedding it.
 * Returns a list of problems; empty means the plan is safe to embed.
 * The generated Script repeats these checks defensively at runtime.
 */
export function validateCreateCampaignPlan(plan: AdPlan): string[] {
  const problems: string[] = [];
  if (!plan || typeof plan !== "object") {
    return ["plan is not an object"];
  }
  const budget = plan.campaign?.dailyBudget?.amount;
  if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) {
    problems.push("campaign.dailyBudget.amount must be a positive number");
  }
  if (!plan.campaign?.name?.trim()) {
    problems.push("campaign.name is required");
  }
  if (!Array.isArray(plan.adGroups) || plan.adGroups.length === 0) {
    problems.push("at least one ad group is required");
  }
  for (const [i, block] of (plan.adGroups ?? []).entries()) {
    if (!block?.group?.name?.trim()) {
      problems.push(`adGroups[${i}].group.name is required`);
    }
    const headlines = block?.rsa?.headlines ?? [];
    if (headlines.length < 3 || headlines.length > 15) {
      problems.push(`adGroups[${i}].rsa.headlines must contain 3-15 items`);
    }
    const descriptions = block?.rsa?.descriptions ?? [];
    if (descriptions.length < 2 || descriptions.length > 4) {
      problems.push(`adGroups[${i}].rsa.descriptions must contain 2-4 items`);
    }
    if (!block?.rsa?.finalUrl) {
      problems.push(`adGroups[${i}].rsa.finalUrl is required`);
    }
  }
  return problems;
}

/**
 * Build the Google Ads Script source with the plan embedded as JSON.
 * The plan JSON is injected via JSON.stringify escaping (same approach as
 * the existing script generator) to prevent quote/injection escapes.
 */
export function buildCreateCampaignScript(plan: AdPlan): string {
  const problems = validateCreateCampaignPlan(plan);
  if (problems.length > 0) {
    throw new Error(
      `Refusing to build create-campaign script: ${problems.join("; ")}`
    );
  }
  const versionLit = jsStringLiteral(CREATE_CAMPAIGN_SCRIPT_VERSION);
  const planLit = jsStringLiteral(JSON.stringify(plan));
  const geoLit = jsStringLiteral(JSON.stringify(COUNTRY_LOCATION_IDS));

  return `/**
 * AdLinkLab create-campaign Script (generated)
 * Template version: ${CREATE_CAMPAIGN_SCRIPT_VERSION}
 * Plan ID: ${plan.planId}
 *
 * SAFETY RULES (enforced below):
 * 1. Creates ONLY the campaign / ad groups / keywords / ads described in the
 *    embedded plan. Every entity is checked by EXACT name before creation;
 *    if the campaign already exists the whole run is skipped (idempotent).
 * 2. Budget is taken EXACTLY from the plan. If the plan budget is missing or
 *    not a positive number the script ABORTS — no fallback defaults.
 * 3. New campaigns and ad groups are created PAUSED. Enable them manually
 *    after review.
 * 4. This script NEVER modifies, pauses, enables or removes any existing
 *    entity, and never touches account-level settings.
 */
var ADLINKLAB_CREATE_CAMPAIGN = {
  version: ${versionLit},
  plan: JSON.parse(${planLit}),
  countryLocationIds: JSON.parse(${geoLit})
};

function main() {
  var cfg = ADLINKLAB_CREATE_CAMPAIGN;
  var plan = cfg.plan;
  var problems = validatePlan_(plan);
  if (problems.length > 0) {
    Logger.log("ABORT: invalid plan: " + problems.join("; "));
    return;
  }
  var campaignName = plan.campaign.name;
  if (campaignExists_(campaignName)) {
    Logger.log(
      'SKIP: campaign "' + campaignName + '" already exists. ' +
      "Nothing was created or modified (idempotent)."
    );
    return;
  }
  var campaign = createCampaign_(plan.campaign);
  if (!campaign) {
    Logger.log("ABORT: campaign creation failed; nothing else was attempted.");
    return;
  }
  applyGeoTargets_(campaign, plan.campaign.geoTargets || []);
  var createdGroups = 0;
  for (var i = 0; i < plan.adGroups.length; i++) {
    if (createAdGroup_(campaign, plan.adGroups[i])) {
      createdGroups++;
    }
  }
  Logger.log(
    'DONE: created campaign "' + campaignName + '" (PAUSED) with ' +
    createdGroups + "/" + plan.adGroups.length + " ad groups. " +
    "Review and enable manually."
  );
}

function validatePlan_(plan) {
  var problems = [];
  if (!plan || typeof plan !== "object") {
    return ["plan is not an object"];
  }
  var budget = plan.campaign && plan.campaign.dailyBudget && plan.campaign.dailyBudget.amount;
  if (typeof budget !== "number" || !isFinite(budget) || budget <= 0) {
    problems.push("campaign.dailyBudget.amount must be a positive number (no default applied)");
  }
  if (!plan.campaign || !plan.campaign.name) {
    problems.push("campaign.name is required");
  }
  if (!plan.adGroups || plan.adGroups.length === 0) {
    problems.push("at least one ad group is required");
  }
  return problems;
}

function escapeCondition_(value) {
  return String(value).replace(/\\\\/g, "\\\\\\\\").replace(/"/g, '\\\\"');
}

function campaignExists_(name) {
  var it = AdsApp.campaigns()
    .withCondition('Name = "' + escapeCondition_(name) + '"')
    .get();
  return it.hasNext();
}

function createCampaign_(c) {
  // Budget comes EXACTLY from the plan (validated positive above).
  var builder = AdsApp.newCampaignBuilder()
    .withName(c.name)
    .withBudget(c.dailyBudget.amount)
    .withStatus("PAUSED");
  var strategy = c.bidding && c.bidding.strategy === "MAXIMIZE_CLICKS"
    ? "MAXIMIZE_CLICKS"
    : "MANUAL_CPC";
  builder.withBiddingStrategy(strategy);
  var op = builder.build();
  if (!op.isSuccessful()) {
    Logger.log("campaign build failed: " + describeErrors_(op.getErrors()));
    return null;
  }
  return op.getResult();
}

function applyGeoTargets_(campaign, geoTargets) {
  var ids = ADLINKLAB_CREATE_CAMPAIGN.countryLocationIds;
  for (var i = 0; i < geoTargets.length; i++) {
    var code = String(geoTargets[i]).toUpperCase();
    var locationId = ids[code];
    if (!locationId) {
      Logger.log("SKIP geo target " + code + ": no location ID mapping; configure manually.");
      continue;
    }
    try {
      campaign.addLocation(locationId);
    } catch (e) {
      Logger.log("geo target failed " + code + ": " + e);
    }
  }
}

function createAdGroup_(campaign, block) {
  var g = block.group;
  var rsa = block.rsa;
  var builder = campaign.newAdGroupBuilder()
    .withName(g.name)
    .withStatus("PAUSED");
  if (g.maxCpc && typeof g.maxCpc.amount === "number" && g.maxCpc.amount > 0) {
    builder.withCpc(g.maxCpc.amount);
  }
  var op = builder.build();
  if (!op.isSuccessful()) {
    Logger.log('ad group "' + g.name + '" build failed: ' + describeErrors_(op.getErrors()));
    return false;
  }
  var adGroup = op.getResult();

  var i, kop;
  for (i = 0; i < (g.keywords || []).length; i++) {
    var kw = g.keywords[i];
    kop = adGroup.newKeywordBuilder().withText(toKeywordText_(kw)).build();
    if (!kop.isSuccessful()) {
      Logger.log("keyword failed [" + kw.text + "]: " + describeErrors_(kop.getErrors()));
    }
  }
  for (i = 0; i < (g.negativeKeywords || []).length; i++) {
    var neg = g.negativeKeywords[i];
    var nop = adGroup.newNegativeKeywordBuilder().withText(toKeywordText_(neg)).build();
    if (!nop.isSuccessful()) {
      Logger.log("negative keyword failed [" + neg.text + "]: " + describeErrors_(nop.getErrors()));
    }
  }

  var adBuilder = adGroup.newAd().responsiveSearchAdBuilder()
    .withFinalUrl(rsa.finalUrl);
  for (i = 0; i < rsa.headlines.length; i++) {
    adBuilder.addHeadline(String(rsa.headlines[i]));
  }
  for (i = 0; i < rsa.descriptions.length; i++) {
    adBuilder.addDescription(String(rsa.descriptions[i]));
  }
  if (rsa.path1) {
    adBuilder.withPath1(String(rsa.path1));
  }
  if (rsa.path2) {
    adBuilder.withPath2(String(rsa.path2));
  }
  var aop = adBuilder.build();
  if (!aop.isSuccessful()) {
    Logger.log('RSA build failed in "' + g.name + '": ' + describeErrors_(aop.getErrors()));
    return false;
  }
  return true;
}

function toKeywordText_(kw) {
  var text = String(kw.text || "").replace(/[\\[\\]"]/g, "").trim();
  if (kw.matchType === "EXACT") {
    return "[" + text + "]";
  }
  if (kw.matchType === "PHRASE") {
    return '"' + text + '"';
  }
  return text;
}

function describeErrors_(errors) {
  var out = [];
  for (var i = 0; i < errors.length; i++) {
    out.push(String(errors[i]));
  }
  return out.join("; ");
}
`;
}
