/**
 * Lander Intel ③ — high-converting template library.
 *
 * Pure functions only (no I/O): HTML-escaped template rendering plus the
 * built-in template catalog (review / comparison / listicle, each in en+zh).
 *
 * SECURITY (review focus): every variable value MUST pass through
 * `escapeHtml` before it reaches the output. No variable may inject raw
 * HTML, and `ctaUrl` values are additionally restricted to http(s) URLs
 * (anything else degrades to `#`). The built-in templates themselves ship
 * zero external JS and zero external resources.
 */

export type TemplateVariables = Record<
  string,
  string | string[] | Array<Record<string, unknown>> | null | undefined
>;

export type TemplateCategory =
  | "review"
  | "comparison"
  | "listicle"
  | "quiz"
  | "coupon"
  | "guide";

/**
 * Escape the five HTML-significant characters. Every user-supplied variable
 * value rendered into a template goes through this function.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  return "";
}

/**
 * CTA URLs must be absolute http(s) links. Relative/JS/data URIs (the classic
 * `javascript:` XSS vector in href attributes) degrade to `#`.
 */
export function sanitizeCtaUrl(raw: unknown): string {
  const url = toText(raw).trim();
  if (/^https?:\/\//i.test(url)) return url;
  return "#";
}

const PLACEHOLDER_RE = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;

/** Array-of-strings → `<li>` items, each item escaped. */
function renderListItems(value: unknown): string {
  const items = Array.isArray(value) ? value : [value];
  return items
    .map((item) => `<li>${escapeHtml(toText(item))}</li>`)
    .join("");
}

const PRODUCT_TABLE_COLUMNS = ["name", "price", "rating"] as const;

/**
 * Array-of-objects → comparison table rows (`<tr>`), one escaped `<td>`
 * per fixed column plus a CTA link cell. `featured: true` on a row marks it
 * as the "our pick" highlight row (CSS class only, no content injected).
 */
function renderProductRows(
  products: unknown,
  ctaText: string
): string {
  if (!Array.isArray(products)) return "";
  return products
    .slice(0, 4)
    .map((entry) => {
      const row =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      const cells = PRODUCT_TABLE_COLUMNS.map(
        (col) => `<td>${escapeHtml(toText(row[col]))}</td>`
      ).join("");
      const url = sanitizeCtaUrl(row.ctaUrl);
      const ctaCell =
        url === "#"
          ? "<td><span>—</span></td>"
          : `<td><a href="${escapeHtml(url)}" rel="nofollow sponsored noopener">${escapeHtml(ctaText)}</a></td>`;
      const featured =
        row.featured === true || row.featured === "true"
          ? ' class="lp-featured"'
          : "";
      return `<tr${featured}>${cells}${ctaCell}</tr>`;
    })
    .join("");
}

/**
 * Array-of-objects → standalone product cards (listicle layout), each with
 * its own CTA. Fields: rank / name / blurb / price / ctaUrl.
 */
function renderProductCards(
  products: unknown,
  ctaText: string
): string {
  if (!Array.isArray(products)) return "";
  return products
    .map((entry, index) => {
      const row =
        entry && typeof entry === "object"
          ? (entry as Record<string, unknown>)
          : {};
      const rank = toText(row.rank) || String(index + 1);
      const url = sanitizeCtaUrl(row.ctaUrl);
      const cta =
        url === "#"
          ? `<span class="lp-cta lp-cta-disabled">${escapeHtml(ctaText)}</span>`
          : `<a class="lp-cta" href="${escapeHtml(url)}" rel="nofollow sponsored noopener">${escapeHtml(ctaText)}</a>`;
      return `<article class="lp-card"><div class="lp-rank">#${escapeHtml(rank)}</div><h3 class="lp-card-name">${escapeHtml(toText(row.name))}</h3><p class="lp-blurb">${escapeHtml(toText(row.blurb))}</p><div class="lp-price">${escapeHtml(toText(row.price))}</div>${cta}</article>`;
    })
    .join("");
}

export interface RenderTemplateOptions {
  /** How `{{products}}` is rendered. Defaults to "table". */
  productsLayout?: "table" | "cards";
}

/**
 * Render a template by replacing `{{variable}}` placeholders.
 *
 * - `{{ctaUrl}}` is sanitized to http(s)-only (else `#`).
 * - `{{pros}}` / `{{cons}}` accept arrays → escaped `<li>` lists.
 * - `{{products}}` accepts an array of objects → escaped comparison table
 *   rows, or escaped product cards when `productsLayout: "cards"`.
 * - Unknown placeholders are left untouched (helps template debugging).
 * - Everything else is stringified and HTML-escaped.
 */
export function renderTemplate(
  htmlTemplate: string,
  variables: TemplateVariables,
  options: RenderTemplateOptions = {}
): string {
  const vars = variables ?? {};
  const ctaText = toText(vars.ctaText) || "Get Deal";
  const productsLayout = options.productsLayout ?? "table";
  return htmlTemplate.replace(PLACEHOLDER_RE, (match, name: string) => {
    const value = vars[name];
    switch (name) {
      case "ctaUrl":
        return escapeHtml(sanitizeCtaUrl(value));
      case "pros":
      case "cons":
        return renderListItems(value);
      case "products":
        return productsLayout === "cards"
          ? renderProductCards(value, ctaText)
          : renderProductRows(value, ctaText);
      default:
        if (value === undefined || value === null) return match;
        if (Array.isArray(value)) return renderListItems(value);
        return escapeHtml(toText(value));
    }
  });
}

/** Sorted, deduplicated placeholder names found in a template. */
export function extractTemplateVariables(htmlTemplate: string): string[] {
  const names = new Set<string>();
  for (const match of htmlTemplate.matchAll(PLACEHOLDER_RE)) {
    names.add(match[1]);
  }
  return [...names].sort();
}

/** Variable names used by a built-in template; null when the id is unknown. */
export function listTemplateVariables(templateId: string): string[] | null {
  const tpl = getBuiltInTemplate(templateId);
  if (!tpl) return null;
  return extractTemplateVariables(tpl.html.en);
}

// ---------------------------------------------------------------------------
// Built-in templates (code constants, never DB rows).
// Each ships en + zh static copy; user-filled variables may be any language.
// No external JS, no external resources (CSP friendly).
// ---------------------------------------------------------------------------

export interface BuiltInTemplate {
  id: string;
  category: TemplateCategory;
  name: { zh: string; en: string };
  description: { zh: string; en: string };
  html: { zh: string; en: string };
}

const SHARED_CSS = `
  *{box-sizing:border-box}
  body{margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Microsoft YaHei",sans-serif;color:#1f2937;background:#f9fafb;line-height:1.65}
  .lp-wrap{max-width:720px;margin:0 auto;padding:28px 18px 48px;background:#ffffff}
  .lp-h1{font-size:26px;line-height:1.35;margin:0 0 8px;color:#111827}
  .lp-sub{color:#6b7280;font-size:14px;margin:0 0 20px}
  .lp-cta{display:inline-block;background:#16a34a;color:#ffffff !important;text-decoration:none;font-weight:700;font-size:18px;padding:14px 36px;border-radius:10px;margin:18px 0;text-align:center}
  .lp-cta:hover{background:#15803d}
  .lp-cta-disabled{background:#9ca3af}
  .lp-disclosure{font-size:12px;color:#9ca3af;margin-top:28px;border-top:1px solid #e5e7eb;padding-top:14px}
  .lp-section{margin:26px 0}
  .lp-section h2{font-size:20px;margin:0 0 12px;color:#111827;border-left:4px solid #16a34a;padding-left:10px}
  @media (max-width:560px){
    .lp-wrap{padding:20px 14px 36px}
    .lp-h1{font-size:22px}
    .lp-cta{width:100%;padding:14px 12px}
  }
`;

const REVIEW_CSS = `${SHARED_CSS}
  .lp-rating-card{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px;text-align:center;margin:18px 0}
  .lp-score{font-size:44px;font-weight:800;color:#16a34a;line-height:1.1}
  .lp-score small{font-size:18px;color:#6b7280;font-weight:400}
  .lp-stars{color:#f59e0b;font-size:20px;letter-spacing:2px}
  .lp-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
  .lp-pros,.lp-cons{border-radius:10px;padding:14px 16px}
  .lp-pros{background:#f0fdf4;border:1px solid #bbf7d0}
  .lp-cons{background:#fef2f2;border:1px solid #fecaca}
  .lp-pros h3,.lp-cons h3{margin:0 0 8px;font-size:16px}
  .lp-pros h3{color:#15803d}
  .lp-cons h3{color:#b91c1c}
  .lp-pros ul,.lp-cons ul{margin:0;padding-left:20px;font-size:14px}
  .lp-pros li,.lp-cons li{margin:4px 0}
  .lp-price-box{text-align:center;margin:22px 0 8px}
  .lp-was{color:#9ca3af;text-decoration:line-through;font-size:18px;margin-right:10px}
  .lp-now{color:#dc2626;font-size:34px;font-weight:800}
  .lp-faq-item{border-bottom:1px solid #e5e7eb;padding:10px 0}
  .lp-faq-item p{margin:4px 0;font-size:14px}
  .lp-faq-q{font-weight:700}
  @media (max-width:560px){.lp-cols{grid-template-columns:1fr}}
`;

const REVIEW_FAQ_EN = `
    <div class="lp-faq-item"><p class="lp-faq-q">Is there a money-back guarantee?</p><p>Most offers in this category include at least a 30-day money-back guarantee. Check the official checkout page for the exact terms before you buy.</p></div>
    <div class="lp-faq-item"><p class="lp-faq-q">How fast is shipping?</p><p>Shipping speed depends on your region and the option you pick at checkout. Digital products are usually delivered instantly by email.</p></div>
    <div class="lp-faq-item"><p class="lp-faq-q">Is this a one-time payment or a subscription?</p><p>Read the pricing section on the official page carefully — some deals renew automatically. Cancel before the renewal date if you only want the trial period.</p></div>`;

const REVIEW_FAQ_ZH = `
    <div class="lp-faq-item"><p class="lp-faq-q">有退款保证吗？</p><p>这类产品大多提供至少 30 天退款保证，下单前请在官方结算页确认具体条款。</p></div>
    <div class="lp-faq-item"><p class="lp-faq-q">发货要多久？</p><p>发货时效取决于地区和结算时选择的物流方式；数字产品通常通过邮件即时交付。</p></div>
    <div class="lp-faq-item"><p class="lp-faq-q">是一次性付款还是订阅？</p><p>请仔细阅读官方页面的价格说明——部分优惠会自动续费。如只需试用，请在续费日前取消。</p></div>`;

const REVIEW_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} Review: Is It Worth Your Money?</h1>
    <p class="lp-sub">Honest hands-on review — updated with the latest pricing and deal.</p>
    <div class="lp-rating-card">
      <div class="lp-score">{{rating}}<small>/5</small></div>
      <div class="lp-stars">★★★★★</div>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280">Based on {{reviewCount}} verified reviews</p>
    </div>
    <div class="lp-cols">
      <section class="lp-pros"><h3>✅ Pros</h3><ul>{{pros}}</ul></section>
      <section class="lp-cons"><h3>❌ Cons</h3><ul>{{cons}}</ul></section>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>Frequently Asked Questions</h2>
      ${REVIEW_FAQ_EN}
    </section>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const REVIEW_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} 深度评测：到底值不值得买？</h1>
    <p class="lp-sub">真实上手评测 —— 已更新为最新价格与优惠信息。</p>
    <div class="lp-rating-card">
      <div class="lp-score">{{rating}}<small>/5</small></div>
      <div class="lp-stars">★★★★★</div>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280">基于 {{reviewCount}} 条真实评价</p>
    </div>
    <div class="lp-cols">
      <section class="lp-pros"><h3>✅ 优点</h3><ul>{{pros}}</ul></section>
      <section class="lp-cons"><h3>❌ 缺点</h3><ul>{{cons}}</ul></section>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>常见问题</h2>
      ${REVIEW_FAQ_ZH}
    </section>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const COMPARISON_CSS = `${SHARED_CSS}
  .lp-table-wrap{overflow-x:auto;margin:20px 0;border:1px solid #e5e7eb;border-radius:10px}
  table.lp-table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
  .lp-table th{background:#111827;color:#fff;text-align:left;padding:12px 10px;white-space:nowrap}
  .lp-table td{padding:12px 10px;border-top:1px solid #e5e7eb;vertical-align:middle}
  .lp-table tr.lp-featured td{background:#f0fdf4}
  .lp-pick{display:inline-block;background:#16a34a;color:#fff;font-size:11px;font-weight:700;padding:2px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
  .lp-table a{color:#16a34a;font-weight:700;text-decoration:none}
  .lp-table a:hover{text-decoration:underline}
  .lp-note{font-size:13px;color:#6b7280}
`;

