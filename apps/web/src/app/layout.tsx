import type { ReactNode } from "react";
import "./globals.css";
import { getLang } from "@/i18n/lang";
import { I18nProvider } from "@/i18n/I18nProvider";

export const metadata = {
  title: "AdLinkLab",
  description: "Research SaaS for Google Ads tracking and attribution experiments",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const lang = await getLang();
  return (
    <html lang={lang}>
      <body>
        <I18nProvider initialLang={lang}>{children}</I18nProvider>
      </body>
    </html>
  );
}
