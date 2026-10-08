import type { ReactNode } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLang } from "@/i18n/lang";
import { getDictionary } from "@/i18n/dictionaries";
import { zh as experimentZh, en as experimentEn } from "@/i18n/dict/experiment";
import { LangSwitcher } from "@/components/lang-switcher";
import { getCurrentUser, getViewTenant } from "@/lib/api/auth";
import { clearViewTenantAction, logoutAction } from "@/lib/api/auth-actions";

/**
 * Authenticated app shell: sidebar nav + user footer.
 * Requires a valid session; otherwise redirects to /login.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const lang = await getLang();
  const t = getDictionary(lang);

  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const isAdmin = user.role === "admin";
  const viewTenant = isAdmin ? await getViewTenant() : null;
  // Researcher role (Phase 4): isolated to the Research Lab only.
  // AuthUser.role is typed "admin" | "user" — the researcher role arrives
  // from the API once the auth owner widens it; compare loosely so the
  // isolation works the moment it does.
  const isResearcher = (user.role as string) === "researcher";

  const researchNavItem = {
    href: "/research",
    label: t.research.nav.title,
  };

  interface NavSection {
    title: string;
    items: { href: string; label: string }[];
  }

  const s = t.common.nav.sections;
  const navSections: NavSection[] = isResearcher
    ? [{ title: s.experiment, items: [researchNavItem] }]
    : [
        {
          title: s.start,
          items: [
            { href: "/launch", label: t.launch.title },
            { href: "/dashboard", label: t.common.nav.dashboard },
          ],
        },
        {
          title: s.affiliate,
          items: [
            { href: "/networks", label: t.networks.page.title },
            { href: "/offers", label: t.common.nav.offers },
            { href: "/offers/import", label: t.ai.intel.nav.import },
            { href: "/merchants", label: t.ai.intel.nav.merchants },
            { href: "/amazon/discovery", label: "Amazon 选品" },
          ],
        },
        {
          title: s.cashback,
          items: [
            { href: "/cashback/offers", label: t.cashback.offers.title },
            { href: "/cashback/rotations", label: t.cashback.rotations.title },
            { href: "/cashback/rate-watch", label: t.cashbackRateWatch.page.title },
            { href: "/cashback/terms-watch", label: t.cashbackTermsWatch.termsWatch.title },
            { href: "/cashback/redirect-check", label: t.cashbackRedirectCheck.page.title },
            { href: "/cashback/rate-compare", label: t.cashbackRateCompare.rateCompare.title },
          ],
        },
        {
          title: s.ai,
          items: [
            { href: "/ai/analyze", label: t.ai.nav.analyze },
            { href: "/ai/terms", label: t.ai.nav.terms },
            { href: "/ai/compliance", label: t.ai.nav.compliance },
            { href: "/ai/brand-check", label: t.ai.nav.brandCheck },
            { href: "/ai/profit", label: t.ai.nav.profit },
            { href: "/ai/decision", label: t.ai.nav.decision },
            { href: "/ai/strategy", label: t.strategy.nav.strategy },
          ],
        },
        {
          title: s.lander,
          items: [
            { href: "/landing-pages", label: t.common.nav.landingPages },
            { href: "/landing-pages/analyze", label: t.ai.nav.lander },
            { href: "/landing-pages/templates", label: t.ai.nav.templates },
            { href: "/landing-pages/watch", label: t.ai.nav.competitorWatch },
            {
              href: "/landing-pages/optimization-queue",
              label: t.lpOptimization.title,
            },
          ],
        },
        {
          title: s.ads,
          items: [
            { href: "/ads/auto-create", label: t.adsAuto.title },
            { href: "/ads/rotation-script", label: "直链轮换 Script" },
            { href: "/google-accounts", label: t.common.nav.googleAccounts },
            { href: "/campaigns", label: t.common.nav.campaigns },
            { href: "/ad-groups", label: t.common.nav.adGroups },
            { href: "/ads", label: t.common.nav.ads },
          ],
        },
        {
          title: s.monitor,
          items: [
            { href: "/monitoring", label: t.ai.nav.monitoring },
            { href: "/link-health", label: t.deadLink.page.title },
            { href: "/search-terms", label: t.searchTerms.panel.title },
            { href: "/payout-watch", label: t.payoutWatch.payoutWatch.title },
            { href: "/budget-rules", label: t.budgetRules.budgetRules.title },
          ],
        },
        {
          title: s.experiment,
          items: [
            {
              href: "/experiments",
              label: (lang === "en" ? experimentEn : experimentZh).nav.experiments,
            },
            researchNavItem,
          ],
        },
        {
          title: s.reports,
          items: [
            { href: "/reports/weekly", label: t.weeklyReport.nav.title },
            { href: "/tracking-links", label: t.common.nav.trackingLinks },
            { href: "/clicks", label: t.common.nav.clicks },
            { href: "/conversions", label: t.common.nav.conversions },
            { href: "/orders", label: t.common.nav.orders },
            { href: "/url-versions", label: t.common.nav.urlVersions },
            { href: "/traffic/provenance", label: t.ai.intel.traffic.nav.provenance },
            {
              href: "/traffic/audit-report",
              label: t.ai.intel.traffic.nav.auditReport,
            },
          ],
        },
        {
          title: s.system,
          items: [
            { href: "/script-integrations", label: t.common.nav.scriptIntegrations },
            { href: "/jobs", label: t.common.nav.jobs },
            { href: "/audit-logs", label: t.common.nav.auditLogs },
            ...(isAdmin
              ? [
                  { href: "/admin/users", label: t.auth.nav.users },
                  { href: "/admin/ai-settings", label: t.ai.admin.nav.aiSettings },
                ]
              : []),
          ],
        },
      ];

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_1fr]">
      <aside className="flex flex-col border-r border-ink/10 bg-ink text-mist">
        <div className="px-5 py-6">
          <p className="font-display text-2xl tracking-tight">AdLinkLab</p>
          <p className="mt-1 text-sm text-mist/70">
            {t.common.brand.phase("Phase 8.4.7")}
          </p>
        </div>
        <nav className="flex flex-1 flex-col gap-4 px-3 pb-8">
          {navSections.map((section) => (
            <div key={section.title}>
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-mist/50">
                {section.title}
              </p>
              <div className="flex flex-col gap-0.5">
                {section.items.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="rounded-md px-3 py-2 text-sm text-mist/85 transition hover:bg-white/10 hover:text-white"
                  >
                    {item.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-medium text-white">{user.email}</p>
          <p className="mt-1">
            <span className="inline-block rounded-full bg-white/10 px-2 py-0.5 text-xs text-mist/80">
              {isAdmin ? t.auth.userMenu.admin : t.auth.userMenu.user}
            </span>
          </p>
          <div className="mt-3 flex items-center gap-2">
            <form action={logoutAction}>
              <button
                type="submit"
                className="rounded-md px-2.5 py-1 text-xs font-medium text-mist/60 transition hover:bg-white/5 hover:text-white"
              >
                {t.auth.userMenu.logout}
              </button>
            </form>
            <LangSwitcher />
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        {viewTenant ? (
          <div className="flex items-center justify-between gap-4 bg-sand/20 px-6 py-2 text-sm text-ink lg:px-10">
            <span>{t.auth.banner.viewingAs}</span>
            <form action={clearViewTenantAction}>
              <button
                type="submit"
                className="rounded-md bg-ink px-2.5 py-1 text-xs font-medium text-paper transition hover:bg-ink/85"
              >
                {t.auth.banner.exitView}
              </button>
            </form>
          </div>
        ) : null}
        <main className="px-6 py-8 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