const COMPARISON_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} vs Alternatives: Side-by-Side Comparison</h1>
    <p class="lp-sub">We compared the top options on price, rating and value — here is the honest breakdown.</p>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr><th>Product</th><th>Price</th><th>Rating</th><th>Deal</th></tr></thead>
        <tbody>{{products}}</tbody>
      </table>
    </div>
    <p class="lp-note">Highlighted row = our top pick for most buyers.</p>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const COMPARISON_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} 与竞品横向对比：选谁一目了然</h1>
    <p class="lp-sub">我们从价格、评分、性价比三个维度对比了热门选项——结论都在下表里。</p>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr><th>产品</th><th>价格</th><th>评分</th><th>优惠链接</th></tr></thead>
        <tbody>{{products}}</tbody>
      </table>
    </div>
    <p class="lp-note">高亮行 = 我们推荐大多数人的首选。</p>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const LISTICLE_CSS = `${SHARED_CSS}
  .lp-card{border:1px solid #e5e7eb;border-radius:12px;padding:18px;margin:16px 0;background:#fff}
  .lp-rank{display:inline-block;background:#111827;color:#fff;font-weight:800;font-size:13px;padding:3px 12px;border-radius:999px;margin-bottom:8px}
  .lp-card-name{margin:0 0 6px;font-size:19px;color:#111827}
  .lp-blurb{margin:0 0 10px;font-size:14px;color:#4b5563}
  .lp-price{font-size:22px;font-weight:800;color:#dc2626;margin-bottom:10px}
  .lp-card .lp-cta{font-size:16px;padding:11px 28px;margin:6px 0 0}
`;

