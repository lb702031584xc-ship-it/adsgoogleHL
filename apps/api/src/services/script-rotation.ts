/**
 * 方案 B — 直链多广告轮流启停 Script 生成器。
 *
 * 原理：为同一 Offer 建 N 条广告（每条填不同的直链 Final URL），
 * 打上同一个标签（如 "1"）。Script 每次运行时，
 * 先把这些广告所在的广告组全部启用，再按实时状态轮换广告：
 * 只启用当前启用广告的下一条，其余全部暂停。
 *
 * 为什么用启停而不是改 URL：
 * - 改 Final URL 会触发 Google 重新审核；启停广告不触发 URL 审核。
 * - 切换是即时的，不需要等审核。
 *
 * v1.2.0 说明：
 * - 不靠计数器：v1.0.0 把轮换下标存在 PropertiesService 里，预览运行
 *   也会推进下标，导致正式运行又启用本来就启用的广告、看起来像没换。
 *   v1.2.0 直接按实时状态找当前启用的广告、开它的下一条，预览不会
 *   打乱顺序。
 * - 每轮启用广告组：暂停的广告组里的广告即使本身已启用也不会展示，
 *   所以每次运行先把这些广告所在的广告组全部启用。
 * - 要停某条广告：停广告本身，别停它的广告组，否则脚本每小时会把
 *   广告组再启用回来。
 *
 * 使用方式：用户在 Google Ads → 工具 → 脚本 中粘贴生成的代码，
 * 设置每小时（或自定义频率）运行一次。
 */

export const ROTATION_SCRIPT_VERSION = "1.2.0";

export interface RotationScriptInput {
  /** 标签名，用于标识同一轮换组的所有广告，如 "1" */
  label: string;
  /** 轮换策略：round_robin（默认） */
  strategy?: string;
}

/**
 * 生成 Google Ads Script 源代码。
 * Script 逻辑：
 * 1. 找出所有带指定标签的已启用/已暂停广告
 * 2. 按广告组名、广告 ID 排序（保证顺序稳定）
 * 3. 把这些广告所在的广告组全部启用（暂停的组里广告不展示）
 * 4. 按实时状态找当前启用的广告，启用它的下一条，其余全部暂停
 */
export function buildRotationScript(input: RotationScriptInput): string {
  const label = input.label.replace(/["\\]/g, "");
  if (!label) throw new Error("label is required");

  return `/**
 * AdLinkLab 直链轮换 Script v${ROTATION_SCRIPT_VERSION}
 * 标签: ${label}
 * 每次运行：先把三条广告所在的广告组全部启用，再按实时状态轮换广告（只启用当前启用广告的下一条）。
 * 不靠计数器，预览不会打乱顺序。
 * 建议运行频率：每小时 1 次（Google Ads 脚本 → 频率 → 每小时）。
 */
function main() {
  var LABEL = "${label}";

  // 找出该标签下的所有广告（不限状态）
  var ads = AdsApp.ads()
    .withCondition("LabelNames CONTAINS '" + LABEL + "'")
    .withCondition("Status IN [ENABLED, PAUSED]")
    .orderBy("AdGroupName ASC")
    .orderBy("Id ASC")
    .get();

  var adList = [];
  while (ads.hasNext()) {
    adList.push(ads.next());
  }

  if (adList.length === 0) {
    Logger.log("标签 " + LABEL + " 下没有广告，本次不做任何事。");
    return;
  }

  // 先把这几条广告所在的广告组全部启用，不然轮到它们也展示不了
  for (var j = 0; j < adList.length; j++) {
    adList[j].getAdGroup().enable();
  }

  // 找到当前启用的那条，下一条就是它后面的；如果没有启用的，从第 1 条开始
  var currentIdx = -1;
  for (var i = 0; i < adList.length; i++) {
    if (adList[i].isEnabled()) {
      currentIdx = i;
      break;
    }
  }
  var nextIdx = (currentIdx + 1) % adList.length;

  // 全部暂停，只启用下一条
  for (var i = 0; i < adList.length; i++) {
    if (i === nextIdx) {
      adList[i].enable();
    } else {
      adList[i].pause();
    }
  }

  Logger.log("轮换完成：标签 " + LABEL + " 下共 " + adList.length + " 条广告，本次启用第 " + (nextIdx + 1) + " 条（广告组：" + adList[nextIdx].getAdGroup().getName() + "，广告 ID：" + adList[nextIdx].getId() + "）。");
}
`;
}

/** 校验输入，返回错误信息列表（为空表示通过）。 */
export function validateRotationScriptInput(input: RotationScriptInput): string[] {
  const errors: string[] = [];
  if (!input.label || !input.label.trim()) {
    errors.push("label 必填，如 adlinklab-rotate-nike");
  } else if (!/^[a-zA-Z0-9_-]+$/.test(input.label.trim())) {
    errors.push("label 只能包含字母、数字、下划线和连字符");
  }
  return errors;
}
