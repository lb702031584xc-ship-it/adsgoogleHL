/**
 * 内置节日日历（热销日历 /amazon/trends 用）。
 *
 * - 不调任何外部 API，纯代码数据。
 * - 日期规则支持：固定日期 / 第N个周X / 最后一个周X /
 *   指定日期前的最后一个周X / 复活节 / 复活节偏移 / 相对另一节日偏移。
 * - 覆盖 Amazon 9 大站点国家，每国 10-13 个主要购物节。
 *
 *  weekday 编号沿用 JS Date.getUTCDay()：0=周日 … 6=周六。
 */

export const COUNTRIES = [
  "US",
  "UK",
  "DE",
  "FR",
  "IT",
  "ES",
  "CA",
  "AU",
  "JP",
] as const;
export type CountryCode = (typeof COUNTRIES)[number];

export const COUNTRY_NAMES: Record<CountryCode, { zh: string; en: string }> = {
  US: { zh: "美国", en: "United States" },
  UK: { zh: "英国", en: "United Kingdom" },
  DE: { zh: "德国", en: "Germany" },
  FR: { zh: "法国", en: "France" },
  IT: { zh: "意大利", en: "Italy" },
  ES: { zh: "西班牙", en: "Spain" },
  CA: { zh: "加拿大", en: "Canada" },
  AU: { zh: "澳大利亚", en: "Australia" },
  JP: { zh: "日本", en: "Japan" },
};

export interface CategoryTag {
  zh: string;
  en: string;
}

export type HolidayDateRule =
  | { kind: "fixed"; month: number; day: number }
  | { kind: "nthWeekday"; month: number; weekday: number; n: number }
  | { kind: "lastWeekday"; month: number; weekday: number }
  | {
      kind: "lastWeekdayOnOrBefore";
      month: number;
      day: number;
      weekday: number;
    }
  | { kind: "easter" }
  | { kind: "easterOffset"; days: number }
  | { kind: "after"; ref: string; days: number };

export interface Holiday {
  id: string;
  country: CountryCode;
  nameZh: string;
  nameEn: string;
  rule: HolidayDateRule;
  /** 相关品类标签（热销品类来源）。 */
  categories: CategoryTag[];
  /** 选品提前量天数：建议至少提前这么多天开始准备。 */
  leadDays: number;
  /** 补充说明（如日期为近似值）。 */
  note?: string;
}

const c = (zh: string, en: string): CategoryTag => ({ zh, en });

// 复用标签
const T = {
  electronics: c("电子产品", "Electronics"),
  toys: c("玩具", "Toys"),
  candy: c("糖果", "Candy"),
  jewelry: c("珠宝首饰", "Jewelry"),
  clothing: c("服装", "Clothing"),
  shoes: c("鞋履", "Shoes"),
  home: c("家居用品", "Home goods"),
  beauty: c("美容护肤", "Beauty & skincare"),
  outdoor: c("户外装备", "Outdoor gear"),
  bbq: c("烧烤用品", "BBQ supplies"),
  party: c("派对用品", "Party supplies"),
  decor: c("节日装饰", "Holiday decor"),
  gifts: c("礼品", "Gifts"),
  kitchen: c("厨房用品", "Kitchen"),
  travel: c("旅行用品", "Travel gear"),
  chocolate: c("巧克力", "Chocolate"),
};