const LISTICLE_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">Top 5 {{productName}} Picks for This Year</h1>
    <p class="lp-sub">Tested and ranked — skip the duds and go straight to what actually works.</p>
    {{products}}
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const LISTICLE_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">今年最值得买的 {{productName}} Top 5</h1>
    <p class="lp-sub">实测排名 —— 跳过坑货，直接看真正好用的。</p>
    {{products}}
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

function pageDocument(lang: "en" | "zh", css: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title></title>
<style>${css}
</style>
</head>
<body>${body}
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Task 4 — five additional high-converting built-ins (2026-10-09).
// Each ships en + zh static copy, zero external JS/resources, static
// affiliate disclosure, and reuses the shared placeholder renderer
// ({{pros}}/{{cons}}/{{products}}/{{ctaUrl}} are escaped server-side).
// ---------------------------------------------------------------------------

const PAINSTORY_CSS = `${SHARED_CSS}
  .lp-trust{list-style:none;margin:14px 0;padding:0;display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
  .lp-trust li{background:#eff6ff;border:1px solid #bfdbfe;color:#1d4ed8;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px}
  .lp-rating-card{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:18px;text-align:center;margin:18px 0}
  .lp-score{font-size:44px;font-weight:800;color:#16a34a;line-height:1.1}
  .lp-score small{font-size:18px;color:#6b7280;font-weight:400}
  .lp-stars{color:#f59e0b;font-size:20px;letter-spacing:2px}
  .lp-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}
  .lp-pros,.lp-cons{border-radius:10px;padding:14px 16px}
  .lp-pros{background:#f0fdf4;border:1px solid #bbf7d0}
  .lp-cons{background:#fef2f2;border:1px solid #fecaca}
  .lp-pros h3,.lp-cons h3{margin:0 0 8px;font-size:16px}
  .lp-pros h3{color:#15803d}
  .lp-cons h3{color:#b91c1c}
  .lp-pros ul,.lp-cons ul{margin:0;padding-left:20px;font-size:14px}
  .lp-price-box{text-align:center;margin:22px 0 8px}
  .lp-was{color:#9ca3af;text-decoration:line-through;font-size:18px;margin-right:10px}
  .lp-now{color:#dc2626;font-size:34px;font-weight:800}
  .lp-guarantee{background:#fffbeb;border:1px dashed #f59e0b;border-radius:10px;padding:12px 16px;font-size:14px;margin:18px 0;text-align:center}
  .lp-faq-item{border-bottom:1px solid #e5e7eb;padding:10px 0}
  .lp-faq-item p{margin:4px 0;font-size:14px}
  .lp-faq-q{font-weight:700}
  @media (max-width:560px){.lp-cols{grid-template-columns:1fr}}
`;

const PAINSTORY_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">Tired of {{painPoint}}? {{productName}} Might Finally Be the Fix</h1>
    <p class="lp-sub">We spent 3 weeks testing it so you don't have to — here's the honest verdict.</p>
    <ul class="lp-trust">{{trustItems}}</ul>
    <div class="lp-rating-card">
      <div class="lp-score">{{rating}}<small>/5</small></div>
      <div class="lp-stars">★★★★★</div>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280">Based on {{reviewCount}} verified reviews</p>
    </div>
    <div class="lp-cols">
      <section class="lp-pros"><h3>✅ Pros</h3><ul>{{pros}}</ul></section>
      <section class="lp-cons"><h3>❌ Cons</h3><ul>{{cons}}</ul></section>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <div class="lp-guarantee">🛡️ {{guaranteeText}}</div>
    <section class="lp-section">
      <h2>Frequently Asked Questions</h2>
      ${REVIEW_FAQ_EN}
    </section>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const PAINSTORY_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">还在被{{painPoint}}折磨？{{productName}}可能是终结它的答案</h1>
    <p class="lp-sub">我们实测了 3 周，把真实结论放在这里——不吹不黑。</p>
    <ul class="lp-trust">{{trustItems}}</ul>
    <div class="lp-rating-card">
      <div class="lp-score">{{rating}}<small>/5</small></div>
      <div class="lp-stars">★★★★★</div>
      <p style="margin:8px 0 0;font-size:13px;color:#6b7280">基于 {{reviewCount}} 条真实评价</p>
    </div>
    <div class="lp-cols">
      <section class="lp-pros"><h3>✅ 优点</h3><ul>{{pros}}</ul></section>
      <section class="lp-cons"><h3>❌ 缺点</h3><ul>{{cons}}</ul></section>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <div class="lp-guarantee">🛡️ {{guaranteeText}}</div>
    <section class="lp-section">
      <h2>常见问题</h2>
      ${REVIEW_FAQ_ZH}
    </section>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const SHOWDOWN_CSS = `${SHARED_CSS}
  .lp-versus{display:flex;align-items:center;justify-content:center;gap:14px;margin:22px 0}
  .lp-fighter{flex:1;text-align:center;background:#f9fafb;border:1px solid #e5e7eb;border-radius:12px;padding:16px 10px;font-weight:700;font-size:16px}
  .lp-vs{font-size:22px;font-weight:800;color:#dc2626;background:#fef2f2;border-radius:50%;width:52px;height:52px;display:flex;align-items:center;justify-content:center;flex:none}
  .lp-verdict{background:#111827;color:#fff;border-radius:12px;padding:18px;margin:20px 0}
  .lp-verdict h2{margin:0 0 8px;font-size:18px;color:#fbbf24;border:none;padding:0}
  .lp-verdict p{margin:0;font-size:14px;color:#e5e7eb}
  .lp-table-wrap{overflow-x:auto;margin:20px 0;border:1px solid #e5e7eb;border-radius:10px}
  table.lp-table{width:100%;border-collapse:collapse;font-size:14px;min-width:520px}
  .lp-table th{background:#111827;color:#fff;text-align:left;padding:12px 10px;white-space:nowrap}
  .lp-table td{padding:12px 10px;border-top:1px solid #e5e7eb;vertical-align:middle}
  .lp-table tr.lp-featured td{background:#f0fdf4}
  .lp-table a{color:#16a34a;font-weight:700;text-decoration:none}
  .lp-note{font-size:13px;color:#6b7280}
`;

const SHOWDOWN_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} vs {{challengerName}}: Which One Actually Wins?</h1>
    <p class="lp-sub">Head-to-head test on price, features and real-world results — no fluff.</p>
    <div class="lp-versus">
      <div class="lp-fighter">{{productName}}</div>
      <div class="lp-vs">VS</div>
      <div class="lp-fighter">{{challengerName}}</div>
    </div>
    <div class="lp-verdict">
      <h2>🏆 Our Verdict</h2>
      <p>{{verdictText}}</p>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr><th>Product</th><th>Price</th><th>Rating</th><th>Deal</th></tr></thead>
        <tbody>{{products}}</tbody>
      </table>
    </div>
    <p class="lp-note">Highlighted row = our top pick for most buyers.</p>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>Quick Answers</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">Which one is better value?</p><p>{{verdictText}}</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">Can I switch later if I pick wrong?</p><p>Both options in this category allow cancellation or returns within the guarantee window — check the official terms before you commit.</p></div>
    </section>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const SHOWDOWN_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} 对决 {{challengerName}}：到底谁更值得买？</h1>
    <p class="lp-sub">价格、功能、真实体验三项硬碰硬——结论先行，不绕弯子。</p>
    <div class="lp-versus">
      <div class="lp-fighter">{{productName}}</div>
      <div class="lp-vs">VS</div>
      <div class="lp-fighter">{{challengerName}}</div>
    </div>
    <div class="lp-verdict">
      <h2>🏆 我们的结论</h2>
      <p>{{verdictText}}</p>
    </div>
    <div class="lp-table-wrap">
      <table class="lp-table">
        <thead><tr><th>产品</th><th>价格</th><th>评分</th><th>优惠链接</th></tr></thead>
        <tbody>{{products}}</tbody>
      </table>
    </div>
    <p class="lp-note">高亮行 = 我们推荐大多数人的首选。</p>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>快速问答</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">哪个性价比更高？</p><p>{{verdictText}}</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">选错了能换吗？</p><p>这类产品大多支持保证期内的取消或退货，下单前请确认官方条款。</p></div>
    </section>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const SCENARIO_CSS = `${LISTICLE_CSS}
  .lp-intro{background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:16px 18px;font-size:14px;color:#1e40af;margin:18px 0}
`;

