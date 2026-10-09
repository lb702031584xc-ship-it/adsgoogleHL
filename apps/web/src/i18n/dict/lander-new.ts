/**
 * Task 4 — AI rewrite & deploy workbench + new template category labels.
 *
 * Standalone zh/en dictionary, imported directly by the rewrite workbench
 * page and the template library (for the coupon/guide category labels).
 * It is intentionally NOT merged into `dictionaries.ts`.
 */

export type LanderNewLang = "zh" | "en";

export interface LanderNewDict {
  page: {
    title: string;
    description: string;
  };
  steps: {
    source: string;
    requirements: string;
    result: string;
    deploy: string;
  };
  source: {
    title: string;
    templateTab: string;
    pageTab: string;
    pickTemplate: string;
    pickOffer: string;
    pickPage: string;
    templateLang: string;
    templateLangZh: string;
    templateLangEn: string;
    onlyHtmlPages: string;
    noPages: string;
    loadFailed: string;
  };
  form: {
    title: string;
    targetAudience: string;
    targetAudiencePh: string;
    sellingPoints: string;
    sellingPointsPh: string;
    addPoint: string;
    removePoint: string;
    tone: string;
    tones: Record<string, string>;
    ctaText: string;
    ctaTextPh: string;
    discountInfo: string;
    discountInfoPh: string;
    seoKeywords: string;
    seoKeywordsPh: string;
    language: string;
    langZh: string;
    langEn: string;
    length: string;
    lengths: Record<string, string>;
    generate: string;
    generating: string;
  };
  validation: {
    needSource: string;
    needOfferForPage: string;
    needPage: string;
    needTemplate: string;
    needAudienceOrPoints: string;
  };
  result: {
    title: string;
    originalScore: string;
    newScore: string;
    appliedCount: (n: number) => string;
    skippedCount: (n: number) => string;
    empty: string;
    preview: string;
    noPreview: string;
    before: string;
    after: string;
    reason: string;
    regenerate: string;
  };
  deploy: {
    title: string;
    name: string;
    namePh: string;
    offer: string;
    offerHint: string;
    url: string;
    urlPh: string;
    confirm: string;
    deploying: string;
    success: string;
    viewPage: string;
    failed: string;
    needName: string;
    needOffer: string;
  };
  categories: Record<string, string>;
}

const zh: LanderNewDict = {
  page: {
    title: "AI 改写部署工作台",
    description:
      "选一个模板或已有落地页，填写改写条件，AI 按要求改写文案，确认后一键部署为新的落地页。",
  },
  steps: {
    source: "① 选择来源",
    requirements: "② 改写条件",
    result: "③ 改写结果",
    deploy: "④ 确认部署",
  },
  source: {
    title: "改写来源",
    templateTab: "从模板开始",
    pageTab: "改写已有落地页",
    pickTemplate: "选择模板",
    pickOffer: "选择 Offer（部署时需要）",
    pickPage: "选择落地页",
    templateLang: "模板语言",
    templateLangZh: "中文",
    templateLangEn: "英文",
    onlyHtmlPages: "仅列出有 HTML 内容、可改写的落地页",
    noPages: "该 Offer 下没有可改写的落地页",
    loadFailed: "加载失败，请重试",
  },
  form: {
    title: "改写条件",
    targetAudience: "目标受众",
    targetAudiencePh: "例如：25-35 岁新手妈妈、预算有限的大学生",
    sellingPoints: "核心卖点",
    sellingPointsPh: "例如：静音设计，卧室也能用",
    addPoint: "＋ 添加卖点",
    removePoint: "删除",
    tone: "语气风格",
    tones: {
      professional: "专业严谨",
      friendly: "亲切自然",
      urgent: "紧迫促销",
      humorous: "幽默风趣",
      authoritative: "权威可信",
      concise: "简洁有力",
    },
    ctaText: "CTA 文案",
    ctaTextPh: "例如：立即抢购（改写后的按钮将使用它）",
    discountInfo: "折扣信息",
    discountInfoPh: "例如：限时 4 折，优惠码 SAVE40",
    seoKeywords: "SEO 关键词",
    seoKeywordsPh: "例如：best robot vacuum 2026，逗号分隔",
    language: "输出语言",
    langZh: "中文",
    langEn: "英文",
    length: "篇幅",
    lengths: {
      short: "精简",
      medium: "中等",
      long: "详细",
    },
    generate: "生成 AI 改写",
    generating: "AI 改写中…",
  },
  validation: {
    needSource: "请先选择改写来源",
    needOfferForPage: "请先选择 Offer",
    needPage: "请选择要改写的落地页",
    needTemplate: "请选择模板",
    needAudienceOrPoints:
      "请至少填写目标受众或一条核心卖点，AI 才知道往哪个方向改",
  },
  result: {
    title: "改写结果",
    originalScore: "改写前评分",
    newScore: "预估新评分",
    appliedCount: (n) => `成功改写 ${n} 处`,
    skippedCount: (n) => `${n} 处未命中原文，已跳过`,
    empty: "暂无改写结果，请先生成",
    preview: "部署预览",
    noPreview: "暂无预览",
    before: "改写前",
    after: "改写后",
    reason: "改写理由",
    regenerate: "重新生成",
  },
  deploy: {
    title: "部署为新落地页",
    name: "新落地页名称",
    namePh: "例如：Robot Vacuum 优惠券页（AI 改写版）",
    offer: "归属 Offer",
    offerHint: "部署必须归属一个 Offer",
    url: "页面 URL（可选）",
    urlPh: "https://…（不填则仅保存 HTML）",
    confirm: "一键部署",
    deploying: "部署中…",
    success: "部署成功！新落地页已创建。",
    viewPage: "查看落地页列表",
    failed: "部署失败，请重试",
    needName: "请填写新落地页名称",
    needOffer: "请选择归属 Offer",
  },
  categories: {
    coupon: "优惠券",
    guide: "指南",
  },
};