export const HOLIDAYS: Holiday[] = [
  // ---------------- US ----------------
  { id: "us-new-year", country: "US", nameZh: "元旦", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization"), c("健身器材", "Fitness gear"), c("健康食品", "Healthy food")], leadDays: 30 },
  { id: "us-super-bowl", country: "US", nameZh: "超级碗", nameEn: "Super Bowl", rule: { kind: "nthWeekday", month: 2, weekday: 0, n: 2 }, categories: [c("大屏电视", "Big-screen TV"), c("派对零食", "Party snacks"), T.bbq], leadDays: 30 },
  { id: "us-valentine", country: "US", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate, c("香水", "Perfume"), c("情侣礼物", "Couple gifts")], leadDays: 30 },
  { id: "us-easter", country: "US", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.candy, c("复活节装饰", "Easter decor"), c("儿童玩具", "Kids toys")], leadDays: 30 },
  { id: "us-mothers-day", country: "US", nameZh: "母亲节", nameEn: "Mother's Day", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 2 }, categories: [T.jewelry, T.beauty, c("鲜花", "Flowers"), c("香薰", "Home fragrance")], leadDays: 30 },
  { id: "us-fathers-day", country: "US", nameZh: "父亲节", nameEn: "Father's Day", rule: { kind: "nthWeekday", month: 6, weekday: 0, n: 3 }, categories: [c("电动工具", "Power tools"), T.outdoor, c("电动剃须刀", "Electric shavers"), T.bbq], leadDays: 30 },
  { id: "us-independence", country: "US", nameZh: "美国独立日", nameEn: "Independence Day", rule: { kind: "fixed", month: 7, day: 4 }, categories: [T.bbq, c("泳池玩具", "Pool toys"), c("户外家具", "Outdoor furniture")], leadDays: 30 },
  { id: "us-prime-day", country: "US", nameZh: "Prime Day", nameEn: "Prime Day", rule: { kind: "fixed", month: 7, day: 15 }, categories: [T.electronics, c("智能家居", "Smart home"), c("小家电", "Small appliances")], leadDays: 45, note: "日期为近似值（7月中旬），以亚马逊官方公布为准" },
  { id: "us-back-to-school", country: "US", nameZh: "返校季", nameEn: "Back to School", rule: { kind: "fixed", month: 8, day: 15 }, categories: [c("背包", "Backpacks"), c("文具", "Stationery"), c("笔记本电脑", "Laptops"), c("宿舍用品", "Dorm essentials")], leadDays: 45, note: "为季节起点近似日期" },
  { id: "us-halloween", country: "US", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor, T.candy], leadDays: 45 },
  { id: "us-black-friday", country: "US", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, c("大家电", "Home appliances"), T.toys, c("游戏主机", "Gaming consoles")], leadDays: 60 },
  { id: "us-cyber-monday", country: "US", nameZh: "网络星期一", nameEn: "Cyber Monday", rule: { kind: "after", ref: "us-black-friday", days: 3 }, categories: [T.electronics, c("电脑配件", "Computer accessories"), c("软件", "Software")], leadDays: 60 },
  { id: "us-christmas", country: "US", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, T.electronics, c("圣诞装饰", "Christmas decor"), c("礼品套装", "Gift sets")], leadDays: 75 },

  // ---------------- UK ----------------
  { id: "uk-new-year", country: "UK", nameZh: "元旦", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization"), c("健身器材", "Fitness gear")], leadDays: 30 },
  { id: "uk-valentine", country: "UK", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate, c("香水", "Perfume")], leadDays: 30 },
  { id: "uk-easter", country: "UK", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.candy, c("复活节装饰", "Easter decor")], leadDays: 30 },
  { id: "uk-mothers-day", country: "UK", nameZh: "母亲节（英国）", nameEn: "Mother's Day (UK)", rule: { kind: "easterOffset", days: -21 }, categories: [T.jewelry, T.beauty, c("鲜花", "Flowers")], leadDays: 30 },
  { id: "uk-fathers-day", country: "UK", nameZh: "父亲节", nameEn: "Father's Day", rule: { kind: "nthWeekday", month: 6, weekday: 0, n: 3 }, categories: [c("电动工具", "Power tools"), T.outdoor], leadDays: 30 },
  { id: "uk-summer-bank", country: "UK", nameZh: "夏季银行假日", nameEn: "Summer Bank Holiday", rule: { kind: "lastWeekday", month: 8, weekday: 1 }, categories: [T.outdoor, T.bbq], leadDays: 30 },
  { id: "uk-halloween", country: "UK", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor], leadDays: 45 },
  { id: "uk-black-friday", country: "UK", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys, c("大家电", "Home appliances")], leadDays: 60 },
  { id: "uk-cyber-monday", country: "UK", nameZh: "网络星期一", nameEn: "Cyber Monday", rule: { kind: "after", ref: "uk-black-friday", days: 3 }, categories: [T.electronics, c("电脑配件", "Computer accessories")], leadDays: 60 },
  { id: "uk-christmas", country: "UK", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, T.electronics, c("圣诞装饰", "Christmas decor")], leadDays: 75 },
  { id: "uk-boxing-day", country: "UK", nameZh: "节礼日", nameEn: "Boxing Day", rule: { kind: "fixed", month: 12, day: 26 }, categories: [c("折扣电子产品", "Discount electronics"), T.clothing, T.toys], leadDays: 45 },

  // ---------------- DE ----------------
  { id: "de-new-year", country: "DE", nameZh: "新年", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization"), c("健身器材", "Fitness gear")], leadDays: 30 },
  { id: "de-valentine", country: "DE", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate], leadDays: 30 },
  { id: "de-easter", country: "DE", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.candy, c("复活节装饰", "Easter decor")], leadDays: 30 },
  { id: "de-mothers-day", country: "DE", nameZh: "母亲节", nameEn: "Mother's Day", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 2 }, categories: [T.jewelry, c("鲜花", "Flowers"), T.beauty], leadDays: 30 },
  { id: "de-fathers-day", country: "DE", nameZh: "父亲节（德国）", nameEn: "Father's Day (DE)", rule: { kind: "easterOffset", days: 39 }, categories: [T.outdoor, T.bbq, c("啤酒用品", "Beer accessories")], leadDays: 30 },
  { id: "de-back-to-school", country: "DE", nameZh: "开学季", nameEn: "Back to School", rule: { kind: "fixed", month: 8, day: 15 }, categories: [c("背包", "Backpacks"), c("文具", "Stationery")], leadDays: 45, note: "为季节起点近似日期" },
  { id: "de-halloween", country: "DE", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor], leadDays: 45 },
  { id: "de-black-friday", country: "DE", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "de-cyber-monday", country: "DE", nameZh: "网络星期一", nameEn: "Cyber Monday", rule: { kind: "after", ref: "de-black-friday", days: 3 }, categories: [T.electronics], leadDays: 60 },
  { id: "de-christmas", country: "DE", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, c("圣诞装饰", "Christmas decor"), c("礼品套装", "Gift sets")], leadDays: 75 },
  { id: "de-silvester", country: "DE", nameZh: "除夕", nameEn: "New Year's Eve", rule: { kind: "fixed", month: 12, day: 31 }, categories: [c("烟花", "Fireworks"), T.party, c("香槟", "Champagne")], leadDays: 30 },

  // ---------------- FR ----------------
  { id: "fr-new-year", country: "FR", nameZh: "新年", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization")], leadDays: 30 },
  { id: "fr-soldes-hiver", country: "FR", nameZh: "冬季打折季", nameEn: "Winter Sales", rule: { kind: "fixed", month: 1, day: 10 }, categories: [T.clothing, T.shoes, T.home], leadDays: 30, note: "日期为近似值，实际以政府公布为准" },
  { id: "fr-valentine", country: "FR", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate, c("香水", "Perfume")], leadDays: 30 },
  { id: "fr-easter", country: "FR", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.chocolate, c("复活节装饰", "Easter decor")], leadDays: 30 },
  { id: "fr-mothers-day", country: "FR", nameZh: "母亲节（法国）", nameEn: "Mother's Day (FR)", rule: { kind: "lastWeekday", month: 5, weekday: 0 }, categories: [T.jewelry, c("鲜花", "Flowers"), T.beauty], leadDays: 30 },
  { id: "fr-fathers-day", country: "FR", nameZh: "父亲节", nameEn: "Father's Day", rule: { kind: "nthWeekday", month: 6, weekday: 0, n: 3 }, categories: [c("电动工具", "Power tools"), T.outdoor], leadDays: 30 },
  { id: "fr-soldes-ete", country: "FR", nameZh: "夏季打折季", nameEn: "Summer Sales", rule: { kind: "fixed", month: 6, day: 25 }, categories: [T.clothing, c("泳装", "Swimwear"), T.outdoor], leadDays: 30, note: "日期为近似值，实际以政府公布为准" },
  { id: "fr-bastille", country: "FR", nameZh: "巴士底日", nameEn: "Bastille Day", rule: { kind: "fixed", month: 7, day: 14 }, categories: [T.party, T.bbq], leadDays: 30 },
  { id: "fr-halloween", country: "FR", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor], leadDays: 45 },
  { id: "fr-black-friday", country: "FR", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "fr-christmas", country: "FR", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, c("圣诞装饰", "Christmas decor"), c("礼品套装", "Gift sets")], leadDays: 75 },

  // ---------------- IT ----------------
  { id: "it-new-year", country: "IT", nameZh: "新年", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization")], leadDays: 30 },
  { id: "it-epiphany", country: "IT", nameZh: "主显节", nameEn: "Epiphany", rule: { kind: "fixed", month: 1, day: 6 }, categories: [T.candy, T.toys], leadDays: 30 },
  { id: "it-valentine", country: "IT", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate], leadDays: 30 },
  { id: "it-fathers-day", country: "IT", nameZh: "父亲节（意大利）", nameEn: "Father's Day (IT)", rule: { kind: "fixed", month: 3, day: 19 }, categories: [c("电动工具", "Power tools"), T.outdoor], leadDays: 30 },
  { id: "it-easter", country: "IT", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.chocolate, c("复活节装饰", "Easter decor")], leadDays: 30 },
  { id: "it-mothers-day", country: "IT", nameZh: "母亲节", nameEn: "Mother's Day", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 2 }, categories: [T.jewelry, c("鲜花", "Flowers")], leadDays: 30 },
  { id: "it-saldi", country: "IT", nameZh: "夏季打折季", nameEn: "Summer Sales", rule: { kind: "fixed", month: 7, day: 6 }, categories: [T.clothing, T.shoes], leadDays: 30, note: "日期为近似值" },
  { id: "it-halloween", country: "IT", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes")], leadDays: 45 },
  { id: "it-black-friday", country: "IT", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "it-christmas", country: "IT", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, c("圣诞装饰", "Christmas decor")], leadDays: 75 },
  { id: "it-st-stephen", country: "IT", nameZh: "圣斯德望日", nameEn: "St. Stephen's Day", rule: { kind: "fixed", month: 12, day: 26 }, categories: [c("折扣服装", "Discount clothing"), T.toys], leadDays: 45 },

  // ---------------- ES ----------------
  { id: "es-new-year", country: "ES", nameZh: "新年", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization")], leadDays: 30 },
  { id: "es-reyes", country: "ES", nameZh: "三王节", nameEn: "Epiphany (Día de Reyes)", rule: { kind: "fixed", month: 1, day: 6 }, categories: [T.toys, T.candy, T.gifts], leadDays: 30 },
  { id: "es-valentine", country: "ES", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate], leadDays: 30 },
  { id: "es-fathers-day", country: "ES", nameZh: "父亲节（西班牙）", nameEn: "Father's Day (ES)", rule: { kind: "fixed", month: 3, day: 19 }, categories: [c("电动工具", "Power tools"), T.outdoor], leadDays: 30 },
  { id: "es-easter", country: "ES", nameZh: "圣周", nameEn: "Holy Week", rule: { kind: "easter" }, categories: [T.candy, T.travel], leadDays: 30 },
  { id: "es-mothers-day", country: "ES", nameZh: "母亲节（西班牙）", nameEn: "Mother's Day (ES)", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 1 }, categories: [T.jewelry, c("鲜花", "Flowers")], leadDays: 30 },
  { id: "es-rebajas", country: "ES", nameZh: "夏季打折季", nameEn: "Summer Sales", rule: { kind: "fixed", month: 7, day: 1 }, categories: [T.clothing, T.shoes], leadDays: 30, note: "日期为近似值" },
  { id: "es-halloween", country: "ES", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor], leadDays: 45 },
  { id: "es-black-friday", country: "ES", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "es-christmas", country: "ES", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, c("圣诞装饰", "Christmas decor")], leadDays: 75 },

  // ---------------- CA ----------------
  { id: "ca-new-year", country: "CA", nameZh: "元旦", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization"), c("健身器材", "Fitness gear")], leadDays: 30 },
  { id: "ca-valentine", country: "CA", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate], leadDays: 30 },
  { id: "ca-easter", country: "CA", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.candy], leadDays: 30 },
  { id: "ca-victoria-day", country: "CA", nameZh: "维多利亚日", nameEn: "Victoria Day", rule: { kind: "lastWeekdayOnOrBefore", month: 5, day: 24, weekday: 1 }, categories: [c("园艺", "Gardening"), T.outdoor, T.bbq], leadDays: 30 },
  { id: "ca-canada-day", country: "CA", nameZh: "加拿大国庆日", nameEn: "Canada Day", rule: { kind: "fixed", month: 7, day: 1 }, categories: [T.outdoor, T.bbq, c("爱国装饰", "Patriotic decor")], leadDays: 30 },
  { id: "ca-labour-day", country: "CA", nameZh: "劳动节", nameEn: "Labour Day", rule: { kind: "nthWeekday", month: 9, weekday: 1, n: 1 }, categories: [c("返校用品", "Back to school"), T.outdoor], leadDays: 30 },
  { id: "ca-thanksgiving", country: "CA", nameZh: "感恩节（加拿大）", nameEn: "Thanksgiving (CA)", rule: { kind: "nthWeekday", month: 10, weekday: 1, n: 2 }, categories: [T.kitchen, c("烘焙", "Baking"), T.home], leadDays: 30 },
  { id: "ca-halloween", country: "CA", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), T.decor, T.candy], leadDays: 45 },
  { id: "ca-black-friday", country: "CA", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "ca-cyber-monday", country: "CA", nameZh: "网络星期一", nameEn: "Cyber Monday", rule: { kind: "after", ref: "ca-black-friday", days: 3 }, categories: [T.electronics], leadDays: 60 },
  { id: "ca-christmas", country: "CA", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, T.electronics, c("圣诞装饰", "Christmas decor")], leadDays: 75 },
  { id: "ca-boxing-day", country: "CA", nameZh: "节礼日", nameEn: "Boxing Day", rule: { kind: "fixed", month: 12, day: 26 }, categories: [c("折扣电子产品", "Discount electronics"), T.clothing], leadDays: 45 },

  // ---------------- AU ----------------
  { id: "au-new-year", country: "AU", nameZh: "元旦", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("家居收纳", "Home organization")], leadDays: 30 },
  { id: "au-australia-day", country: "AU", nameZh: "澳大利亚日", nameEn: "Australia Day", rule: { kind: "fixed", month: 1, day: 26 }, categories: [T.outdoor, T.bbq, c("泳池玩具", "Pool toys")], leadDays: 30 },
  { id: "au-valentine", country: "AU", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.jewelry, T.chocolate], leadDays: 30 },
  { id: "au-easter", country: "AU", nameZh: "复活节", nameEn: "Easter", rule: { kind: "easter" }, categories: [T.candy], leadDays: 30 },
  { id: "au-mothers-day", country: "AU", nameZh: "母亲节", nameEn: "Mother's Day", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 2 }, categories: [T.jewelry, c("鲜花", "Flowers")], leadDays: 30 },
  { id: "au-fathers-day", country: "AU", nameZh: "父亲节（澳大利亚）", nameEn: "Father's Day (AU)", rule: { kind: "nthWeekday", month: 9, weekday: 0, n: 1 }, categories: [T.outdoor, T.bbq], leadDays: 30 },
  { id: "au-halloween", country: "AU", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes")], leadDays: 45 },
  { id: "au-black-friday", country: "AU", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "au-cyber-monday", country: "AU", nameZh: "网络星期一", nameEn: "Cyber Monday", rule: { kind: "after", ref: "au-black-friday", days: 3 }, categories: [T.electronics], leadDays: 60 },
  { id: "au-christmas", country: "AU", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [T.toys, c("夏季户外", "Summer outdoor"), T.bbq], leadDays: 75 },
  { id: "au-boxing-day", country: "AU", nameZh: "节礼日", nameEn: "Boxing Day", rule: { kind: "fixed", month: 12, day: 26 }, categories: [c("折扣电子产品", "Discount electronics"), T.clothing], leadDays: 45 },

  // ---------------- JP ----------------
  { id: "jp-new-year", country: "JP", nameZh: "新年（正月）", nameEn: "New Year", rule: { kind: "fixed", month: 1, day: 1 }, categories: [c("福袋", "Lucky bags"), c("年货", "New Year goods"), c("家电", "Home appliances")], leadDays: 30 },
  { id: "jp-hatsuri", country: "JP", nameZh: "新年初卖", nameEn: "New Year Sales", rule: { kind: "fixed", month: 1, day: 2 }, categories: [T.clothing, T.electronics, c("福袋", "Lucky bags")], leadDays: 30 },
  { id: "jp-valentine", country: "JP", nameZh: "情人节", nameEn: "Valentine's Day", rule: { kind: "fixed", month: 2, day: 14 }, categories: [T.chocolate, T.gifts], leadDays: 30 },
  { id: "jp-white-day", country: "JP", nameZh: "白色情人节", nameEn: "White Day", rule: { kind: "fixed", month: 3, day: 14 }, categories: [T.candy, T.jewelry], leadDays: 30 },
  { id: "jp-golden-week", country: "JP", nameZh: "黄金周", nameEn: "Golden Week", rule: { kind: "fixed", month: 5, day: 3 }, categories: [T.travel, T.outdoor, c("相机", "Cameras")], leadDays: 30 },
  { id: "jp-mothers-day", country: "JP", nameZh: "母亲节", nameEn: "Mother's Day", rule: { kind: "nthWeekday", month: 5, weekday: 0, n: 2 }, categories: [c("鲜花", "Flowers"), T.beauty], leadDays: 30 },
  { id: "jp-fathers-day", country: "JP", nameZh: "父亲节", nameEn: "Father's Day", rule: { kind: "nthWeekday", month: 6, weekday: 0, n: 3 }, categories: [c("酒具", "Sake sets"), T.outdoor], leadDays: 30 },
  { id: "jp-obon", country: "JP", nameZh: "盂兰盆节", nameEn: "Obon", rule: { kind: "fixed", month: 8, day: 15 }, categories: [T.travel, T.gifts], leadDays: 30 },
  { id: "jp-halloween", country: "JP", nameZh: "万圣节", nameEn: "Halloween", rule: { kind: "fixed", month: 10, day: 31 }, categories: [c("服装", "Costumes"), c("美妆", "Cosmetics")], leadDays: 45 },
  { id: "jp-black-friday", country: "JP", nameZh: "黑色星期五", nameEn: "Black Friday", rule: { kind: "nthWeekday", month: 11, weekday: 5, n: 4 }, categories: [T.electronics, T.toys], leadDays: 60 },
  { id: "jp-christmas", country: "JP", nameZh: "圣诞节", nameEn: "Christmas", rule: { kind: "fixed", month: 12, day: 25 }, categories: [c("蛋糕", "Christmas cake"), T.gifts, T.toys], leadDays: 60 },
];