const SCENARIO_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">The Best {{productName}} for Every Budget and Use Case</h1>
    <p class="lp-sub">Not one "best" — the right pick for <em>your</em> situation.</p>
    <div class="lp-intro">{{introText}}</div>
    {{products}}
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const SCENARIO_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">不同预算、不同场景：最值得买的{{productName}}都在这</h1>
    <p class="lp-sub">没有唯一的"最好"，只有最适合你的那一款。</p>
    <div class="lp-intro">{{introText}}</div>
    {{products}}
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const COUPON_CSS = `${SHARED_CSS}
  .lp-deal-hero{background:linear-gradient(135deg,#dc2626,#f59e0b);border-radius:14px;padding:26px 20px;text-align:center;color:#fff;margin:18px 0}
  .lp-deal-hero .lp-off{font-size:46px;font-weight:800;line-height:1.1}
  .lp-deal-hero p{margin:8px 0 0;font-size:14px;opacity:.95}
  .lp-coupon{border:2px dashed #dc2626;border-radius:12px;padding:16px;text-align:center;margin:20px 0;background:#fef2f2}
  .lp-coupon .lp-code{display:block;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:26px;font-weight:800;letter-spacing:3px;color:#b91c1c;margin:6px 0}
  .lp-coupon small{color:#6b7280;font-size:12px}
  .lp-urgency{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:12px 16px;font-size:14px;text-align:center;margin:18px 0;color:#92400e}
  .lp-price-box{text-align:center;margin:22px 0 8px}
  .lp-was{color:#9ca3af;text-decoration:line-through;font-size:18px;margin-right:10px}
  .lp-now{color:#dc2626;font-size:34px;font-weight:800}
  .lp-faq-item{border-bottom:1px solid #e5e7eb;padding:10px 0}
  .lp-faq-item p{margin:4px 0;font-size:14px}
  .lp-faq-q{font-weight:700}
`;

