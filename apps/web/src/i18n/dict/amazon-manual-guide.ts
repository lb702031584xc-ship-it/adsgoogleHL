export interface ManualGuideCategory {
  id: string;
  name: string;
  desc: string;
}

export interface ManualGuideStep {
  id: string;
  dayLabel: string;
  title: string;
  intro: string[];
  checklist: string[];
  tools: { label: string; href: string; external?: boolean }[];
}

export interface AmazonManualGuideDict {
  title: string;
  description: string;
  progressLabel: string;
  progressText: string; // "{done}/{total}"
  stepDone: string;
  stepTodo: string;
  expand: string;
  collapse: string;
  categoriesTitle: string;
  categoriesHint: string;
  selectedCount: string; // "已选 {n}/2"
  candidateTitle: string;
  candidateHint: string;
  scanCountryLabel: string;
  colName: string;
  colAsin: string;
  colRank: string;
  colNote: string;
  colAction: string;
  addRow: string;
  removeRow: string;
  namePlaceholder: string;
  asinPlaceholder: string;
  rankPlaceholder: string;
  notePlaceholder: string;
  candidateEmpty: string;
  keepaPassTitle: string;
  keepaFailTitle: string;
  keepaPass: string[];
  keepaFail: string[];
  finalPickTitle: string;
  finalPickHint: string;
  goPipeline: string;
  congratsTitle: string;
  congratsBody: string;
  nextStepsTitle: string;
  nextSteps: string[];
  categories: ManualGuideCategory[];
  steps: ManualGuideStep[];
}