// ---------------------------------------------------------------------------
// 日期计算（UTC）
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function utcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month - 1, day));
}

/** 复活节（Anonymous Gregorian 算法，西方教会）。 */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const cc = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(cc / 4);
  const k = cc % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return utcDate(year, month, day);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, n: number): Date {
  const first = utcDate(year, month, 1);
  const delta = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(first.getTime() + (delta + (n - 1) * 7) * DAY_MS);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): Date {
  const last = utcDate(year, month + 1, 0); // 下月第0天 = 本月最后一天
  const delta = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(last.getTime() - delta * DAY_MS);
}

function lastWeekdayOnOrBefore(year: number, month: number, day: number, weekday: number): Date {
  const d = utcDate(year, month, day);
  const delta = (d.getUTCDay() - weekday + 7) % 7;
  return new Date(d.getTime() - delta * DAY_MS);
}

const byId = new Map<string, Holiday>(HOLIDAYS.map((h) => [h.id, h]));

/** 计算某节日在某年的 UTC 日期。 */
export function resolveHolidayDate(h: Holiday, year: number): Date {
  const r = h.rule;
  switch (r.kind) {
    case "fixed":
      return utcDate(year, r.month, r.day);
    case "nthWeekday":
      return nthWeekdayOfMonth(year, r.month, r.weekday, r.n);
    case "lastWeekday":
      return lastWeekdayOfMonth(year, r.month, r.weekday);
    case "lastWeekdayOnOrBefore":
      return lastWeekdayOnOrBefore(year, r.month, r.day, r.weekday);
    case "easter":
      return easterSunday(year);
    case "easterOffset":
      return new Date(easterSunday(year).getTime() + r.days * DAY_MS);
    case "after": {
      const ref = byId.get(r.ref);
      if (!ref) throw new Error(`unknown holiday ref: ${r.ref}`);
      return new Date(resolveHolidayDate(ref, year).getTime() + r.days * DAY_MS);
    }
  }
}

