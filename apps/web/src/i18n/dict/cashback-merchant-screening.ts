/**
 * 返利商家粘贴筛选（merchant-screening）page strings.
 *
 * Standalone dictionary module: imported directly by the merchant-screening
 * page / component. It is intentionally NOT merged into
 * `dictionaries.ts` (left untouched per scope), following the same
 * pattern as the cashback-rate-compare dict. Only strings live here;
 * the only functions are pure formatters like groupCount(n).
 * Never pass this dict object from a Server Component to a Client
 * Component — the client imports this module directly.
 */
export const zh = {
  merchantScreening: {
    title: "返利商家筛选",
    description:
      "从 55海淘复制一整段商家列表粘贴进来，直接筛出短名单、备选与排除三档。纯前端解析与筛查，不调后端、不建 Offer、不建系列。",
    warning:
      "返利%是给消费者的返现，不是联盟佣金。本筛查绝不拿返利%当佣金率算单均佣金；佣金只按已知品牌库里可信的佣金率 × 客单价算，没有依据的一律写“佣金未核实”。",
    pasteLabel: "商家列表（从 55海淘复制的纯文本）",
    placeholder:
      "把 55海淘的商家列表整段粘贴到这里，例如：\nEileen Fisher / 最高4%返利 / 5726人获得返利\nROVE Dash Cam / 8%返利 / 50人获得返利",
    loadSample: "载入示例",
    screen: "开始筛选",
    screening: "筛选中…",
    clear: "清空",
    copySummary: "复制汇总",
    copied: "已复制",
    copyConfirmed: "复制最终清单",
    emptyInput: "请先粘贴商家列表。",
    parsedSummary: (parsed: number, skipped: number) =>
      `已解析 ${parsed} 家，跳过 ${skipped} 行`,
    sections: {
      shortlist: "短名单",
      backup: "备选·待核实",
      excluded: "排除",
    },
    sectionHints: {
      shortlist: "已知网络可用、经济学可算过线。建系列前仍须用户另行确认。",
      backup: "流量或知名度尚可，但网络或佣金未核实，写明卡点后再定。",
      excluded: "命中硬排除（Awin / Impact / CJ、PepperJam 风险、非美国、巨头、重复/已搁置）或经济学可算不过线。",
    },
    columns: {
      select: "选",
      brand: "品牌",
      fame: "美国知名度",
      price: "典型客单价",
      network: "网络 + 佣金",
      gift: "11月送礼季",
      cashback: "返利 / 人数",
      keyword: "品牌词流量",
      reason: "理由",
    },
    verdicts: {
      shortlist: "短名单",
      backup: "备选",
      excluded: "排除",
    },
    demand: {
      strong: "需求强",
      medium: "需求中",
      weak: "需求弱",
      veryWeak: "需求极弱",
      unknown: "需求未知",
    },
    fame: {
      strong: "强",
      medium: "中",
      weak: "弱",
      unknown: "未核实",
    },
    gift: {
      fit: "适配",
      general: "一般",
      notFit: "不适配",
      unknown: "未核实",
    },
    noResult: "还没有筛选结果，先粘贴商家列表并点“开始筛选”。",
    noRows: "这一档暂无品牌。",
    groupCount: (n: number) => `共 ${n} 家`,
    keyword: {
      fetchButton: "拉取品牌词流量",
      fetching: "拉取中…",
      fetchedAt: "品牌词流量已拉取",
      fetchHint:
        "只测短名单 + 备选品牌，一次批量测完（品牌名本身就是种子词，美国、英语）。失败时显示接口返回的原错误，不编量顶上。",
      fetchErrorPrefix: "拉取失败：",
      notConfiguredHint:
        "若提示 DataForSEO 未配置或未验证，请去 AI 设置里配置 DataForSEO 凭证后再试。",
      pasteTitle: "品牌词流量表（可选）",
      pastePlaceholder:
        "从 /keywords/starter 或 DataForSEO 导出的词表粘贴，每行“词、搜索量、CPC”，逗号/制表符/空格分隔都认，例如：\nogee makeup, 22000, 2.08\ndooney & bourke bags\t27100\t0.56",
      pasteButton: "导入流量表",
      pasteSummary: (parsed: number, skipped: number, unmatched: number) =>
        `流量表已导入 ${parsed} 行，跳过 ${skipped} 行，未归属到商家 ${unmatched} 行`,
      columns: {
        volume: "搜索量",
        cpc: "CPC",
        competition: "竞争度",
        topBid: "页首出价",
      },
      verdicts: {
        noVolume: "无量",
        investable: "可投",
        overBreakeven: "超盈亏平衡",
        unknown: "无法判断",
        unmeasured: "未测",
      },
      unmeasuredNote: "佣金未核实，无法算盈亏平衡",
      trafficTitle: "品牌词流量一览",
      breakeven: (v: number) => `盈亏平衡 $${v.toFixed(2)}`,
    },
    confirm: {
      title: "定最终清单",
      hint: "勾选短名单 / 备选行，点“确认最终清单”只在页面内汇总显示。仅展示，不自动建 Offer、不自动建系列；建系列前须另行确认。",
      button: "确认最终清单",
      confirmedTitle: "最终清单（已确认）",
      confirmedEmpty: "还没勾选任何品牌。",
      confirmedNote:
        "仅站内汇总展示，未建 Offer、未建系列；建系列前须另行确认。",
    },
  },
};