export const zh: AmazonManualGuideDict = {
  title: "手动选品 SOP",
  description:
    "没有 PA-API 也能跑起来的 7 天手动选品流程：定类目 → 扫榜单 → Keepa 验证 → 差评挖掘，最后产出 3 个测试品送入选品流水线。进度自动保存在本机浏览器。",
  progressLabel: "7 天进度",
  progressText: "{done}/{total}",
  stepDone: "已完成",
  stepTodo: "进行中",
  expand: "展开",
  collapse: "收起",
  categoriesTitle: "选择你的 2 个类目",
  categoriesHint: "点选 2 个你最熟悉、或最有供应链/内容优势的方向。贪多嚼不烂。",
  selectedCount: "已选 {n}/2",
  candidateTitle: "候选清单",
  candidateHint: "扫榜时把有潜力的产品记下来，目标 20 个。数据先粗记，后面 Keepa 验证时再细化。",
  scanCountryLabel: "榜单站点",
  colName: "产品名",
  colAsin: "ASIN",
  colRank: "类目排名",
  colNote: "备注",
  colAction: "操作",
  addRow: "添加一行",
  removeRow: "删除",
  namePlaceholder: "如：降噪蓝牙耳机",
  asinPlaceholder: "B0XXXXXX",
  rankPlaceholder: "如 #12",
  notePlaceholder: "第一印象",
  candidateEmpty: "还没有候选品，点“添加一行”开始记录。",
  keepaPassTitle: "通过标准（留）",
  keepaFailTitle: "淘汰标准（杀）",
  keepaPass: [
    "价格曲线过去 90 天平稳，没有频繁跳水",
    "类目排名长期稳定在前 100",
    "评论数稳步增长（说明持续出单）",
    "没有长期断货记录",
  ],
  keepaFail: [
    "价格 30 天内跌幅超过 25%（利润守不住）",
    "排名大起大落（多半是刷单或短期促销）",
    "评论区出现大量“质量差”“与描述不符”",
    "长期断货（供应链不稳，测了也白测）",
  ],
  finalPickTitle: "最终 3 个测试品",
  finalPickHint:
    "从候选清单里挑出综合评分最高的 3 个，记下 ASIN，然后一键送入选品流水线跑 6 道门评估。",
  goPipeline: "送入选品流水线 →",
  congratsTitle: "7 天 SOP 完成！",
  congratsBody:
    "你已经走完手动选品全流程：类目聚焦、榜单扫描、Keepa 验证、差评挖掘。把 3 个测试品送入流水线，让 6 道门再筛一遍，然后就可以小预算实测了。",
  nextStepsTitle: "下一步",
  nextSteps: [
    "在选品流水线中跑完 6 道门评估，拿到值得测试指数",
    "用组合测试页一份预算同时测 3 个品，看真实点击数据",
    "出单后把数据沉淀到需求监控，跟踪排名异动",
    "30 天 10 单后申请 PA-API，把这套手动流程自动化",
  ],
  categories: [
    {
      id: "audio",
      name: "耳机音频",
      desc: "蓝牙耳机、头戴式耳机、音箱。复购高、差评点集中（续航/延迟），改进款机会多。",
    },
    {
      id: "smarthome",
      name: "智能家居",
      desc: "智能插座、感应灯、门铃。单价适中，安装类差评是切入点，和博客内容联动好。",
    },
    {
      id: "charging",
      name: "充电配件",
      desc: "充电头、充电宝、数据线。刚需高频，但价格战激烈，重点看差异化（功率/体积）。",
    },
    {
      id: "computer",
      name: "电脑配件",
      desc: "键鼠、扩展坞、支架。客单价高，评论专业度高，适合做深度内容。",
    },
    {
      id: "kitchen",
      name: "厨房小家电",
      desc: "空气炸锅配件、咖啡器具、收纳。视觉化强，适合短视频/图文带货，季节性明显。",
    },
  ],
  steps: [
    {
      id: "categories",
      dayLabel: "Day 1–2",
      title: "定类目：从 5 个方向选 2 个",
      intro: [
        "新手最大的坑是类目跳来跳去，今天看耳机明天看灯具，哪个都没做深。先定 2 个类目，7 天内只看这 2 个。",
        "选择标准：你用过、有体感（能写出真实评测）；供应链/内容有优势（比如你博客已经有相关文章）；客单价 $20–$80（佣金和转化率最平衡的区间）。",
      ],
      checklist: [
        "读完 5 个类目的说明",
        "选定 2 个类目（下方点选）",
        "在纸上写下选择理由（一句话）",
      ],
      tools: [],
    },
    {
      id: "scan",
      dayLabel: "Day 3–4",
      title: "扫榜单：从公开榜单找候选",
      intro: [
        "Amazon 的 Best Sellers、Movers & Shakers、New Releases 三个榜单完全公开，不需要任何 API。每天花 30 分钟扫一遍你定的 2 个类目。",
        "重点看 Movers & Shakers（排名上升榜）——这里藏着正在起量的产品，比 Best Sellers 前排大牌更容易切入。New Releases 适合找新品红利。",
        "扫榜时不要纠结，先把顺眼的记下来，目标 20 个候选。宁可多记，后面 Keepa 会帮你杀掉一半。",
      ],
      checklist: [
        "打开 Best Sellers，记录类目 Top 50 里顺眼的产品",
        "打开 Movers & Shakers，找排名上升最快的 5 个",
        "打开 New Releases，看有没有新品机会",
        "候选清单记满 20 个（下方表格）",
      ],
      tools: [
        { label: "Amazon Best Sellers", href: "https://www.amazon.com/Best-Sellers/zgbs", external: true },
        { label: "Movers & Shakers", href: "https://www.amazon.com/gp/movers-and-shakers", external: true },
        { label: "New Releases", href: "https://www.amazon.com/gp/new-releases", external: true },
      ],
    },
    {
      id: "keepa",
      dayLabel: "Day 5",
      title: "Keepa 验证：价格与排名稳定性",
      intro: [
        "Keepa 免费版就能看价格历史和排名曲线。把 20 个候选逐个查一遍，按下面的标准杀——这一步通常能砍掉一半。",
        "核心逻辑：价格频繁跳水的品利润守不住，排名大起大落的品需求不真实。我们要的是“平稳赚钱”的品，不是“刺激”的品。",
      ],
      checklist: [
        "给 Keepa 浏览器插件装好（keepa.com 免费注册）",
        "20 个候选逐个查价格曲线，淘汰跳水品",
        "查排名曲线，淘汰大起大落的品",
        "候选清单缩减到 8 个以内",
      ],
      tools: [
        { label: "Keepa（免费版）", href: "https://keepa.com", external: true },
        { label: "去热销日历看季节性", href: "/amazon/trends" },
      ],
    },
    {
      id: "reviews",
      dayLabel: "Day 6–7",
      title: "差评挖掘：找切入点，定 3 个测试品",
      intro: [
        "最后一步：看剩下候选品的差评。重点看 3.5–4.2 星的产品——评分太高没改进空间，太低是质量问题碰不得。",
        "差评分类：如果集中吐槽“质量差”“与描述不符”→ 避开；如果吐槽“缺某个功能”“尺寸不对”“说明书看不懂”→ 这就是切入点，找有改进款的品。",
        "定出 3 个测试品，记下 ASIN，送入选品流水线跑 6 道门。手动流程到此结束，后面交给数据。",
      ],
      checklist: [
        "每个候选品读 20 条以上差评",
        "按“质量问题避开 / 功能缺口机会”分类",
        "定出最终 3 个测试品并记下 ASIN",
        "把 3 个 ASIN 送入选品流水线",
      ],
      tools: [
        { label: "去选品流水线评估", href: "/amazon/pipeline" },
        { label: "去选品发现找更多候选", href: "/amazon/discovery" },
      ],
    },
  ],
};