// ---------------------------------------------------------------------------
// 日历查询
// ---------------------------------------------------------------------------

export type PrepStage = "plan" | "prepare" | "sprint";

export interface UpcomingHoliday {
  id: string;
  nameZh: string;
  nameEn: string;
  /** YYYY-MM-DD（UTC）。 */
  date: string;
  daysLeft: number;
  leadDays: number;
  categories: CategoryTag[];
  stage: PrepStage;
  prepAdviceZh: string;
  prepAdviceEn: string;
  note?: string;
}

function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function stageOf(daysLeft: number, leadDays: number): PrepStage {
  if (daysLeft <= 21) return "sprint";
  if (daysLeft <= leadDays) return "prepare";
  return "plan";
}

function adviceFor(
  stage: PrepStage,
  nameZh: string,
  nameEn: string,
  daysLeft: number,
  leadDays: number
): { zh: string; en: string } {
  switch (stage) {
    case "sprint":
      return {
        zh: `距${nameZh}还有 ${daysLeft} 天，已进入冲刺期：检查库存、广告素材与落地页是否就绪。`,
        en: `${daysLeft} days until ${nameEn} — sprint phase: verify stock, ad creatives and landing pages are ready.`,
      };
    case "prepare":
      return {
        zh: `距${nameZh}还有 ${daysLeft} 天（建议提前 ${leadDays} 天准备）：现在备货、建广告计划正当时。`,
        en: `${daysLeft} days until ${nameEn} (recommended lead time: ${leadDays} days): stock up and build ad campaigns now.`,
      };
    default:
      return {
        zh: `距${nameZh}还有 ${daysLeft} 天：现在选品、建落地页正当时。`,
        en: `${daysLeft} days until ${nameEn}: now is the time to pick products and build landing pages.`,
      };
  }
}

