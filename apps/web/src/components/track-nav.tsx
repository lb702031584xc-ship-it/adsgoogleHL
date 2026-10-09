"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export interface TrackNavItem {
  href: string;
  label: string;
}

export interface TrackNavSection {
  title: string;
  items: TrackNavItem[];
}

interface TrackNavProps {
  /** Role-filtered sections, built server-side in the app layout. */
  sections: TrackNavSection[];
  /**
   * Current pathname. Optional: when omitted (the app layout cannot know the
   * URL in a server component without middleware changes), the browser's
   * pathname is used via usePathname().
   */
  activePath?: string;
}

/** Index of the first section containing the path (exact or nested route). */
function sectionIndexForPath(sections: TrackNavSection[], path: string): number {
  return sections.findIndex((section) =>
    section.items.some((item) => path === item.href || path.startsWith(`${item.href}/`)),
  );
}

function isActiveItem(item: TrackNavItem, path: string): boolean {
  return path === item.href || path.startsWith(`${item.href}/`);
}

/**
 * Collapsible track navigation. Only the track containing the current page is
 * expanded by default; clicking a track header toggles it. The active page
 * link is highlighted.
 *
 * Pure client component: never import server-only modules (next/headers,
 * server actions, @/lib/api/*) here. Keep it importable from the client
 * component rules documented in AGENTS.md lessons.
 */
export function TrackNav({ sections, activePath }: TrackNavProps) {
  const browserPath = usePathname();
  const path = activePath ?? browserPath;

  const [expanded, setExpanded] = useState<number[]>(() => {
    const initial = sectionIndexForPath(sections, path);
    return initial >= 0 ? [initial] : [];
  });

  const toggle = (index: number) =>
    setExpanded((prev) =>
      prev.includes(index) ? prev.filter((i) => i !== index) : [...prev, index],
    );

  return (
    <div className="flex flex-col gap-1">
      {sections.map((section, index) => {
        const open = expanded.includes(index);
        return (
          <div key={section.title}>
            <button
              type="button"
              onClick={() => toggle(index)}
              aria-expanded={open}
              className="flex w-full items-center justify-between rounded-md px-3 py-2 text-xs font-medium uppercase tracking-wider text-mist/50 transition hover:bg-white/5 hover:text-mist/80"
            >
              <span>{section.title}</span>
              <span
                aria-hidden="true"
                className={`text-[10px] transition-transform ${open ? "rotate-180" : ""}`}
              >
                ▼
              </span>
            </button>
            {open ? (
              <div className="flex flex-col gap-0.5 pb-1">
                {section.items.map((item) => {
                  const active = isActiveItem(item, path);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-md px-3 py-2 text-sm transition ${
                        active
                          ? "bg-white/15 font-medium text-white"
                          : "text-mist/85 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