export const en: AmazonManualGuideDict = {
  title: "Manual Picking SOP",
  description:
    "A 7-day manual product-picking flow that works without PA-API: pick categories → scan best-seller lists → Keepa validation → review mining, ending with 3 test products sent to the product pipeline. Progress is auto-saved in your browser.",
  progressLabel: "7-day progress",
  progressText: "{done}/{total}",
  stepDone: "Done",
  stepTodo: "In progress",
  expand: "Expand",
  collapse: "Collapse",
  categoriesTitle: "Pick your 2 categories",
  categoriesHint: "Select the 2 directions you know best or have supply/content advantages in. Don't spread thin.",
  selectedCount: "{n}/2 selected",
  candidateTitle: "Candidate list",
  candidateHint: "Jot down promising products while scanning. Aim for 20 — record roughly now, refine during Keepa validation.",
  scanCountryLabel: "Ranking site",
  colName: "Product",
  colAsin: "ASIN",
  colRank: "Category rank",
  colNote: "Note",
  colAction: "Action",
  addRow: "Add row",
  removeRow: "Delete",
  namePlaceholder: "e.g. noise-cancelling earbuds",
  asinPlaceholder: "B0XXXXXX",
  rankPlaceholder: "e.g. #12",
  notePlaceholder: "First impression",
  candidateEmpty: "No candidates yet — click “Add row” to start recording.",
  keepaPassTitle: "Pass criteria (keep)",
  keepaFailTitle: "Kill criteria (drop)",
  keepaPass: [
    "Price curve stable over the past 90 days, no frequent drops",
    "Category rank stably in the top 100 long-term",
    "Review count growing steadily (consistent sales)",
    "No long out-of-stock history",
  ],
  keepaFail: [
    "Price dropped over 25% in 30 days (margin won't hold)",
    "Rank swings wildly (likely review manipulation or short promos)",
    "Many reviews complaining about “poor quality” / “not as described”",
    "Long out-of-stock periods (unstable supply — testing is wasted)",
  ],
  finalPickTitle: "Final 3 test products",
  finalPickHint:
    "Pick the top 3 from your candidate list, note their ASINs, then send them to the product pipeline for the 6-gate evaluation.",
  goPipeline: "Send to product pipeline →",
  congratsTitle: "7-day SOP complete!",
  congratsBody:
    "You've finished the full manual flow: category focus, list scanning, Keepa validation, review mining. Send the 3 test products to the pipeline for the 6 gates, then start small-budget live testing.",
  nextStepsTitle: "Next steps",
  nextSteps: [
    "Run the 6-gate evaluation in the product pipeline to get worth-testing scores",
    "Test all 3 with one budget via a combo test page and compare real click data",
    "Track ranking movements in Demand monitor once you have sales",
    "After 10 sales in 30 days, apply for PA-API and automate this manual flow",
  ],
  categories: [
    {
      id: "audio",
      name: "Audio & headphones",
      desc: "Earbuds, headphones, speakers. High repurchase; complaints cluster on battery/latency — lots of improved-model opportunities.",
    },
    {
      id: "smarthome",
      name: "Smart home",
      desc: "Smart plugs, sensor lights, doorbells. Mid-range prices; installation complaints are entry points; pairs well with blog content.",
    },
    {
      id: "charging",
      name: "Charging accessories",
      desc: "Chargers, power banks, cables. High-frequency essentials, but price wars are fierce — focus on differentiation (wattage/size).",
    },
    {
      id: "computer",
      name: "Computer accessories",
      desc: "Keyboards, mice, docks, stands. Higher tickets, knowledgeable reviewers — good for in-depth content.",
    },
    {
      id: "kitchen",
      name: "Kitchen gadgets",
      desc: "Air-fryer accessories, coffee gear, organizers. Very visual, great for short video/image posts; strong seasonality.",
    },
  ],
  steps: [
    {
      id: "categories",
      dayLabel: "Day 1–2",
      title: "Pick categories: choose 2 of 5",
      intro: [
        "The biggest beginner trap is jumping between categories — earbuds today, lamps tomorrow, mastering none. Fix 2 categories and look at nothing else for 7 days.",
        "Selection criteria: you've used the products (can write real reviews); you have supply or content advantages (e.g. your blog already covers them); price $20–$80 (the sweet spot for commission vs conversion).",
      ],
      checklist: [
        "Read all 5 category descriptions",
        "Select 2 categories (tap below)",
        "Write down your reason in one sentence (on paper)",
      ],
      tools: [],
    },
    {
      id: "scan",
      dayLabel: "Day 3–4",
      title: "Scan lists: find candidates on public rankings",
      intro: [
        "Amazon's Best Sellers, Movers & Shakers and New Releases are fully public — no API needed. Spend 30 minutes a day scanning your 2 categories.",
        "Focus on Movers & Shakers (rising rank) — it hides products gaining traction, easier to enter than Best Sellers' big brands. New Releases is good for new-product windows.",
        "Don't overthink while scanning — jot down anything promising, aim for 20 candidates. Record more; Keepa will kill half later.",
      ],
      checklist: [
        "Open Best Sellers, record promising products in category Top 50",
        "Open Movers & Shakers, find the 5 fastest risers",
        "Open New Releases for new-product opportunities",
        "Fill the candidate list to 20 (table below)",
      ],
      tools: [
        { label: "Amazon Best Sellers", href: "https://www.amazon.com/Best-Sellers/zgbs", external: true },
        { label: "Movers & Shakers", href: "https://www.amazon.com/gp/movers-and-shakers", external: true },
        { label: "New Releases", href: "https://www.amazon.com/gp/new-releases", external: true },
      ],
    },
    {
      id: "keepa",
      dayLabel: "Day 5",
      title: "Keepa validation: price & rank stability",
      intro: [
        "Keepa's free tier shows price history and rank curves. Check all 20 candidates against the criteria below — this step usually cuts half.",
        "Core logic: products with frequently crashing prices can't hold margin; products with wildly swinging ranks have unreal demand. We want “boringly profitable”, not “exciting”.",
      ],
      checklist: [
        "Install the Keepa browser extension (free signup at keepa.com)",
        "Check price curves for all 20, drop the divers",
        "Check rank curves, drop the roller-coasters",
        "Narrow the candidate list to 8 or fewer",
      ],
      tools: [
        { label: "Keepa (free)", href: "https://keepa.com", external: true },
        { label: "Check seasonality in Hot-selling calendar", href: "/amazon/trends" },
      ],
    },
    {
      id: "reviews",
      dayLabel: "Day 6–7",
      title: "Review mining: find entry points, lock 3 test products",
      intro: [
        "Final step: read the bad reviews of remaining candidates. Focus on 3.5–4.2 star products — higher ratings leave no improvement room, lower ones mean quality problems to avoid.",
        "Classify complaints: “poor quality” / “not as described” → avoid; “missing feature” / “wrong size” / “confusing manual” → that's your entry point, find improved versions.",
        "Lock in 3 test products, note their ASINs, and send them to the product pipeline for the 6 gates. The manual flow ends here — data takes over.",
      ],
      checklist: [
        "Read 20+ bad reviews per candidate",
        "Classify: quality problems (avoid) vs feature gaps (opportunity)",
        "Lock in the final 3 test products with ASINs",
        "Send the 3 ASINs to the product pipeline",
      ],
      tools: [
        { label: "Evaluate in product pipeline", href: "/amazon/pipeline" },
        { label: "Find more candidates in Discovery", href: "/amazon/discovery" },
      ],
    },
  ],
};