/**
 * 未来 withinDays 天内的节日时间线（按倒计时排序）。
 * 若今年的日期已过，自动取明年的。
 */
export function getUpcomingHolidays(
  country: CountryCode,
  now: Date = new Date(),
  withinDays = 90
): UpcomingHoliday[] {
  const today = utcDate(now.getUTCFullYear(), now.getUTCMonth() + 1, now.getUTCDate());
  const out: UpcomingHoliday[] = [];
  for (const h of HOLIDAYS) {
    if (h.country !== country) continue;
    let date = resolveHolidayDate(h, today.getUTCFullYear());
    if (date.getTime() < today.getTime()) {
      date = resolveHolidayDate(h, today.getUTCFullYear() + 1);
    }
    const daysLeft = Math.round((date.getTime() - today.getTime()) / DAY_MS);
    if (daysLeft < 0 || daysLeft > withinDays) continue;
    const stage = stageOf(daysLeft, h.leadDays);
    const advice = adviceFor(stage, h.nameZh, h.nameEn, daysLeft, h.leadDays);
    out.push({
      id: h.id,
      nameZh: h.nameZh,
      nameEn: h.nameEn,
      date: toISODate(date),
      daysLeft,
      leadDays: h.leadDays,
      categories: h.categories,
      stage,
      prepAdviceZh: advice.zh,
      prepAdviceEn: advice.en,
      ...(h.note ? { note: h.note } : {}),
    });
  }
  out.sort((a, b) => a.daysLeft - b.daysLeft);
  return out;
}

/**
 * "现在热销"品类：处于备货/冲刺窗口内（daysLeft <= max(leadDays, 30)）的节日品类去重合并。
 */
export function getNowHotCategories(
  country: CountryCode,
  now: Date = new Date()
): CategoryTag[] {
  const upcoming = getUpcomingHolidays(country, now, 120);
  const seen = new Set<string>();
  const out: CategoryTag[] = [];
  for (const h of upcoming) {
    if (h.daysLeft > Math.max(h.leadDays, 30)) continue;
    for (const cat of h.categories) {
      if (seen.has(cat.zh)) continue;
      seen.add(cat.zh);
      out.push(cat);
    }
  }
  return out;
}

/** 校验国家代码。 */
export function isCountryCode(v: unknown): v is CountryCode {
  return typeof v === "string" && (COUNTRIES as readonly string[]).includes(v);
}