const COUPON_BODY_EN = `
  <main class="lp-wrap">
    <div class="lp-deal-hero">
      <div class="lp-off">{{discountInfo}}</div>
      <p>{{productName}} — exclusive reader deal</p>
    </div>
    <h1 class="lp-h1" style="text-align:center">{{productName}} Coupon: Save {{discountInfo}} Today</h1>
    <div class="lp-coupon">
      <small>USE THIS CODE AT CHECKOUT</small>
      <span class="lp-code">{{couponCode}}</span>
      <small>Copy the code, then click below — the discount applies automatically.</small>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <div class="lp-urgency">⏰ {{expiryText}}</div>
    <section class="lp-section">
      <h2>Coupon FAQ</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">Does the code really work?</p><p>We verify every code before publishing. If a code expires, the checkout page will tell you — no charge is made until you confirm the order.</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">Can I combine it with other offers?</p><p>Usually not — merchants rarely allow stacking coupon codes. The code above is already the best public deal we could find.</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">Is there a money-back guarantee?</p><p>Most offers in this category include at least a 30-day guarantee. Check the official checkout page for exact terms.</p></div>
    </section>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const COUPON_BODY_ZH = `
  <main class="lp-wrap">
    <div class="lp-deal-hero">
      <div class="lp-off">{{discountInfo}}</div>
      <p>{{productName}} —— 读者专享优惠</p>
    </div>
    <h1 class="lp-h1" style="text-align:center">{{productName}}优惠券：今日立减{{discountInfo}}</h1>
    <div class="lp-coupon">
      <small>结算时使用此优惠码</small>
      <span class="lp-code">{{couponCode}}</span>
      <small>复制优惠码后点击下方按钮，折扣将自动生效。</small>
    </div>
    <div class="lp-price-box">
      <span class="lp-was">{{originalPrice}}</span>
      <span class="lp-now">{{price}}</span>
    </div>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <div class="lp-urgency">⏰ {{expiryText}}</div>
    <section class="lp-section">
      <h2>优惠券常见问题</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">优惠码真的有效吗？</p><p>我们发布前都会验证每个优惠码。若已过期，结算页会提示，确认订单前不会扣费。</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">能和其他优惠叠加吗？</p><p>通常不能——商家很少允许叠加使用优惠码。上面的已是全网能找到的最优公开价。</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">有退款保证吗？</p><p>这类产品大多提供至少 30 天退款保证，下单前请在官方结算页确认具体条款。</p></div>
    </section>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