export const en = {
  merchantScreening: {
    title: "Cashback Merchant Screening",
    description:
      "Paste a whole merchant list copied from 55haitao and get shortlist, backup and excluded tiers. Pure frontend parsing and screening — no backend calls, no Offer or campaign is created.",
    warning:
      "Cashback % is what consumers get, not the affiliate commission. This screening never uses cashback % as the commission rate; commission is only computed from a trusted rate × typical order value in the known-brand library, otherwise it stays “unverified”.",
    pasteLabel: "Merchant list (plain text copied from 55haitao)",
    placeholder:
      "Paste the whole merchant list here, e.g.:\nEileen Fisher / 最高4%返利 / 5726人获得返利\nROVE Dash Cam / 8%返利 / 50人获得返利",
    loadSample: "Load sample",
    screen: "Screen",
    screening: "Screening…",
    clear: "Clear",
    copySummary: "Copy summary",
    copied: "Copied",
    copyConfirmed: "Copy final list",
    emptyInput: "Paste a merchant list first.",
    parsedSummary: (parsed: number, skipped: number) =>
      `Parsed ${parsed} merchants, skipped ${skipped} line(s)`,
    sections: {
      shortlist: "Shortlist",
      backup: "Backup / to verify",
      excluded: "Excluded",
    },
    sectionHints: {
      shortlist: "Known network usable and economics check out. Creating a campaign still needs a separate confirmation.",
      backup: "Traffic or fame looks okay, but network or commission is unverified — see the blocker before deciding.",
      excluded: "Hit a hard exclusion (Awin / Impact / CJ, PepperJam risk, non-US, giant retailer, duplicate / shelved) or the economics provably fail.",
    },
    columns: {
      select: "Pick",
      brand: "Brand",
      fame: "US fame",
      price: "Typical order value",
      network: "Network + commission",
      gift: "Nov gift season",
      cashback: "Cashback / people",
      keyword: "Brand keyword traffic",
      reason: "Reason",
    },
    verdicts: {
      shortlist: "Shortlist",
      backup: "Backup",
      excluded: "Excluded",
    },
    demand: {
      strong: "Strong demand",
      medium: "Medium demand",
      weak: "Weak demand",
      veryWeak: "Very weak demand",
      unknown: "Demand unknown",
    },
    fame: {
      strong: "Strong",
      medium: "Medium",
      weak: "Weak",
      unknown: "Unverified",
    },
    gift: {
      fit: "Good fit",
      general: "So-so",
      notFit: "Poor fit",
      unknown: "Unverified",
    },
    noResult: "No results yet — paste a merchant list and click “Screen”.",
    noRows: "No brands in this tier.",
    groupCount: (n: number) => `${n} brand(s)`,
    keyword: {
      fetchButton: "Fetch brand keyword traffic",
      fetching: "Fetching…",
      fetchedAt: "Brand keyword traffic fetched",
      fetchHint:
        "Only shortlist + backup brands are measured, in one batch call (the brand name itself is the seed keyword; US, English). On failure the API error is shown as-is; no volume is invented.",
      fetchErrorPrefix: "Fetch failed: ",
      notConfiguredHint:
        "If it says DataForSEO is not configured or unverified, configure the DataForSEO credentials in AI Settings and try again.",
      pasteTitle: "Brand keyword traffic table (optional)",
      pastePlaceholder:
        "Paste a keyword table exported from /keywords/starter or DataForSEO, one “keyword, search volume, CPC” per line (comma / tab / space separated), e.g.:\nogee makeup, 22000, 2.08\ndooney & bourke bags\t27100\t0.56",
      pasteButton: "Import traffic table",
      pasteSummary: (parsed: number, skipped: number, unmatched: number) =>
        `Imported ${parsed} row(s), skipped ${skipped}, unmatched to any merchant ${unmatched}`,
      columns: {
        volume: "Search volume",
        cpc: "CPC",
        competition: "Competition",
        topBid: "Top-of-page bid",
      },
      verdicts: {
        noVolume: "No volume",
        investable: "Investable",
        overBreakeven: "Over breakeven",
        unknown: "Cannot judge",
        unmeasured: "Not measured",
      },
      unmeasuredNote: "Commission unverified, cannot compute breakeven",
      trafficTitle: "Brand keyword traffic",
      breakeven: (v: number) => `Breakeven $${v.toFixed(2)}`,
    },
    confirm: {
      title: "Confirm final list",
      hint: "Tick shortlist / backup rows, then click “Confirm final list” to see the summary on this page only. Display only — no Offer or campaign is created automatically; creating a campaign needs a separate confirmation.",
      button: "Confirm final list",
      confirmedTitle: "Final list (confirmed)",
      confirmedEmpty: "No brands ticked yet.",
      confirmedNote:
        "Display only — no Offer or campaign was created; creating a campaign needs a separate confirmation.",
    },
  },
};