const en: LanderNewDict = {
  page: {
    title: "AI Rewrite & Deploy Workbench",
    description:
      "Pick a template or an existing landing page, describe the rewrite brief, let AI rewrite the copy, then deploy it as a new landing page in one click.",
  },
  steps: {
    source: "① Pick a source",
    requirements: "② Rewrite brief",
    result: "③ Rewrite result",
    deploy: "④ Confirm deploy",
  },
  source: {
    title: "Rewrite source",
    templateTab: "Start from a template",
    pageTab: "Rewrite an existing page",
    pickTemplate: "Choose a template",
    pickOffer: "Choose an offer (needed for deploy)",
    pickPage: "Choose a landing page",
    templateLang: "Template language",
    templateLangZh: "Chinese",
    templateLangEn: "English",
    onlyHtmlPages: "Only pages with HTML content are listed",
    noPages: "No rewritable landing pages under this offer",
    loadFailed: "Failed to load, please retry",
  },
  form: {
    title: "Rewrite brief",
    targetAudience: "Target audience",
    targetAudiencePh: "e.g. new moms aged 25-35, budget students",
    sellingPoints: "Key selling points",
    sellingPointsPh: "e.g. whisper-quiet, bedroom-friendly",
    addPoint: "＋ Add point",
    removePoint: "Remove",
    tone: "Tone",
    tones: {
      professional: "Professional",
      friendly: "Friendly",
      urgent: "Urgent",
      humorous: "Humorous",
      authoritative: "Authoritative",
      concise: "Concise",
    },
    ctaText: "CTA copy",
    ctaTextPh: "e.g. Get Deal Now (rewritten buttons will use it)",
    discountInfo: "Discount info",
    discountInfoPh: "e.g. 40% off today, code SAVE40",
    seoKeywords: "SEO keywords",
    seoKeywordsPh: "e.g. best robot vacuum 2026, comma separated",
    language: "Output language",
    langZh: "Chinese",
    langEn: "English",
    length: "Length",
    lengths: {
      short: "Short",
      medium: "Medium",
      long: "Long",
    },
    generate: "Generate AI rewrite",
    generating: "Rewriting…",
  },
  validation: {
    needSource: "Please pick a rewrite source first",
    needOfferForPage: "Please choose an offer first",
    needPage: "Please choose a landing page to rewrite",
    needTemplate: "Please choose a template",
    needAudienceOrPoints:
      "Fill in at least a target audience or one selling point so the AI knows the direction",
  },
  result: {
    title: "Rewrite result",
    originalScore: "Score before",
    newScore: "Estimated new score",
    appliedCount: (n) => `${n} spot(s) rewritten`,
    skippedCount: (n) => `${n} spot(s) skipped (no exact match)`,
    empty: "No rewrite yet — generate one first",
    preview: "Deploy preview",
    noPreview: "No preview",
    before: "Before",
    after: "After",
    reason: "Why",
    regenerate: "Regenerate",
  },
  deploy: {
    title: "Deploy as a new landing page",
    name: "New page name",
    namePh: "e.g. Robot Vacuum coupon page (AI rewritten)",
    offer: "Offer",
    offerHint: "Deploy must be attached to an offer",
    url: "Page URL (optional)",
    urlPh: "https://… (leave empty to store HTML only)",
    confirm: "Deploy in one click",
    deploying: "Deploying…",
    success: "Deployed! The new landing page is created.",
    viewPage: "View landing pages",
    failed: "Deploy failed, please retry",
    needName: "Please enter a name for the new page",
    needOffer: "Please choose an offer",
  },
  categories: {
    coupon: "Coupon",
    guide: "Guide",
  },
};

export const landerNewDict: Record<LanderNewLang, LanderNewDict> = { zh, en };

/** Category label for the template library, falling back to the new dict. */
export function templateCategoryLabel(
  mainCategories: Record<string, string | undefined>,
  category: string,
  lang: LanderNewLang
): string {
  return (
    mainCategories[category] ?? landerNewDict[lang].categories[category] ?? category
  );
}