const GUIDE_CSS = `${SHARED_CSS}
  .lp-steps{list-style:none;margin:18px 0;padding:0;counter-reset:step}
  .lp-steps li{position:relative;padding:14px 16px 14px 58px;border:1px solid #e5e7eb;border-radius:12px;margin:12px 0;background:#fff;font-size:14px}
  .lp-steps li::before{counter-increment:step;content:counter(step);position:absolute;left:14px;top:14px;width:32px;height:32px;border-radius:50%;background:#16a34a;color:#fff;font-weight:800;display:flex;align-items:center;justify-content:center;font-size:15px}
  .lp-keypoints{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:16px 18px;margin:20px 0}
  .lp-keypoints h3{margin:0 0 8px;font-size:16px;color:#15803d}
  .lp-keypoints ul{margin:0;padding-left:20px;font-size:14px}
  .lp-mid-cta{text-align:center;margin:24px 0}
  .lp-faq-item{border-bottom:1px solid #e5e7eb;padding:10px 0}
  .lp-faq-item p{margin:4px 0;font-size:14px}
  .lp-faq-q{font-weight:700}
`;

const GUIDE_BODY_EN = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}} Buying Guide: How to Choose the Right One</h1>
    <p class="lp-sub">Read this before you spend a dollar — the 5-minute version of what took us weeks to learn.</p>
    <ol class="lp-steps">{{guideSteps}}</ol>
    <div class="lp-keypoints">
      <h3>📌 Key Takeaways</h3>
      <ul>{{keyPoints}}</ul>
    </div>
    <div class="lp-mid-cta">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>Frequently Asked Questions</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">What's the biggest mistake beginners make?</p><p>Buying on price alone. The cheapest option usually costs more in replacements, fees or missing features within a year.</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">How much should I budget?</p><p>{{priceHint}}</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">Where is it safe to buy?</p><p>Only through the official store or authorized retailers linked on this page — marketplace knockoffs are the #1 complaint in this category.</p></div>
    </section>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">Disclosure: this page may contain affiliate links. If you buy through them, we may earn a commission at no extra cost to you.</p>
  </main>`;

const GUIDE_BODY_ZH = `
  <main class="lp-wrap">
    <h1 class="lp-h1">{{productName}}选购指南：3 分钟选对不踩坑</h1>
    <p class="lp-sub">花钱之前先看这篇——我们花几周踩过的坑，浓缩成 5 分钟。</p>
    <ol class="lp-steps">{{guideSteps}}</ol>
    <div class="lp-keypoints">
      <h3>📌 核心结论</h3>
      <ul>{{keyPoints}}</ul>
    </div>
    <div class="lp-mid-cta">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <section class="lp-section">
      <h2>常见问题</h2>
      <div class="lp-faq-item"><p class="lp-faq-q">新手最容易犯的错误是什么？</p><p>只看价格买最便宜的。一年内，换新、手续费或功能缺失的成本往往更高。</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">预算多少合适？</p><p>{{priceHint}}</p></div>
      <div class="lp-faq-item"><p class="lp-faq-q">哪里买最靠谱？</p><p>只走官网或本页链接的授权渠道——山寨假货是这个品类投诉最多的坑。</p></div>
    </section>
    <div style="text-align:center">
      <a class="lp-cta" href="{{ctaUrl}}" rel="nofollow sponsored noopener">{{ctaText}}</a>
    </div>
    <p class="lp-disclosure">声明：本页面可能包含推广链接，通过它们购买我们可能获得佣金，您无需支付额外费用。</p>
  </main>`;

export const BUILT_IN_TEMPLATES: BuiltInTemplate[] = [
  {
    id: "builtin-review",
    category: "review",
    name: { zh: "单品深度评测", en: "In-Depth Product Review" },
    description: {
      zh: "评分卡 + 优缺点双栏 + 价格锚点 + 大 CTA + FAQ，适合单 Offer 预热。",
      en: "Rating card, pros/cons columns, price anchor, big CTA and FAQ — best for warming up a single offer.",
    },
    html: {
      en: pageDocument("en", REVIEW_CSS, REVIEW_BODY_EN),
      zh: pageDocument("zh", REVIEW_CSS, REVIEW_BODY_ZH),
    },
  },
  {
    id: "builtin-comparison",
    category: "comparison",
    name: { zh: "横向对比表", en: "Side-by-Side Comparison" },
    description: {
      zh: "多产品对比表（最多 4 列），支持高亮“我们的选择”，适合截流竞品流量。",
      en: "Multi-product comparison table (up to 4 columns) with an “our pick” highlight — great for intercepting competitor traffic.",
    },
    html: {
      en: pageDocument("en", COMPARISON_CSS, COMPARISON_BODY_EN),
      zh: pageDocument("zh", COMPARISON_CSS, COMPARISON_BODY_ZH),
    },
  },
  {
    id: "builtin-listicle",
    category: "listicle",
    name: { zh: "Top 榜单", en: "Top Picks Listicle" },
    description: {
      zh: "Top 榜单结构，每项独立卡片 + 独立 CTA，适合多 Offer 导流。",
      en: "Ranked listicle layout with one card and CTA per product — best for funneling multiple offers.",
    },
    html: {
      en: pageDocument("en", LISTICLE_CSS, LISTICLE_BODY_EN),
      zh: pageDocument("zh", LISTICLE_CSS, LISTICLE_BODY_ZH),
    },
  },
  {
    id: "builtin-review-painstory",
    category: "review",
    name: { zh: "痛点故事型评测", en: "Pain-Point Story Review" },
    description: {
      zh: "以用户痛点开场 → 信任背书 → 评分 + 优缺点 → 价格锚点 → 大 CTA，转化路径更完整。",
      en: "Pain-led hero, trust badges, rating card, pros/cons, price anchor and big CTA — a fuller conversion path.",
    },
    html: {
      en: pageDocument("en", PAINSTORY_CSS, PAINSTORY_BODY_EN),
      zh: pageDocument("zh", PAINSTORY_CSS, PAINSTORY_BODY_ZH),
    },
  },
  {
    id: "builtin-comparison-showdown",
    category: "comparison",
    name: { zh: "双雄对决对比页", en: "Head-to-Head Showdown" },
    description: {
      zh: "A vs B 正面对决：结论先行 + 对比表 + 快速问答，适合截流品牌词流量。",
      en: "A-vs-B showdown with verdict-first layout, comparison table and quick answers — built to intercept branded search traffic.",
    },
    html: {
      en: pageDocument("en", SHOWDOWN_CSS, SHOWDOWN_BODY_EN),
      zh: pageDocument("zh", SHOWDOWN_CSS, SHOWDOWN_BODY_ZH),
    },
  },
  {
    id: "builtin-listicle-scenario",
    category: "listicle",
    name: { zh: "场景精选榜单", en: "Best-for-You Listicle" },
    description: {
      zh: "按场景/预算分榜推荐，每款独立卡片 + CTA，覆盖更宽的搜索意图。",
      en: "Scenario-based picks with one card and CTA per product — covers broader search intent.",
    },
    html: {
      en: pageDocument("en", SCENARIO_CSS, SCENARIO_BODY_EN),
      zh: pageDocument("zh", SCENARIO_CSS, SCENARIO_BODY_ZH),
    },
  },
  {
    id: "builtin-coupon",
    category: "coupon",
    name: { zh: "限时优惠券页", en: "Coupon Deal Page" },
    description: {
      zh: "大折扣 hero + 优惠码展示框 + 紧迫感文案，专为折扣/优惠券类关键词设计。",
      en: "Big-discount hero, coupon-code box and urgency copy — made for coupon/deal keywords.",
    },
    html: {
      en: pageDocument("en", COUPON_CSS, COUPON_BODY_EN),
      zh: pageDocument("zh", COUPON_CSS, COUPON_BODY_ZH),
    },
  },
  {
    id: "builtin-guide",
    category: "guide",
    name: { zh: "选购指南（FAQ）", en: "Buyer's Guide & FAQ" },
    description: {
      zh: "选购步骤指南 + 核心结论 + 常见问题 + 双 CTA，适合信息型关键词预热。",
      en: "Step-by-step buying guide with key takeaways, FAQ and dual CTAs — warms up informational keywords.",
    },
    html: {
      en: pageDocument("en", GUIDE_CSS, GUIDE_BODY_EN),
      zh: pageDocument("zh", GUIDE_CSS, GUIDE_BODY_ZH),
    },
  },
];

export function getBuiltInTemplate(id: string): BuiltInTemplate | null {
  return BUILT_IN_TEMPLATES.find((t) => t.id === id) ?? null;
}

/** Pick the `en` or `zh` HTML of a built-in template. Defaults to zh. */
export function builtInHtmlTemplate(
  id: string,
  lang: string | undefined
): string | null {
  const tpl = getBuiltInTemplate(id);
  if (!tpl) return null;
  return lang === "en" ? tpl.html.en : tpl.html.zh;
}

export const TEMPLATE_CATEGORIES: TemplateCategory[] = [
  "review",
  "comparison",
  "listicle",
  "quiz",
  "coupon",
  "guide",
];

export function isTemplateCategory(value: unknown): value is TemplateCategory {
  return (
    typeof value === "string" &&
    (TEMPLATE_CATEGORIES as string[]).includes(value)
  );
}
