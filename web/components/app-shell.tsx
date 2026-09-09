"use client";

/**
 * The responsive application frame.
 *
 * This replaces the inherited `PhoneFrame` for every new screen. That component
 * draws a simulated phone bezel and pins content to a ~24rem column, which is
 * fine for a demo mock and wrong for the actual product: on a 1920px monitor an
 * agronomist got a phone-shaped sliver in the middle of the page.
 *
 * Layout, by breakpoint:
 *   < 768px   single column, bottom navigation, header collapses
 *   ≥ 768px   wider content column, bottom navigation still present
 *   ≥ 1024px  persistent left sidebar, bottom navigation removed
 *   ≥ 1536px  content is capped and centred so text lines stay readable
 *
 * "Full width" means the shell uses the whole viewport — not that a paragraph
 * is allowed to run 1900px wide, which is unreadable. Wide screens get more
 * columns, not longer lines.
 */
import { LanguageSwitcher, useLanguage } from "@/components/language-provider";
import { cn } from "@/lib/utils";
import { OfflineBanner } from "@/features/pwa/pwa-controls";
import { BookOpen, Home, MessageCircleQuestion, Sprout, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type NavItem = { href: string; icon: LucideIcon; labelKey: "navHome" | "navPlan" | "navJournal" | "navAsk" };

const NAV: NavItem[] = [
  { href: "/", icon: Home, labelKey: "navHome" },
  { href: "/plan", icon: Sprout, labelKey: "navPlan" },
  { href: "/journal", icon: BookOpen, labelKey: "navJournal" },
  { href: "/ask", icon: MessageCircleQuestion, labelKey: "navAsk" },
];

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AppShell({
  children,
  title,
  headerActions,
}: {
  children: ReactNode;
  /** Screen title. Shown in the header on small screens. */
  title?: string;
  /** Field/season selector, notifications — supplied per screen. */
  headerActions?: ReactNode;
}) {
  const { t } = useLanguage();
  const pathname = usePathname() ?? "/";

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[16rem_1fr]">
      {/* Desktop sidebar. Hidden below lg, where bottom nav takes over. */}
      <aside className="hidden border-r border-mist bg-card lg:sticky lg:top-0 lg:flex lg:h-dvh lg:flex-col">
        <div className="border-b border-mist px-5 py-4">
          <p className="text-h3 font-semibold text-forest">{t("appName")}</p>
          <p className="mt-0.5 text-xs text-slate">{t("tagline")}</p>
        </div>
        <nav aria-label={t("navHome")} className="flex-1 p-3">
          <ul className="space-y-1">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[48px] items-center gap-3 rounded-control px-3 text-sm font-semibold",
                      active
                        ? "bg-[color-mix(in_srgb,var(--sprout)_14%,transparent)] text-forest"
                        : "text-slate hover:bg-[color-mix(in_srgb,var(--mist)_40%,transparent)] hover:text-ink",
                    )}
                  >
                    <item.icon aria-hidden className="size-5 shrink-0" />
                    <span>{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="border-t border-mist p-3">
          <LanguageSwitcher />
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <OfflineBanner message={t("errorOffline")} />

        {/* Mobile and tablet header. The sidebar carries this on desktop. */}
        <header className="sticky top-0 z-30 border-b border-mist bg-card/95 backdrop-blur lg:hidden">
          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <div className="min-w-0">
              <p className="truncate text-h3 font-semibold text-forest">
                {title ?? t("appName")}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">{headerActions}</div>
          </div>
        </header>

        {/* Desktop header keeps the screen title and per-screen actions. */}
        <header className="hidden border-b border-mist bg-card px-6 py-4 lg:flex lg:items-center lg:justify-between lg:gap-4">
          <h1 className="min-w-0 truncate text-h2 font-semibold">{title ?? t("appName")}</h1>
          <div className="flex shrink-0 items-center gap-3">{headerActions}</div>
        </header>

        {/*
          min-w-0 on the flex child is what actually prevents a wide table or
          chart from pushing the whole page sideways; without it the grid track
          grows to the content and the body scrolls horizontally.
          pb-24 clears the fixed bottom navigation on small screens.
        */}
        <main id="main" className="min-w-0 flex-1 px-4 pb-24 pt-4 sm:px-6 lg:px-8 lg:pb-8">
          <div className="mx-auto w-full max-w-[100rem]">{children}</div>
        </main>

        {/* Bottom navigation, mobile and tablet only. */}
        <nav
          aria-label={t("navHome")}
          className="fixed inset-x-0 bottom-0 z-40 border-t border-mist bg-card lg:hidden"
          style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
        >
          <ul className="mx-auto flex max-w-[40rem]">
            {NAV.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href} className="flex-1">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-[56px] flex-col items-center justify-center gap-0.5 px-1 py-2 text-[0.6875rem] font-semibold",
                      active ? "text-forest" : "text-slate",
                    )}
                  >
                    <item.icon aria-hidden className="size-5 shrink-0" />
                    {/* Telugu and Punjabi labels are longer than the English
                        ones, so the label is allowed to wrap and stay centred
                        rather than being clipped. */}
                    <span className="text-center leading-tight">{t(item.labelKey)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </div>
    </div>
  );
}
